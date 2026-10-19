// Resuelve nombres alternativos de variables para funcionar sin configuración manual con:
//  - la integración Supabase de Vercel (POSTGRES_URL, SUPABASE_URL…, con o sin prefijo, p. ej. GTC_POSTGRES_URL)
//  - las variables de sistema de Vercel (VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL)
// Los nombres propios (DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL…) siempre tienen prioridad.
import crypto from 'node:crypto';

type Src = Record<string, string | undefined>;

/** Primer valor no vacío: nombre exacto o cualquier variable que termine en _NOMBRE (prefijo de la integración). */
function pick(src: Src, names: string[]) {
  for (const n of names) if (src[n]?.trim()) return src[n]!.trim();
  for (const n of names) {
    const key = Object.keys(src).find((k) => k.endsWith(`_${n}`) && /^[A-Z0-9_]+$/.test(k) && src[k]?.trim());
    if (key) return src[key]!.trim();
  }
  return undefined;
}

const derive = (base: string, label: string) => crypto.createHash('sha256').update(`globaltrade:${label}:${base}`).digest('base64url');

export function resolveEnv(src: Src = process.env): Src {
  const out: Src = { ...src };
  out.DATABASE_URL = pick(src, ['DATABASE_URL', 'POSTGRES_URL']);
  // Migraciones: conexión de sesión/directa (los bloqueos de sesión no son fiables en el transaction pooler)
  out.MIGRATION_DATABASE_URL = pick(src, ['MIGRATION_DATABASE_URL', 'POSTGRES_URL_NON_POOLING']) ?? out.DATABASE_URL;
  out.NEXT_PUBLIC_SUPABASE_URL = pick(src, ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']);
  out.NEXT_PUBLIC_SUPABASE_ANON_KEY = pick(src, ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY']);
  out.SUPABASE_SERVICE_ROLE_KEY = pick(src, ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']);
  const host = src.VERCEL_PROJECT_PRODUCTION_URL && src.VERCEL_ENV === 'production' ? src.VERCEL_PROJECT_PRODUCTION_URL : src.VERCEL_URL;
  out.NEXT_PUBLIC_SITE_URL = src.NEXT_PUBLIC_SITE_URL?.trim() || (host ? `https://${host}` : undefined);
  // Si no hay APP_SECRET propio, se deriva de forma irreversible de otro secreto del servidor (recomendado definirlo)
  const base = pick(src, ['SUPABASE_JWT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'POSTGRES_PASSWORD']);
  if (!src.APP_SECRET?.trim() && base) { out.APP_SECRET = derive(base, 'app'); out.APP_SECRET_DERIVED = 'true'; }
  return out;
}
