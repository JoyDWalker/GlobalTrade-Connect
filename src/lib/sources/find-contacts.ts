// Contactos de empresas sin web conocida (p. ej. las que llegan de GLEIF, que solo publica nombre y dirección):
// 1) ficha de Google Maps vía Serper (teléfono, web y dirección públicos);
// 2) si sigue sin web, buscador web con el nombre y la ciudad, aceptando solo un dominio que corresponda al nombre.
// El email se obtiene después visitando la web encontrada (página de inicio y de contacto).
import { isGenericDomain, normalize, normalizeDomain, rootDomain } from '../text';
import { serper, serperPlaces, type SearchAdapter } from './adapters';
import { SourceError } from './http';

// Formas jurídicas y palabras que no identifican a la empresa
const NOISE = new Set(['sa', 'sl', 'slu', 'sas', 'srl', 'spa', 'sarl', 'ltd', 'ltda', 'limited', 'gmbh', 'ag', 'bv', 'nv', 'ab', 'as', 'oy', 'aps', 'kg', 'inc', 'llc', 'llp',
  'plc', 'corp', 'corporation', 'co', 'cia', 'company', 'group', 'grupo', 'holding', 'the', 'and', 'och', 'und', 'et', 'de', 'del', 'la', 'el', 'los', 'las', 'le', 'les', 'di', 'da', 'do', 'van', 'von', 'of', 'i', 'y', 'e']);

/** Palabras significativas del nombre ("Cafe Kladdkakan i Gamla Stan AB" → cafe, kladdkakan, gamla, stan). */
export function nameTokens(name: string) {
  return normalize(name).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length >= 3 && !NOISE.has(w));
}

/** ¿El dominio parece de esta empresa? ("kladdkakan.se" ↔ "Cafe Kladdkakan i Gamla Stan AB") */
export function domainMatchesName(domain: string, name: string) {
  const label = rootDomain(domain).split('.')[0].replace(/-/g, '');
  const tokens = nameTokens(name);
  if (label.length < 3 || !tokens.length) return false;
  // Una palabra distintiva (5+ letras) dentro del dominio, o las dos primeras palabras juntas ("cafekladdkakan")
  return tokens.some((t) => t.length >= 5 && label.includes(t)) || (tokens.length > 1 && label.includes(tokens[0] + tokens[1]));
}

/** ¿El negocio de Google Maps es esta empresa? Coincide la palabra más distintiva y al menos la mitad de las demás. */
export function placeMatchesName(title: string, name: string) {
  const tokens = nameTokens(name);
  const t = normalize(title);
  if (!tokens.length) return false;
  const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
  const hits = tokens.filter((w) => t.includes(w)).length;
  return t.includes(longest) && hits >= Math.max(1, Math.ceil(tokens.length / 2));
}

export interface ContactCall { sourceKey: string; query: string; status: 'ok' | 'error' | 'timeout' | 'rate_limited' | 'quota_exceeded'; results: number; ms: number; httpStatus?: number; error?: string }
export interface FoundContacts { website: string | null; phone: string | null; address: string | null; sourceKey: string | null; sourceUrl: string | null; calls: ContactCall[] }

const callStatus = (e: unknown): ContactCall['status'] => {
  const k = e instanceof SourceError ? e.kind : 'network';
  return k === 'timeout' ? 'timeout' : k === 'rate_limited' ? 'rate_limited' : k === 'quota_exceeded' ? 'quota_exceeded' : 'error';
};

export async function findContacts(c: { name: string; city: string | null; country_code: string | null },
  { webAdapters, usePlaces, timeoutMs = 8000 }: { webAdapters: SearchAdapter[]; usePlaces: boolean; timeoutMs?: number }): Promise<FoundContacts> {
  const out: FoundContacts = { website: null, phone: null, address: null, sourceKey: null, sourceUrl: null, calls: [] };
  const query = [c.name, c.city].filter(Boolean).join(' ');

  if (usePlaces) {
    const started = Date.now();
    try {
      const r = await serperPlaces(query, { country: c.country_code, timeoutMs });
      out.calls.push({ sourceKey: serper.key, query: `maps: ${query}`, status: 'ok', results: r.places.length, ms: Date.now() - started, httpStatus: r.httpStatus });
      const p = r.places.find((x) => placeMatchesName(x.title, c.name));
      if (p) {
        const d = normalizeDomain(p.website);
        out.phone = p.phone?.trim() || null;
        out.address = p.address;
        out.website = d && !isGenericDomain(d) ? `https://${d}` : null;
        out.sourceKey = serper.key;
        out.sourceUrl = p.url;
      }
    } catch (e) {
      out.calls.push({ sourceKey: serper.key, query: `maps: ${query}`, status: callStatus(e), results: 0, ms: Date.now() - started, error: (e as Error).message });
    }
  }

  for (const a of webAdapters) {
    if (out.website) break;
    const started = Date.now();
    try {
      const r = await a.search(`"${c.name}" ${c.city ?? ''}`.trim(), { limit: 10, country: c.country_code, timeoutMs });
      out.calls.push({ sourceKey: a.key, query, status: 'ok', results: r.hits.length, ms: Date.now() - started, httpStatus: r.httpStatus });
      const h = r.hits.find((x) => x.domain && domainMatchesName(x.domain, c.name));
      if (h) { out.website = `https://${h.domain}`; out.sourceKey ??= a.key; out.sourceUrl ??= (h.raw as any)?.url ?? h.url; }
    } catch (e) {
      out.calls.push({ sourceKey: a.key, query, status: callStatus(e), results: 0, ms: Date.now() - started, error: (e as Error).message });
    }
  }
  return out;
}
