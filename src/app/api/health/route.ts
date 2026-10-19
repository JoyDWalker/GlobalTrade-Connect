// Comprobación de salud: aplicación + base de datos + migraciones. No depende de servicios externos.
import { NextResponse } from 'next/server';
import { getDb, one } from '@/lib/db';
import { migrationStatus } from '@/lib/migrations';
import { log } from '@/lib/logger';
import { authConfigured, configProblems, configWarnings } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  const body: Record<string, unknown> = {
    status: 'ok', time: new Date().toISOString(),
    env: process.env.APP_ENV ?? process.env.VERCEL_ENV ?? 'development',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
  };
  // Configuración: solo se informa del nombre de la variable y el motivo, nunca de su valor
  const problems = configProblems();
  if (problems.length) {
    body.status = 'error';
    body.config = { ok: false, problems };
    return NextResponse.json(body, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  body.config = { ok: true, auth: authConfigured(), warnings: configWarnings() };
  try {
    const db = getDb();
    const r = await one<{ now: string }>(db, 'SELECT now()::text AS now');
    const m = await migrationStatus(db);
    const jobs = await one<{ failed: number; stuck: number; last_ok: string | null }>(db, `SELECT
      count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '24 hours')::int AS failed,
      count(*) FILTER (WHERE status = 'running' AND locked_at < now() - interval '30 minutes')::int AS stuck,
      max(finished_at) FILTER (WHERE status = 'succeeded')::text AS last_ok FROM jobs`);
    body.database = { ok: Boolean(r), latencyMs: Date.now() - started };
    body.migrations = m;
    body.worker = jobs;
    if (m.pending.length) body.status = 'degraded';
  } catch (e) {
    log.error('Health check: base de datos no disponible', { error: e });
    body.status = 'error';
    // Motivo genérico (sin cadenas de conexión) para facilitar el diagnóstico
    const msg = String((e as Error).message ?? '');
    const hint = /password authentication|SASL|auth/i.test(msg) ? 'autenticación rechazada (revisa usuario/contraseña de DATABASE_URL)'
      : /ENOTFOUND|getaddrinfo/i.test(msg) ? 'no se encuentra el servidor (revisa el host de DATABASE_URL)'
        : /timeout|ETIMEDOUT/i.test(msg) ? 'tiempo de conexión agotado'
          : /self.signed|certificate/i.test(msg) ? 'problema de certificado TLS (usa DATABASE_SSL=require)'
            : /Tenant or user not found/i.test(msg) ? 'usuario del pooler incorrecto (debe ser postgres.<ref-del-proyecto>)'
              : 'error de conexión';
    body.database = { ok: false, reason: hint };
    return NextResponse.json(body, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
