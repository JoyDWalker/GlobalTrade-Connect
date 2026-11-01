// Descubrimiento de la web oficial de una empresa que llega sin web (p. ej. desde el registro GLEIF).
// Orden: 1) Wikidata por código LEI (gratis), 2) dominios probables a partir del nombre (gratis),
// 3) un buscador web si hay clave (Firecrawl o Brave Search, de pago, ~1 consulta por empresa). Una web solo se acepta si su
// contenido menciona el nombre de la empresa; así se evita asignar webs de otras empresas.
import { normalize, normalizeDomain, rootDomain, isGenericDomain } from '../text';
import { SourceError } from './http';
import type { SiteInfo, CompanyHit } from './adapters';

export interface DiscoverTarget { name: string; legalName?: string | null; lei?: string | null; city?: string | null; countryCode?: string | null }
export interface DiscoverDeps {
  fetchSite: (url: string) => Promise<SiteInfo>;
  wikidataByLei?: (lei: string) => Promise<{ qid: string; website: string | null; email: string | null; phone: string | null } | null>;
  webSearch?: (query: string, country: string | null) => Promise<CompanyHit[]>;
  /** Tiempo límite (epoch ms): no se empiezan comprobaciones nuevas después. */
  deadline?: number;
}
export interface DiscoverResult {
  website: string; method: 'wikidata' | 'guess' | 'web_search'; sourceUrl: string;
  info: SiteInfo | null; email: string | null; phone: string | null;
}
export interface DiscoverAttempt { method: DiscoverResult['method']; target: string; ok: boolean; error?: string }

// Formas jurídicas y palabras que no identifican a la empresa
const LEGAL = new Set(['sl', 'sa', 'slu', 'sau', 'sll', 'slne', 'scl', 'sc', 'scoop', 'coop', 'cb', 'srl', 'spa', 'sas', 'sarl', 'eurl', 'gmbh', 'ag', 'kg', 'ohg', 'ug',
  'bv', 'nv', 'bvba', 'ltd', 'ltda', 'limited', 'llc', 'llp', 'plc', 'inc', 'corp', 'corporation', 'co', 'cia', 'company', 'sociedad', 'limitada', 'anonima',
  'cooperativa', 'unipersonal', 'eireli', 'me', 'epp', 'sab', 'cv', 'de cv', 'spr', 'rl', 'sprl', 'oy', 'ab', 'as', 'aps', 'kft', 'sp', 'zoo', 'doo', 'lda']);
const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'and', 'the', 'of', 'da', 'do', 'dos', 'das', 'di', 'du', 'des', 'le', 'et', 'und', 'en', 'for', 'a']);
const GENERIC_WORDS = new Set(['grupo', 'group', 'holding', 'hermanos', 'hijos', 'industrias', 'industrial', 'comercial', 'internacional', 'international',
  'global', 'servicios', 'services', 'trading', 'export', 'import', 'empresa', 'compania', 'sociedad']);

/** Palabras del nombre sin forma jurídica, con y sin palabras vacías. */
export function nameWords(name: string) {
  // "S.L." → "sl", "S.A. de C.V." → "sa de cv": se juntan las iniciales sueltas para reconocer la forma jurídica
  const compact = normalize(name).replace(/&/g, ' y ').replace(/\b([a-z])\.\s?(?=[a-z]\b\.?)/g, '$1').replace(/[^a-z0-9 ]+/g, ' ');
  const words = compact.split(' ').filter((w) => w && w.length > 1 && !LEGAL.has(w) || /^\d+$/.test(w));
  while (words.length > 1 && STOP.has(words[words.length - 1])) words.pop();
  const key = words.filter((w) => !STOP.has(w));
  return { words, key, distinctive: key.filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w)) };
}

const TLDS: Record<string, string[]> = {
  ES: ['es', 'com'], PT: ['pt', 'com'], FR: ['fr', 'com'], DE: ['de', 'com'], IT: ['it', 'com'], GB: ['co.uk', 'com'], IE: ['ie', 'com'],
  US: ['com'], CA: ['ca', 'com'], MX: ['com.mx', 'mx', 'com'], AR: ['com.ar', 'com'], BR: ['com.br', 'com'], CO: ['com.co', 'co', 'com'],
  CL: ['cl', 'com'], PE: ['com.pe', 'pe', 'com'], EC: ['com.ec', 'ec', 'com'], UY: ['com.uy', 'uy', 'com'], NL: ['nl', 'com'], BE: ['be', 'com'],
  CH: ['ch', 'com'], AT: ['at', 'com'], PL: ['pl', 'com'], CN: ['com.cn', 'cn', 'com'], IN: ['in', 'co.in', 'com'], AU: ['com.au', 'com'],
};

/** Dominios probables a partir del nombre ("Aceites Sierra Sur S.L.", ES → aceitessierrasur.es, aceites-sierra-sur.es, …). */
export function domainCandidates(name: string, countryCode?: string | null, max = 8) {
  const { words, key, distinctive } = nameWords(name);
  if (!key.length) return [];
  const labels = [key.join(''), words.join(''), key.join('-'), distinctive.join('')]
    .filter((l, i, a) => l.length >= 4 && l.length <= 40 && a.indexOf(l) === i);
  const tlds = TLDS[countryCode ?? ''] ?? (countryCode ? [countryCode.toLowerCase(), 'com'] : ['com']);
  const out: string[] = [];
  for (const tld of tlds) for (const l of labels) out.push(`${l}.${tld}`);
  // Primero las etiquetas más naturales en el dominio del país
  return [...new Set(out)].slice(0, max);
}

const PARKED = /(domain|dominio)\s+(is\s+)?(for sale|en venta|a la venta)|buy this domain|compra este dominio|this domain (is|may be) (for sale|parked)|parked (free|domain)|sedo(parking)?\b|hugedomains|dan\.com|domain parking|este dominio ha sido registrado|website coming soon|under construction|en construcci[oó]n|p[aá]gina por defecto|default web page|index of \//i;

/** ¿La web parece ser la de esta empresa? (menciona su nombre; con nombres de una palabra se pide también la ciudad o la razón social). */
export function siteMatches(info: Pick<SiteInfo, 'text' | 'name' | 'legalName' | 'finalUrl'>, t: DiscoverTarget) {
  const text = ` ${normalize(`${info.name ?? ''} ${info.legalName ?? ''} ${info.text}`).replace(/[^a-z0-9]+/g, ' ')} `;
  if (text.trim().length < 40 || PARKED.test(info.text)) return false;
  const { key, distinctive } = nameWords(t.name);
  const words = distinctive.length ? distinctive : key;
  if (!words.length) return false;
  const has = (w: string) => text.includes(` ${w} `) || text.includes(` ${w}s `) || (w.length >= 6 && text.includes(w));
  const found = words.filter(has).length;
  const domainLabel = (normalizeDomain(info.finalUrl) ?? '').split('.')[0].replace(/-/g, '');
  const joined = key.join('');
  // Nombre completo junto (p. ej. "aceitessierrasur") en el dominio y al menos una palabra en el texto
  if (joined.length >= 8 && domainLabel === joined && found >= 1) return true;
  if (found < words.length) return words.length >= 3 && found >= words.length - 1 && extraEvidence(text, t);
  return words.length >= 2 || extraEvidence(text, t);
}

function extraEvidence(text: string, t: DiscoverTarget) {
  const city = t.city ? normalize(t.city).replace(/[^a-z0-9]+/g, ' ').trim() : '';
  if (city.length >= 3 && text.includes(` ${city} `)) return true;
  if (t.lei && text.includes(t.lei.toLowerCase())) return true;
  const legal = t.legalName ? normalize(t.legalName).replace(/[^a-z0-9]+/g, ' ').trim() : '';
  return legal.length >= 6 && text.includes(` ${legal} `);
}

const timeLeft = (deps: DiscoverDeps, need = 4000) => !deps.deadline || Date.now() + need < deps.deadline;

/** Busca la web oficial; devuelve null si ninguna candidata supera la comprobación. Nunca lanza. */
export async function discoverWebsite(t: DiscoverTarget, deps: DiscoverDeps, attempts: DiscoverAttempt[] = []): Promise<DiscoverResult | null> {
  const tryUrl = async (url: string, method: DiscoverResult['method'], strict = true) => {
    if (!timeLeft(deps)) return null;
    try {
      const info = await deps.fetchSite(url);
      const ok = !strict || siteMatches(info, t);
      attempts.push({ method, target: url, ok, error: ok ? undefined : 'no menciona a la empresa' });
      return ok ? info : null;
    } catch (e) {
      attempts.push({ method, target: url, ok: false, error: (e as Error).message?.slice(0, 200) });
      // robots.txt bloquea: la web existe y no se puede leer; si vino de una fuente fiable se acepta igualmente
      if (!strict && (e as SourceError).kind === 'blocked') return 'blocked' as const;
      return null;
    }
  };

  // 1) Wikidata por LEI: la web la declara una fuente estructurada, no hace falta comprobar el texto
  if (t.lei && deps.wikidataByLei && timeLeft(deps)) {
    try {
      const wd = await deps.wikidataByLei(t.lei);
      attempts.push({ method: 'wikidata', target: t.lei, ok: Boolean(wd?.website) });
      if (wd?.website && !isGenericDomain(normalizeDomain(wd.website))) {
        const info = await tryUrl(wd.website, 'wikidata', false);
        return { website: wd.website, method: 'wikidata', sourceUrl: `https://www.wikidata.org/wiki/${wd.qid}`, info: info === 'blocked' ? null : info, email: wd.email, phone: wd.phone };
      }
    } catch (e) {
      attempts.push({ method: 'wikidata', target: t.lei, ok: false, error: (e as Error).message?.slice(0, 200) });
    }
  }

  // 2) Dominios probables construidos con el nombre
  for (const domain of domainCandidates(t.name, t.countryCode)) {
    const info = await tryUrl(`https://${domain}/`, 'guess');
    if (info && info !== 'blocked') return { website: info.finalUrl, method: 'guess', sourceUrl: info.finalUrl, info, email: null, phone: null };
  }

  // 3) Buscador web (si está configurado): resultados cuyo contenido menciona a la empresa
  if (deps.webSearch && timeLeft(deps, 8000)) {
    const query = [`"${t.legalName || t.name}"`, t.city].filter(Boolean).join(' ');
    try {
      const hits = await deps.webSearch(query, t.countryCode ?? null);
      attempts.push({ method: 'web_search', target: query, ok: hits.length > 0 });
      const seen = new Set<string>();
      for (const h of hits.slice(0, 6)) {
        if (!h.url || !h.domain || isGenericDomain(h.domain) || seen.has(rootDomain(h.domain))) continue;
        seen.add(rootDomain(h.domain));
        const home = `https://${h.domain}/`;
        const info = await tryUrl(home, 'web_search');
        if (info && info !== 'blocked') return { website: info.finalUrl, method: 'web_search', sourceUrl: h.url, info, email: null, phone: null };
        if (seen.size >= 3) break;
      }
    } catch (e) {
      attempts.push({ method: 'web_search', target: query, ok: false, error: (e as Error).message?.slice(0, 200) });
    }
  }
  return null;
}
