// Importación masiva gratuita desde Wikidata (CC0): empresas activas de un país con web oficial y sector conocido,
// con su email y teléfono si los publica. Paginación por número de elemento (Q…) para continuar donde se quedó.
import { normalizeDomain, rootDomain, truncate } from '../text';
import { BOT_UA, SourceError, fetchWithRetry } from './http';
import type { CompanyHit } from './adapters';

const ENDPOINT = 'https://query.wikidata.org/sparql';

export function companiesQuery(iso: string, afterKey: number, limit: number) {
  return `SELECT ?item ?n (SAMPLE(?label) AS ?name) (SAMPLE(?web) AS ?website) (SAMPLE(?email) AS ?mail) (SAMPLE(?phone) AS ?tel)
  (SAMPLE(?indLabel) AS ?industry) (SAMPLE(?hqLabel) AS ?city) (SAMPLE(?description) AS ?desc) WHERE {
  ?country wdt:P297 "${iso.replace(/[^A-Z]/g, '')}" .
  ?item wdt:P17 ?country ; wdt:P452 ?ind ; wdt:P856 ?web .
  BIND(xsd:integer(STRAFTER(STR(?item), "entity/Q")) AS ?n)
  FILTER(?n > ${Math.max(0, Math.floor(afterKey))})
  FILTER NOT EXISTS { ?item wdt:P576 ?end }
  OPTIONAL { ?item wdt:P968 ?email }
  OPTIONAL { ?item wdt:P1329 ?phone }
  OPTIONAL { ?item wdt:P159 ?hq }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en,mul". ?item rdfs:label ?label. ?ind rdfs:label ?indLabel. ?hq rdfs:label ?hqLabel. ?item schema:description ?description. }
} GROUP BY ?item ?n ORDER BY ?n LIMIT ${Math.min(500, Math.max(1, Math.floor(limit)))}`;
}

const val = (b: any, k: string) => (b?.[k]?.value as string | undefined)?.trim() || null;

/** Convierte la respuesta SPARQL en empresas; descarta las que no tienen nombre real o web válida. */
export function parseCompanies(data: any, iso: string): { hits: CompanyHit[]; lastKey: number | null; rows: number } {
  const rows: any[] = data?.results?.bindings ?? [];
  const hits: CompanyHit[] = [];
  let lastKey: number | null = null;
  for (const b of rows) {
    const n = Number(val(b, 'n'));
    if (Number.isFinite(n)) lastKey = Math.max(lastKey ?? 0, n);
    const qid = `Q${n}`;
    const name = val(b, 'name');
    const website = val(b, 'website');
    const domain = website ? normalizeDomain(website) : null;
    if (!name || /^Q\d+$/.test(name) || !domain) continue;
    const email = val(b, 'mail')?.replace(/^mailto:/i, '').toLowerCase() ?? null;
    const phone = val(b, 'tel');
    const industry = val(b, 'industry');
    const city = val(b, 'city');
    hits.push({
      sourceKey: 'wikidata', externalId: `wikidata:${qid}`, name: truncate(name, 150), url: website, domain: rootDomain(domain),
      email: email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) ? email : null, phone: phone && /^[+()\d\s.-]{6,40}$/.test(phone) ? phone : null,
      countryCode: iso, city: city && !/^Q\d+$/.test(city) ? truncate(city, 100) : null,
      snippet: truncate([industry && !/^Q\d+$/.test(industry) ? industry : null, val(b, 'desc')].filter(Boolean).join(' — ') || 'Empresa registrada en Wikidata', 300),
      raw: { qid, url: `https://www.wikidata.org/wiki/${qid}` },
    });
  }
  return { hits, lastKey, rows: rows.length };
}

export async function wikidataCompaniesPage(iso: string, afterKey: number, limit: number, timeoutMs = 40_000) {
  const u = new URL(ENDPOINT);
  u.searchParams.set('query', companiesQuery(iso, afterKey, limit));
  u.searchParams.set('format', 'json');
  const { res, attempts } = await fetchWithRetry(u.toString(), { timeoutMs, retries: 1, backoffMs: 3000, headers: { Accept: 'application/sparql-results+json', 'User-Agent': BOT_UA } });
  const text = await res.text();
  if (res.status === 429) throw new SourceError('rate_limited', 'Wikidata: límite de peticiones alcanzado', 429);
  if (!res.ok) throw new SourceError(res.status === 500 && /timeout/i.test(text) ? 'timeout' : 'http', `Wikidata SPARQL: HTTP ${res.status}`, res.status);
  return { ...parseCompanies(JSON.parse(text), iso), httpStatus: res.status, attempts };
}
