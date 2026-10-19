// OpenStreetMap (datos abiertos, licencia ODbL): muchos negocios publican ahí su teléfono, email y web.
// Se consulta la API pública de Overpass con moderación (una consulta a la vez) según su política de uso.
import { normalize } from '../text';
import { BOT_UA, SourceError, fetchWithRetry } from './http';

export interface OsmPlace { name: string; phone: string | null; email: string | null; website: string | null; address: string | null; url: string }

const OVERPASS = 'https://overpass-api.de/api/interpreter';
let queue: Promise<unknown> = Promise.resolve();
/** Serializa las consultas: la API pública permite pocas simultáneas por IP. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
const escapeStr = (s: string) => s.replace(/["\\]/g, '\\$&');

/** Palabra más distintiva del nombre, tal como está escrita (con tildes), para la búsqueda en OSM. */
export function distinctiveWord(name: string, tokens: string[]) {
  const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
  if (!longest) return null;
  return name.split(/[^\p{L}\p{N}]+/u).find((w) => normalize(w) === longest) ?? longest;
}

export function parseOverpass(data: any): OsmPlace[] {
  return (data?.elements ?? []).filter((e: any) => e.tags?.name).map((e: any) => {
    const t = e.tags;
    const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
    return {
      name: String(t.name),
      phone: t.phone ?? t['contact:phone'] ?? t['contact:mobile'] ?? null,
      email: t.email ?? t['contact:email'] ?? null,
      website: t.website ?? t['contact:website'] ?? t.url ?? null,
      address: [street, t['addr:postcode'], t['addr:city']].filter(Boolean).join(', ') || null,
      url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    };
  });
}

/** Negocios de OSM en la ciudad cuyo nombre contiene la palabra dada. Requiere ciudad (buscar en todo un país es demasiado costoso). */
export async function overpassLookup(word: string, city: string, timeoutMs = 25_000): Promise<{ places: OsmPlace[]; httpStatus: number; attempts: number }> {
  const q = `[out:json][timeout:20];area["name"="${escapeStr(city)}"]["boundary"="administrative"]->.a;nwr(area.a)["name"~"${escapeRe(word)}",i];out tags center 15;`;
  return serialized(async () => {
    const { res, attempts } = await fetchWithRetry(OVERPASS, {
      timeoutMs, retries: 2, backoffMs: 2000, method: 'POST', body: new URLSearchParams({ data: q }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BOT_UA, Accept: 'application/json' },
    });
    const text = await res.text();
    if (res.status === 429) throw new SourceError('rate_limited', 'OpenStreetMap: límite de peticiones alcanzado', 429);
    if (!res.ok) throw new SourceError('http', `OpenStreetMap: HTTP ${res.status}`, res.status);
    return { places: parseOverpass(JSON.parse(text)), httpStatus: res.status, attempts };
  });
}
