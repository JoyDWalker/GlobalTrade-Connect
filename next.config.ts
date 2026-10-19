import type { NextConfig } from 'next';
import { resolveEnv } from './src/lib/env-resolve';

// Valores públicos (no secretos) resueltos también desde la integración de Supabase y las variables de Vercel
const resolved = resolveEnv(process.env);

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: resolved.NEXT_PUBLIC_SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: resolved.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    NEXT_PUBLIC_SITE_URL: resolved.NEXT_PUBLIC_SITE_URL ?? '',
  },
  agentRules: false,
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }] },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
