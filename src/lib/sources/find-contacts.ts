// Contactos de empresas sin web conocida (p. ej. las que llegan de GLEIF, que solo publica nombre y dirección).
// Gratuitas (siempre): OpenStreetMap (teléfono, email, web) y deducir la web por el nombre, comprobando que la página es
// de esa empresa. De pago (solo con clave): ficha de Google Maps vía Serper y buscador web.
// El email se obtiene después visitando la web encontrada (página de inicio y de contacto).
import { isGenericDomain, normalize, normalizeDomain, rootDomain } from '../text';
import { serper, serperPlaces, type SearchAdapter } from './adapters';
import { SourceError } from './http';
import { distinctiveWord, overpassLookup } from './osm';
import { guessWebsite } from './guess-domain';

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

/** ¿El negocio del mapa es esta empresa? Coincide la palabra más distintiva y al menos la mitad de las demás. */
export function placeMatchesName(title: string, name: string) {
  const tokens = nameTokens(name);
  const t = normalize(title);
  if (!tokens.length) return false;
  const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
  const hits = tokens.filter((w) => t.includes(w)).length;
  return t.includes(longest) && hits >= Math.max(1, Math.ceil(tokens.length / 2));
}

export interface ContactCall { sourceKey: string; query: string; status: 'ok' | 'error' | 'timeout' | 'rate_limited' | 'quota_exceeded'; results: number; ms: number; httpStatus?: number; error?: string }
type Field = 'website' | 'phone' | 'email' | 'address';
export interface FoundContacts {
  website: string | null; phone: string | null; email: string | null; address: string | null;
  /** Fuente de cada dato encontrado (clave de la fuente y URL donde se publica) */
  origin: Partial<Record<Field, { sourceKey: string; url: string | null }>>;
  calls: ContactCall[];
}

const callStatus = (e: unknown): ContactCall['status'] => {
  const k = e instanceof SourceError ? e.kind : 'network';
  return k === 'timeout' ? 'timeout' : k === 'rate_limited' ? 'rate_limited' : k === 'quota_exceeded' ? 'quota_exceeded' : 'error';
};

export async function findContacts(c: { name: string; city: string | null; country_code: string | null },
  { webAdapters, usePlaces, timeoutMs = 8000, osm = overpassLookup, guess = guessWebsite }:
  { webAdapters: SearchAdapter[]; usePlaces: boolean; timeoutMs?: number; osm?: typeof overpassLookup; guess?: typeof guessWebsite }): Promise<FoundContacts> {
  const out: FoundContacts = { website: null, phone: null, email: null, address: null, origin: {}, calls: [] };
  const set = (field: Field, value: string | null | undefined, sourceKey: string, url: string | null) => {
    const v = value?.trim();
    if (!v || out[field]) return;
    out[field] = field === 'email' ? v.toLowerCase() : v;
    out.origin[field] = { sourceKey, url };
  };
  const siteOf = (raw: string | null) => { const d = normalizeDomain(raw); return d && !isGenericDomain(d) ? `https://${d}` : null; };
  const query = [c.name, c.city].filter(Boolean).join(' ');
  const tokens = nameTokens(c.name);

  // 1. OpenStreetMap (gratuito). Solo con ciudad: buscar en un país entero sería demasiado costoso para el servicio
  const word = distinctiveWord(c.name, tokens);
  if (c.city && word) {
    const started = Date.now();
    const q = `osm: ${word} @ ${c.city}`;
    try {
      const r = await osm(word, c.city);
      out.calls.push({ sourceKey: 'osm', query: q, status: 'ok', results: r.places.length, ms: Date.now() - started, httpStatus: r.httpStatus });
      const p = r.places.find((x) => placeMatchesName(x.name, c.name));
      if (p) {
        set('phone', p.phone, 'osm', p.url);
        set('email', p.email, 'osm', p.url);
        set('website', siteOf(p.website), 'osm', p.url);
        set('address', p.address, 'osm', p.url);
      }
    } catch (e) {
      out.calls.push({ sourceKey: 'osm', query: q, status: callStatus(e), results: 0, ms: Date.now() - started, error: (e as Error).message });
    }
  }

  // 2. Google Maps vía Serper (de pago, solo con clave) si aún falta el teléfono
  if (usePlaces && !out.phone) {
    const started = Date.now();
    try {
      const r = await serperPlaces(query, { country: c.country_code, timeoutMs });
      out.calls.push({ sourceKey: serper.key, query: `maps: ${query}`, status: 'ok', results: r.places.length, ms: Date.now() - started, httpStatus: r.httpStatus });
      const p = r.places.find((x) => placeMatchesName(x.title, c.name));
      if (p) {
        set('phone', p.phone, serper.key, p.url);
        set('website', siteOf(p.website), serper.key, p.url);
        set('address', p.address, serper.key, p.url);
      }
    } catch (e) {
      out.calls.push({ sourceKey: serper.key, query: `maps: ${query}`, status: callStatus(e), results: 0, ms: Date.now() - started, error: (e as Error).message });
    }
  }

  // 3. Buscador web (de pago, solo con clave)
  for (const a of webAdapters) {
    if (out.website) break;
    const started = Date.now();
    try {
      const r = await a.search(`"${c.name}" ${c.city ?? ''}`.trim(), { limit: 10, country: c.country_code, timeoutMs });
      out.calls.push({ sourceKey: a.key, query, status: 'ok', results: r.hits.length, ms: Date.now() - started, httpStatus: r.httpStatus });
      const h = r.hits.find((x) => x.domain && domainMatchesName(x.domain, c.name));
      if (h) set('website', `https://${h.domain}`, a.key, ((h.raw as any)?.url as string | undefined) ?? h.url);
    } catch (e) {
      out.calls.push({ sourceKey: a.key, query, status: callStatus(e), results: 0, ms: Date.now() - started, error: (e as Error).message });
    }
  }

  // 4. Deducir la web por el nombre (gratuito), aceptándola solo si la página es de esta empresa
  if (!out.website && tokens.length) {
    const started = Date.now();
    const g = await guess(tokens, c.country_code, c.city);
    out.calls.push({ sourceKey: 'website', query: `dominios: ${g.tried.join(', ')}`, status: 'ok', results: g.website ? 1 : 0, ms: Date.now() - started });
    set('website', g.website, 'website', g.website);
  }
  return out;
}
