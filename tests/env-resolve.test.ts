import { describe, expect, it } from 'vitest';
import { resolveEnv } from '@/lib/env-resolve';

describe('resolución de variables de la integración Supabase/Vercel', () => {
  it('usa las variables con prefijo de la integración y las de sistema de Vercel', () => {
    const r = resolveEnv({
      GTC_POSTGRES_URL: 'postgres://u:p@pooler.supabase.com:6543/postgres?sslmode=require&supa=x',
      GTC_SUPABASE_URL: 'https://abc.supabase.co', GTC_SUPABASE_ANON_KEY: 'anon', GTC_SUPABASE_SERVICE_ROLE_KEY: 'srv', GTC_SUPABASE_JWT_SECRET: 'jwt',
      'GTC_https://x.vercel.appSUPABASE_URL': 'mal', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'app.vercel.app',
    });
    expect(r.DATABASE_URL).toContain(':6543/');
    expect(r.NEXT_PUBLIC_SUPABASE_URL).toBe('https://abc.supabase.co');
    expect(r.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon');
    expect(r.SUPABASE_SERVICE_ROLE_KEY).toBe('srv');
    expect(r.NEXT_PUBLIC_SITE_URL).toBe('https://app.vercel.app');
    expect(r.APP_SECRET!.length).toBeGreaterThanOrEqual(32);
    expect(r.APP_SECRET).not.toContain('jwt');
  });
  it('los nombres propios tienen prioridad', () => {
    const r = resolveEnv({ DATABASE_URL: 'postgres://propio', GTC_POSTGRES_URL: 'postgres://integracion', APP_SECRET: 'x'.repeat(40), NEXT_PUBLIC_SITE_URL: 'https://mi.dominio' });
    expect(r).toMatchObject({ DATABASE_URL: 'postgres://propio', APP_SECRET: 'x'.repeat(40), NEXT_PUBLIC_SITE_URL: 'https://mi.dominio' });
    expect(r.APP_SECRET_DERIVED).toBeUndefined();
  });
});
