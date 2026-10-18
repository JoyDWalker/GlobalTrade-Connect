// Adaptadores de fuentes externas. Cada uno es independiente: si uno falla o no está configurado,
// los demás y los datos almacenados siguen funcionando.
import { env } from '../env';
import { isGenericDomain, normalizeDomain, rootDomain, truncate } from '../text';
import { BOT_UA, SourceError, fetchPublicPage, fetchWithRetry } from './http';
import { isAllowedByRobots } from './robots';

export interface CompanyHit {
  sourceKey: string;
  externalId: string;          // identificador estable en la fuente (URL canónica, LEI…)
  name: string;
  url: string | null;
  domain: string | null;
  snippet: string | null;
  countryCode?: string | null;
  raw?: unknown;
}
export interface SearchResponse { hits: CompanyHit[]; httpStatus: number; attempts: number; billableRequests: number }
export interface SearchAdapter {
  key: string;
  isConfigured(): boolean;
  search(query: string, opts: { limit: number; country?: string | null; timeoutMs: number }): Promise<SearchResponse>;
}

/** "Acme Coffee | Exportadores de café" → "Acme Coffee". */
export function companyNameFromTitle(title: string, domain: string | null) {
  const parts = title.split(/\s+[|\-–—·:]\s+/).map((s) => s.trim()).filter(Boolean);
  const generic = /^(inicio|home|bienvenid[oa]s?|welcome|p[aá]gina principal|homepage)$/i;
  const candidate = parts.find((p) => !generic.test(p) && p.length <= 80) ?? parts[0] ?? title;
  if (candidate.length > 3) return truncate(candidate, 120);
  return domain ? domain.split('.')[0] : title;
}

/** Convierte resultados web en posibles empresas: un resultado por dominio, sin marketplaces ni redes sociales. */
export function webResultsToHits(sourceKey: string, items: { title: string; url: string; snippet?: string; siteName?: string }[], country?: string | null) {
  const seen = new Set<string>();
  const hits: CompanyHit[] = [];
  for (const it of items) {
    const domain = normalizeDomain(it.url);
    if (!domain || isGenericDomain(domain)) continue;
    const root = rootDomain(domain);
    if (seen.has(root)) continue;
    seen.add(root);
    hits.push({
      sourceKey, externalId: `https://${root}`, name: it.siteName?.trim() || companyNameFromTitle(it.title, root),
      url: `https://${domain}`, domain: root, snippet: it.snippet ? truncate(it.snippet.replace(/\s+/g, ' '), 300) : null,
      countryCode: country ?? null, raw: { title: it.title, url: it.url },
    });
  }
  return hits;
}

const statusError = (source: string, status: number, body: string) => {
  if (status === 429) return new SourceError('rate_limited', `${source}: límite de peticiones alcanzado`, status);
  if (status === 403 && /quota|limit/i.test(body)) return new SourceError('quota_exceeded', `${source}: cuota agotada`, status);
  return new SourceError('http', `${source}: HTTP ${status}`, status);
};

// ───────── Google Programmable Search / Custom Search JSON API ─────────
// Cerrada a clientes nuevos; Google anuncia su retirada el 1/1/2027. Se mantiene para cuentas existentes.
export const googleCse: SearchAdapter = {
  key: 'google_cse',
  isConfigured: () => Boolean(env().GOOGLE_CSE_API_KEY && env().GOOGLE_CSE_ENGINE_ID),
  async search(query, { limit, country, timeoutMs }) {
    const u = new URL('https://www.googleapis.com/customsearch/v1');
    u.searchParams.set('key', env().GOOGLE_CSE_API_KEY!);
    u.searchParams.set('cx', env().GOOGLE_CSE_ENGINE_ID!);
    u.searchParams.set('q', query);
    u.searchParams.set('num', String(Math.min(10, limit)));
    if (country) u.searchParams.set('gl', country.toLowerCase());
    const { res, attempts } = await fetchWithRetry(u.toString(), { timeoutMs, retries: 2 });
    const text = await res.text();
    if (!res.ok) throw statusError('Google CSE', res.status, text);
    const data = JSON.parse(text);
    const items = (data.items ?? []).map((i: any) => ({
      title: i.title ?? '', url: i.link, snippet: i.snippet,
      siteName: i.pagemap?.metatags?.[0]?.['og:site_name'],
    }));
    return { hits: webResultsToHits('google_cse', items, country), httpStatus: res.status, attempts, billableRequests: 1 };
  },
};

// ───────── Brave Search API ─────────
export const brave: SearchAdapter = {
  key: 'brave',
  isConfigured: () => Boolean(env().BRAVE_SEARCH_API_KEY),
  async search(query, { limit, country, timeoutMs }) {
    const u = new URL('https://api.search.brave.com/res/v1/web/search');
    u.searchParams.set('q', query);
    u.searchParams.set('count', String(Math.min(20, limit)));
    if (country) u.searchParams.set('country', country.toLowerCase());
    const { res, attempts } = await fetchWithRetry(u.toString(), {
      timeoutMs, retries: 2, headers: { Accept: 'application/json', 'X-Subscription-Token': env().BRAVE_SEARCH_API_KEY! },
    });
    const text = await res.text();
    if (!res.ok) throw statusError('Brave', res.status, text);
    const data = JSON.parse(text);
    const items = (data.web?.results ?? []).map((r: any) => ({ title: r.title ?? '', url: r.url, snippet: r.description?.replace(/<[^>]+>/g, ''), siteName: r.profile?.name }));
    return { hits: webResultsToHits('brave', items, country), httpStatus: res.status, attempts, billableRequests: 1 };
  },
};

export const SEARCH_ADAPTERS: SearchAdapter[] = [brave, googleCse];

// ───────── GLEIF: registro mundial de entidades legales (LEI), datos abiertos CC0 ─────────
export interface RegistryRecord { lei: string; legalName: string; country: string | null; city: string | null; address: string | null; postalCode: string | null; status: string; registeredAs: string | null; url: string }

export async function gleifLookup(name: string, country: string | null, timeoutMs = 8000): Promise<{ records: RegistryRecord[]; httpStatus: number; attempts: number }> {
  const u = new URL('https://api.gleif.org/api/v1/lei-records');
  u.searchParams.set('filter[fulltext]', name);
  if (country) u.searchParams.set('filter[entity.legalAddress.country]', country);
  u.searchParams.set('page[size]', '5');
  const { res, attempts } = await fetchWithRetry(u.toString(), { timeoutMs, retries: 2, headers: { Accept: 'application/vnd.api+json', 'User-Agent': BOT_UA } });
  const text = await res.text();
  if (!res.ok) throw statusError('GLEIF', res.status, text);
  return { records: parseGleif(JSON.parse(text)), httpStatus: res.status, attempts };
}

export function parseGleif(data: any): RegistryRecord[] {
  return (data?.data ?? []).map((d: any) => {
    const e = d.attributes?.entity ?? {};
    const a = e.legalAddress ?? {};
    return {
      lei: d.attributes?.lei ?? d.id, legalName: e.legalName?.name ?? '', country: a.country ?? null, city: a.city ?? null,
      address: [...(a.addressLines ?? [])].join(', ') || null, postalCode: a.postalCode ?? null,
      status: e.status ?? 'UNKNOWN', registeredAs: e.registeredAs ?? null, url: `https://search.gleif.org/#/record/${d.attributes?.lei ?? d.id}`,
    };
  });
}

// ───────── Sitio web oficial: metadatos públicos ─────────
export interface SiteInfo {
  finalUrl: string; status: number; redirected: boolean;
  name: string | null; description: string | null; legalName: string | null; logo: string | null;
  emails: string[]; phones: string[]; address: { street?: string; city?: string; region?: string; postalCode?: string; country?: string } | null;
  sameAs: string[];
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
const meta = (html: string, attr: string, name: string) => {
  const re = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  return tag ? decode(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? '') || null : null;
};
// Solo buzones corporativos genéricos: minimización de datos personales (RGPD)
const ROLE_MAILBOX = /^(info|contact|contacto|contato|sales|ventas|vendas|export|exports|exportacion|comercial|commercial|hello|hola|office|oficina|admin|administracion|pedidos|orders|enquiries|inquiries|support|soporte|atencion|customer|service|servicio)[a-z0-9._-]*@/i;

export function parseSite(html: string, pageUrl: string): Omit<SiteInfo, 'finalUrl' | 'status' | 'redirected'> {
  const domain = normalizeDomain(pageUrl);
  const out: Omit<SiteInfo, 'finalUrl' | 'status' | 'redirected'> = {
    name: meta(html, 'property', 'og:site_name'), description: meta(html, 'name', 'description') ?? meta(html, 'property', 'og:description'),
    legalName: null, logo: null, emails: [], phones: [], address: null, sameAs: [],
  };
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (!out.name && title) out.name = companyNameFromTitle(decode(title), domain);
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let json: any;
    try { json = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = (Array.isArray(json) ? json : json['@graph'] ?? [json]).flat();
    for (const n of nodes) {
      const type = [].concat(n?.['@type'] ?? []).join(' ');
      if (!/Organization|Corporation|LocalBusiness|Store|Company/i.test(type)) continue;
      out.name = typeof n.name === 'string' ? n.name : out.name;
      out.legalName = n.legalName ?? out.legalName;
      out.description ??= n.description ?? null;
      const logo = typeof n.logo === 'string' ? n.logo : n.logo?.url;
      if (logo) out.logo = new URL(logo, pageUrl).toString();
      if (typeof n.email === 'string') out.emails.push(n.email.replace(/^mailto:/i, ''));
      if (typeof n.telephone === 'string') out.phones.push(n.telephone);
      const a = Array.isArray(n.address) ? n.address[0] : n.address;
      if (a && typeof a === 'object') out.address = { street: a.streetAddress, city: a.addressLocality, region: a.addressRegion, postalCode: a.postalCode, country: typeof a.addressCountry === 'string' ? a.addressCountry : a.addressCountry?.name };
      out.sameAs.push(...[].concat(n.sameAs ?? []).filter((s: unknown) => typeof s === 'string'));
    }
  }
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) out.emails.push(decodeURIComponent(m[1]));
  for (const m of html.matchAll(/href=["']tel:([+\d\s().-]{6,25})["']/gi)) out.phones.push(m[1].trim());
  // Emails: mismo dominio que la web y buzón genérico de empresa
  out.emails = [...new Set(out.emails.map((e) => e.trim().toLowerCase()))]
    .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && domain && normalizeDomain(e) && rootDomain(normalizeDomain(e)!) === rootDomain(domain) && ROLE_MAILBOX.test(e)).slice(0, 3);
  out.phones = [...new Set(out.phones)].slice(0, 3);
  out.sameAs = [...new Set(out.sameAs)].slice(0, 10);
  if (out.description) out.description = truncate(out.description, 500);
  return out;
}

const robotsCache = new Map<string, { at: number; txt: string | null }>();
async function robotsAllows(url: URL, timeoutMs: number) {
  const key = url.origin;
  let entry = robotsCache.get(key);
  if (!entry || Date.now() - entry.at > 3600e3) {
    let txt: string | null = null;
    try {
      const r = await fetchPublicPage(`${url.origin}/robots.txt`, { timeoutMs: Math.min(timeoutMs, 5000), maxBytes: 200_000 });
      txt = r.status === 200 ? r.body : null;
    } catch { txt = null; }
    entry = { at: Date.now(), txt };
    robotsCache.set(key, entry);
  }
  return entry.txt == null || isAllowedByRobots(entry.txt, url.pathname || '/');
}

export async function fetchSiteInfo(website: string, timeoutMs = 8000): Promise<SiteInfo> {
  const url = new URL(website);
  if (!(await robotsAllows(url, timeoutMs))) throw new SourceError('blocked', 'robots.txt no permite rastrear esta página');
  const page = await fetchPublicPage(url.toString(), { timeoutMs });
  if (page.status >= 400) throw new SourceError('http', `La web respondió HTTP ${page.status}`, page.status);
  if (!/html/i.test(page.contentType)) throw new SourceError('invalid', 'La página no es HTML');
  return { finalUrl: page.url, status: page.status, redirected: page.redirected, ...parseSite(page.body, page.url) };
}

/** Comprobación ligera de un enlace (para el worker de enlaces). */
export async function checkLink(website: string, timeoutMs = 8000) {
  try {
    const page = await fetchPublicPage(website, { timeoutMs, maxBytes: 50_000 });
    if (page.status >= 400) return { status: 'broken' as const, httpStatus: page.status, finalUrl: page.url };
    const sameHost = normalizeDomain(page.url) === normalizeDomain(website);
    return { status: page.redirected && !sameHost ? ('redirect' as const) : ('ok' as const), httpStatus: page.status, finalUrl: page.url };
  } catch (e) {
    const kind = (e as SourceError).kind;
    return { status: kind === 'blocked' ? ('blocked' as const) : ('broken' as const), httpStatus: (e as SourceError).httpStatus ?? null, finalUrl: null, error: (e as Error).message };
  }
}
