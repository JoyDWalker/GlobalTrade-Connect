// Normalización de texto, slugs, dominios e identificadores (base de la búsqueda y la deduplicación).
import crypto from 'node:crypto';

export const normalize = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const slugify = (s: unknown) =>
  normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'empresa';

const LEGAL_FORMS = /\b(s\.?\s?a\.?\s?s?|s\.?\s?l\.?\s?u?|s\.?\s?r\.?\s?l|ltda?|limited|gmbh|ag|bv|nv|bvba|srl|spa|sarl|sas|inc|llc|llp|plc|corp(oration)?|co|cia|company|group|grupo|holding|y|e|and|de|del|la|el|the)\b/g;

/** Nombre canónico para comparar empresas ("Café Serra, S.L." ≈ "cafe serra"). */
export const canonicalName = (s: unknown) => normalize(s).replace(/[.,]/g, ' ').replace(LEGAL_FORMS, ' ').replace(/[^a-z0-9]/g, '');

const MULTI_TLD = /\.(co|com|org|net|gov|edu|ac)\.[a-z]{2}$/;

/** Dominio normalizado de una URL o email: minúsculas, sin www, sin puerto. null si no es válido. */
export function normalizeDomain(input: unknown): string | null {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@') && !s.includes('/')) s = s.split('@').pop()!;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace(/^www\d?\./, '').replace(/\.$/, '');
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host === 'localhost') return null;
    return host;
  } catch {
    return null;
  }
}

/** Dominio registrable aproximado (quita subdominios): shop.acme.co.uk → acme.co.uk */
export function rootDomain(domain: string) {
  const parts = domain.split('.');
  const keep = MULTI_TLD.test(domain) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** Dominios de plataformas que no identifican a una empresa concreta. */
const GENERIC_DOMAINS = new Set([
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com', 'wikipedia.org',
  'amazon.com', 'alibaba.com', 'aliexpress.com', 'made-in-china.com', 'indiamart.com', 'ebay.com', 'google.com',
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'blogspot.com', 'wordpress.com', 'wix.com',
  'yelp.com', 'tripadvisor.com', 'europages.com', 'kompass.com', 'bloomberg.com', 'crunchbase.com', 'reddit.com',
]);
export const isGenericDomain = (d: string | null) => !d || GENERIC_DOMAINS.has(rootDomain(d));

export const normalizeTaxId = (s: unknown) => {
  const v = String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return v.length >= 5 ? v : null;
};

export const hashIp = (ip: string, secret: string) => crypto.createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);

/** URL segura para enlazar (solo http/https). */
export const safeUrl = (u: unknown): string | null => {
  const s = String(u ?? '').trim();
  if (!s) return null;
  try { const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); return /^https?:$/.test(url.protocol) ? url.toString() : null; } catch { return null; }
};

export const truncate = (s: unknown, n: number) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
