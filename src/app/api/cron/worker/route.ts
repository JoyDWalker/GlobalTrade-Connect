// Disparado por Vercel Cron o GitHub Actions con "Authorization: Bearer $CRON_SECRET".
import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { alert, log } from '@/lib/logger';
import { runWorker } from '@/lib/jobs/worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = env().CRON_SECRET;
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || !got) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const r = await runWorker(getDb(), { timeBudgetMs: 50_000, workerId: `cron:${crypto.randomUUID().slice(0, 8)}` });
    log.info('Worker ejecutado', { scheduled: r.scheduled, recovered: r.recovered, processed: r.processed.length, failed: r.processed.filter((p) => !p.ok).length });
    return NextResponse.json(r);
  } catch (e) {
    await alert('El worker programado ha fallado', { error: e });
    return NextResponse.json({ error: 'Error en el worker' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
