// Comprobación de salud: aplicación + base de datos + migraciones. No depende de servicios externos.
import { NextResponse } from 'next/server';
import { getDb, one } from '@/lib/db';
import { migrationStatus } from '@/lib/migrations';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  const body: Record<string, unknown> = {
    status: 'ok', time: new Date().toISOString(),
    env: process.env.APP_ENV ?? process.env.VERCEL_ENV ?? 'development',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
  };
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
    body.database = { ok: false };
    return NextResponse.json(body, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
