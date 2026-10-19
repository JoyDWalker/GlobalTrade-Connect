// Importación masiva gratuita desde Wikidata (CC0): empresas activas de un país con web oficial y sector conocido,
// con su email y teléfono si los publica. Paginación por número de elemento (Q…) para continuar donde se quedó.
// Se consulta QLever (Univ. de Friburgo, mismos datos de Wikidata, mucho más rápido en consultas grandes) y, si falla,
// el servicio oficial de Wikidata, que agota el tiempo en países grandes (EE. UU., Alemania…).
import { normalizeDomain, rootDomain, truncate } from '../text';
import { BOT_UA, SourceError, fetchWithRetry } from './http';
import type { CompanyHit } from './adapters';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const QLEVER = 'https://qlever.dev/api/wikidata';

/**
 * Tipos de entidad (y sus subtipos) que tienen sector y web pero no son empresas ni proveedores: clubes deportivos,
 * ONG y entidades sin ánimo de lucro, fundaciones, centros educativos, hospitales, organismos públicos, partidos,
 * museos, institutos de investigación, webs… No se excluye "asociación" para no perder las cooperativas.
 */
export const EXCLUDED_TYPES = ['Q847017', 'Q1076486', 'Q163740', 'Q79913', 'Q157031', 'Q2178147', 'Q955824', 'Q1785733', 'Q1530022',
  'Q18706073', 'Q327333', 'Q484652', 'Q7278', 'Q2385804', 'Q16917', 'Q11812394', 'Q35127', 'Q33506', 'Q3152824', 'Q166118', 'Q31855'];
const excludeTypes = () => `MINUS { ?item wdt:P31/wdt:P279* ?badType . VALUES ?badType { ${EXCLUDED_TYPES.map((q) => `wd:${q}`).join(' ')} } }`;

export function companiesQuery(iso: string, afterKey: number, limit: number) {
  // Primero se eligen solo los elementos de la tanda (subconsulta ligera, ordenada por número de elemento);
  // los datos y etiquetas se piden después solo para ellos. Así no se agota el tiempo en países grandes.
  return `SELECT ?item ?n (SAMPLE(?label) AS ?name) (SAMPLE(?web) AS ?website) (SAMPLE(?email) AS ?mail) (SAMPLE(?phone) AS ?tel)
  (SAMPLE(?indLabel) AS ?industry) (SAMPLE(?hqLabel) AS ?city) (SAMPLE(?description) AS ?desc) WHERE {
  { SELECT DISTINCT ?item ?n WHERE {
      ?country wdt:P297 "${iso.replace(/[^A-Z]/g, '')}" .
      ?item wdt:P17 ?country ; wdt:P452 [] ; wdt:P856 [] .
      BIND(xsd:integer(STRAFTER(STR(?item), "entity/Q")) AS ?n)
      FILTER(?n > ${Math.max(0, Math.floor(afterKey))})
    } ORDER BY ?n LIMIT ${Math.min(500, Math.max(1, Math.floor(limit)))} }
  FILTER NOT EXISTS { ?item wdt:P576 ?end }
  ${excludeTypes()}
  ?item wdt:P856 ?web ; wdt:P452 ?ind .
  OPTIONAL { ?item wdt:P968 ?email }
  OPTIONAL { ?item wdt:P1329 ?phone }
  OPTIONAL { ?item wdt:P159 ?hq }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en,mul". ?item rdfs:label ?label. ?ind rdfs:label ?indLabel. ?hq rdfs:label ?hqLabel. ?item schema:description ?description. }
} GROUP BY ?item ?n ORDER BY ?n`;
}

/** Misma consulta para QLever: sin el servicio de etiquetas (las etiquetas se piden por idioma). */
export function qleverQuery(iso: string, afterKey: number, limit: number) {
  const lang = (v: string, l: string) => `FILTER(LANG(${v}) = "${l}")`;
  return `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?item ?n (SAMPLE(?nEs) AS ?name) (SAMPLE(?nEn) AS ?nameEn) (SAMPLE(?nMul) AS ?nameMul) (SAMPLE(?web) AS ?website)
  (SAMPLE(?email) AS ?mail) (SAMPLE(?phone) AS ?tel) (SAMPLE(?iEs) AS ?industry) (SAMPLE(?iEn) AS ?industryEn)
  (SAMPLE(?hqL) AS ?city) (SAMPLE(?dEs) AS ?desc) (SAMPLE(?dEn) AS ?descEn) WHERE {
  ?country wdt:P297 "${iso.replace(/[^A-Z]/g, '')}" .
  ?item wdt:P17 ?country ; wdt:P452 ?ind ; wdt:P856 ?web .
  BIND(xsd:integer(STRAFTER(STR(?item), "entity/Q")) AS ?n)
  FILTER(?n > ${Math.max(0, Math.floor(afterKey))})
  MINUS { ?item wdt:P576 ?end }
  ${excludeTypes()}
  OPTIONAL { ?item rdfs:label ?nEs ${lang('?nEs', 'es')} }
  OPTIONAL { ?item rdfs:label ?nEn ${lang('?nEn', 'en')} }
  OPTIONAL { ?item rdfs:label ?nMul ${lang('?nMul', 'mul')} }
  OPTIONAL { ?item wdt:P968 ?email }
  OPTIONAL { ?item wdt:P1329 ?phone }
  OPTIONAL { ?ind rdfs:label ?iEs ${lang('?iEs', 'es')} }
  OPTIONAL { ?ind rdfs:label ?iEn ${lang('?iEn', 'en')} }
  OPTIONAL { ?item wdt:P159 ?hq . ?hq rdfs:label ?hqL ${lang('?hqL', 'en')} }
  OPTIONAL { ?item schema:description ?dEs ${lang('?dEs', 'es')} }
  OPTIONAL { ?item schema:description ?dEn ${lang('?dEn', 'en')} }
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
    const name = val(b, 'name') ?? val(b, 'nameEn') ?? val(b, 'nameMul');
    const website = val(b, 'website');
    const domain = website ? normalizeDomain(website) : null;
    if (!name || /^Q\d+$/.test(name) || !domain) continue;
    const email = val(b, 'mail')?.replace(/^mailto:/i, '').toLowerCase() ?? null;
    const phone = val(b, 'tel');
    const industry = val(b, 'industry') ?? val(b, 'industryEn');
    const city = val(b, 'city');
    hits.push({
      sourceKey: 'wikidata', externalId: `wikidata:${qid}`, name: truncate(name, 150), url: website, domain: rootDomain(domain),
      email: email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) ? email : null, phone: phone && /^[+()\d\s.-]{6,40}$/.test(phone) ? phone : null,
      countryCode: iso, city: city && !/^Q\d+$/.test(city) ? truncate(city, 100) : null,
      snippet: truncate([industry && !/^Q\d+$/.test(industry) ? industry : null, val(b, 'desc') ?? val(b, 'descEn')].filter(Boolean).join(' — ') || 'Empresa registrada en Wikidata', 300),
      raw: { qid, url: `https://www.wikidata.org/wiki/${qid}` },
    });
  }
  return { hits, lastKey, rows: rows.length };
}

async function sparql(endpoint: string, query: string, timeoutMs: number) {
  const u = new URL(endpoint);
  u.searchParams.set('query', query);
  if (endpoint === ENDPOINT) u.searchParams.set('format', 'json');
  const { res, attempts } = await fetchWithRetry(u.toString(), { timeoutMs, retries: 1, backoffMs: 3000, headers: { Accept: 'application/sparql-results+json', 'User-Agent': BOT_UA } });
  const text = await res.text();
  const name = endpoint === QLEVER ? 'QLever' : 'Wikidata SPARQL';
  if (res.status === 429) throw new SourceError('rate_limited', `${name}: límite de peticiones alcanzado`, 429);
  if (!res.ok) throw new SourceError(res.status === 504 || /timeout/i.test(text) ? 'timeout' : 'http', `${name}: HTTP ${res.status}`, res.status);
  return { data: JSON.parse(text), httpStatus: res.status, attempts };
}

export async function wikidataCompaniesPage(iso: string, afterKey: number, limit: number, timeoutMs = 40_000) {
  let r: Awaited<ReturnType<typeof sparql>>;
  try {
    r = await sparql(QLEVER, qleverQuery(iso, afterKey, limit), Math.min(timeoutMs, 25_000));
  } catch (e) {
    // Si QLever pide esperar, se reintenta en la siguiente ronda; si falla de otra forma, se usa el servicio oficial
    if (e instanceof SourceError && e.kind === 'rate_limited') throw e;
    r = await sparql(ENDPOINT, companiesQuery(iso, afterKey, limit), timeoutMs);
  }
  return { ...parseCompanies(r.data, iso), httpStatus: r.httpStatus, attempts: r.attempts };
}
