// Fuentes abiertas y gratuitas:
//  - GLEIF: registro mundial de entidades legales (LEI), licencia CC0. Busca por nombre legal.
//  - Wikidata: base de conocimiento abierta (CC0). Busca empresas por sector/producto y país.
// Cobertura limitada: GLEIF solo incluye entidades con LEI y Wikidata sobre todo empresas conocidas.
import { normalizeDomain, rootDomain, truncate } from '../text';
import { BOT_UA, SourceError, fetchWithRetry } from './http';
import { parseGleif, type CompanyHit, type SearchAdapter } from './adapters';

const json = async (url: string, timeoutMs: number, headers: Record<string, string> = {}) => {
  const { res, attempts } = await fetchWithRetry(url, { timeoutMs, retries: 2, headers: { 'User-Agent': BOT_UA, Accept: 'application/json', ...headers } });
  const text = await res.text();
  if (res.status === 429) throw new SourceError('rate_limited', 'Límite de peticiones alcanzado', 429);
  if (!res.ok) throw new SourceError('http', `HTTP ${res.status}`, res.status);
  return { data: JSON.parse(text), status: res.status, attempts };
};

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s.&/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : s);

// ───────── GLEIF ─────────
export const gleifSearch: SearchAdapter = {
  key: 'gleif',
  queryStyle: 'plain',
  isConfigured: () => true,
  async search(query, opts) {
    const first = await gleifOnce(query, opts);
    const longest = query.split(' ').sort((a, b) => b.length - a.length)[0];
    if (first.hits.length || !longest || longest === query) return first;
    const second = await gleifOnce(longest, opts);
    return { ...second, attempts: first.attempts + second.attempts };
  },
};

async function gleifOnce(query: string, { limit, country, timeoutMs }: { limit: number; country?: string | null; timeoutMs: number }) {
  {
    const u = new URL('https://api.gleif.org/api/v1/lei-records');
    u.searchParams.set('filter[fulltext]', query);
    if (country) u.searchParams.set('filter[entity.legalAddress.country]', country);
    u.searchParams.set('filter[entity.status]', 'ACTIVE');
    u.searchParams.set('page[size]', String(Math.min(20, limit)));
    const { data, status, attempts } = await json(u.toString(), timeoutMs, { Accept: 'application/vnd.api+json' });
    const hits: CompanyHit[] = parseGleif(data).filter((r) => r.legalName).map((r) => ({
      sourceKey: 'gleif', externalId: `lei:${r.lei}`, name: titleCase(r.legalName), legalName: r.legalName, lei: r.lei,
      url: null, domain: null, countryCode: r.country, city: r.city ? titleCase(r.city) : null, address: r.address,
      snippet: truncate(`Entidad legal registrada en GLEIF (LEI ${r.lei}). Estado: activa.${r.city ? ` Domicilio legal en ${titleCase(r.city)}.` : ''}`, 300),
      raw: { lei: r.lei, url: r.url, registeredAs: r.registeredAs },
    }));
    return { hits, httpStatus: status, attempts, billableRequests: 0 };
  }
}

// ───────── Wikidata ─────────
const WD = 'https://www.wikidata.org/w/api.php';
const COMPANY_CLASSES = ['Q4830453', 'Q783794', 'Q6881511', 'Q891723', 'Q167037', 'Q658255', 'Q1589009', 'Q15265344'];
const countryQidCache = new Map<string, string | null>();

async function wd(params: Record<string, string>, timeoutMs: number) {
  const u = new URL(WD);
  for (const [k, v] of Object.entries({ format: 'json', maxlag: '5', ...params })) u.searchParams.set(k, v);
  return json(u.toString(), timeoutMs);
}

async function countryQid(iso: string, timeoutMs: number) {
  if (countryQidCache.has(iso)) return countryQidCache.get(iso)!;
  const { data } = await wd({ action: 'query', list: 'search', srsearch: `haswbstatement:P297=${iso}`, srlimit: '1' }, timeoutMs);
  const q = data?.query?.search?.[0]?.title ?? null;
  countryQidCache.set(iso, q);
  return q;
}

/** Conceptos (sector o producto) que coinciden con la consulta, en español e inglés. */
async function conceptQids(query: string, timeoutMs: number) {
  const ids = new Set<string>();
  for (const lang of ['es', 'en']) {
    const { data } = await wd({ action: 'wbsearchentities', search: query, language: lang, uselang: lang, type: 'item', limit: '4' }, timeoutMs);
    for (const r of data?.search ?? []) if (ids.size < 6) ids.add(r.id);
  }
  return [...ids];
}

const claimValues = (entity: any, prop: string) => (entity?.claims?.[prop] ?? []).map((c: any) => c?.mainsnak?.datavalue?.value).filter(Boolean);

export const wikidataSearch: SearchAdapter = {
  key: 'wikidata',
  queryStyle: 'plain',
  isConfigured: () => true,
  async search(query, { limit, country, timeoutMs }) {
    let attempts = 1;
    let concepts = await conceptQids(query, timeoutMs);
    if (!concepts.length) {
      const longest = query.split(' ').sort((a, b) => b.length - a.length)[0];
      if (longest && longest !== query) concepts = await conceptQids(longest, timeoutMs);
    }
    if (!concepts.length) return { hits: [], httpStatus: 200, attempts, billableRequests: 0 };
    const about = concepts.flatMap((q) => [`P452=${q}`, `P1056=${q}`]).join('|');
    const cq = country ? await countryQid(country, timeoutMs) : null;
    const companyFilter = COMPANY_CLASSES.map((q) => `P31=${q}`).join('|');
    const run = async (withCountry: boolean) => {
      const srsearch = [`haswbstatement:${about}`, withCountry && cq ? `haswbstatement:P17=${cq}` : '', `haswbstatement:${companyFilter}`].filter(Boolean).join(' ');
      const { data } = await wd({ action: 'query', list: 'search', srsearch, srlimit: String(Math.min(20, limit)) }, timeoutMs);
      attempts++;
      return (data?.query?.search ?? []).map((s: any) => s.title as string);
    };
    const ids = await run(true);
    if (!ids.length) return { hits: [], httpStatus: 200, attempts, billableRequests: 0 };
    const { data } = await wd({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|claims', languages: 'es|en' }, timeoutMs);
    const entities = Object.values(data?.entities ?? {}) as any[];
    // ISO de los países referenciados
    const countryIds = [...new Set(entities.flatMap((e) => claimValues(e, 'P17').map((v: any) => v.id)))].slice(0, 50);
    const iso = new Map<string, string>();
    if (countryIds.length) {
      const c = await wd({ action: 'wbgetentities', ids: countryIds.join('|'), props: 'claims' }, timeoutMs);
      for (const [id, e] of Object.entries(c.data?.entities ?? {})) { const v = claimValues(e, 'P297')[0]; if (v) iso.set(id, String(v)); }
    }
    const hits: CompanyHit[] = [];
    for (const e of entities) {
      const name = e.labels?.es?.value ?? e.labels?.en?.value;
      if (!name || claimValues(e, 'P576').length) continue;                       // sin nombre o disuelta
      const website = claimValues(e, 'P856')[0] as string | undefined;
      const domain = website ? normalizeDomain(website) : null;
      hits.push({
        sourceKey: 'wikidata', externalId: `wikidata:${e.id}`, name: truncate(name, 150),
        url: website ?? null, domain: domain ? rootDomain(domain) : null,
        countryCode: iso.get(claimValues(e, 'P17')[0]?.id) ?? null,
        snippet: truncate(e.descriptions?.es?.value ?? e.descriptions?.en?.value ?? 'Empresa registrada en Wikidata', 300),
        raw: { qid: e.id, url: `https://www.wikidata.org/wiki/${e.id}` },
      });
    }
    return { hits, httpStatus: 200, attempts, billableRequests: 0 };
  },
};
