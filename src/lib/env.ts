// Variables de entorno validadas. Las privadas solo existen en el servidor.
import { z } from 'zod';
import { resolveEnv } from './env-resolve';

const optional = z.string().trim().min(1).optional().catch(undefined);

const schema = z.object({
  APP_ENV: z.enum(['development', 'preview', 'production', 'test']),
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('require'),
  DATABASE_CA_CERT: optional,
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,

  GOOGLE_CSE_API_KEY: optional,
  GOOGLE_CSE_ENGINE_ID: optional,
  BRAVE_SEARCH_API_KEY: optional,
  SERPER_API_KEY: optional,

  // IA para ampliar las búsquedas (sector, términos relacionados, consultas)
  ANTHROPIC_API_KEY: optional,
  AI_MODEL: z.string().trim().min(1).default('claude-opus-5-5'),

  EMAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().default('GlobalTrade Connect <no-reply@example.com>'),
  ADMIN_NOTIFY_EMAIL: optional,

  APP_SECRET: z.string().min(32, 'APP_SECRET debe tener al menos 32 caracteres'),
  CRON_SECRET: optional,
  ALERT_WEBHOOK_URL: optional,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema>;

function detectAppEnv(): Env['APP_ENV'] {
  if (process.env.APP_ENV) return process.env.APP_ENV as Env['APP_ENV'];
  if (process.env.VERCEL_ENV === 'production') return 'production';
  if (process.env.VERCEL_ENV === 'preview') return 'preview';
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

let cached: Env | null = null;

/** Devuelve el entorno validado; lanza un error claro si falta algo obligatorio. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse({ ...resolveEnv(process.env), APP_ENV: detectAppEnv() });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${problems}`);
  }
  const e = parsed.data;
  if (e.APP_ENV === 'production') {
    const missing = (['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const).filter((k) => !e[k]);
    if (missing.length) throw new Error(`Configuración de producción incompleta: faltan ${missing.join(', ')}`);
    if (e.DATABASE_SSL === 'disable') throw new Error('En producción la conexión a la base de datos debe ir cifrada (DATABASE_SSL)');
    if (e.EMAIL_PROVIDER === 'resend' && !e.RESEND_API_KEY) throw new Error('EMAIL_PROVIDER=resend requiere RESEND_API_KEY');
  }
  cached = e;
  return e;
}

/** Problemas de configuración (solo nombres de variables y motivo, nunca valores). Vacío si todo es correcto. */
export function configProblems(): string[] {
  try { env(); return []; }
  catch (e) { return String((e as Error).message).replace(/^Configuración[^:]*:\s*/, '').split(/;\s*/).filter(Boolean); }
}

/** Solo para pruebas. */
export function resetEnvCache() { cached = null; }

export const isProduction = () => env().APP_ENV === 'production';
export const authConfigured = () => { const r = resolveEnv(process.env); return Boolean(r.NEXT_PUBLIC_SUPABASE_URL && r.NEXT_PUBLIC_SUPABASE_ANON_KEY); };

/** Avisos no bloqueantes (sin valores) para /api/health. */
export function configWarnings(): string[] {
  const r = resolveEnv(process.env);
  const w: string[] = [];
  if (!r.CRON_SECRET) w.push('CRON_SECRET no definida: el worker programado está desactivado');
  if (r.APP_SECRET_DERIVED) w.push('APP_SECRET derivada automáticamente: se recomienda definir una propia');
  if (!r.SUPABASE_SERVICE_ROLE_KEY) w.push('SUPABASE_SERVICE_ROLE_KEY no definida: subida de logos y borrado de cuentas desactivados');
  return w;
}
