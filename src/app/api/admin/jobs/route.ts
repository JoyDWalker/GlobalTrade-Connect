// Estado de la cola y ejecución manual de tareas.
import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { enqueue } from '@/lib/jobs/queue';
import { JOB_TYPES, runWorker } from '@/lib/jobs/worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = api(async ({ req }) => {
  await requireAdmin();
  const status = req.nextUrl.searchParams.get('status');
  const db = getDb();
  const [items, summary] = await Promise.all([
    many(db, `SELECT id, type, payload, status, attempts, max_attempts, run_at, started_at, finished_at, last_error, result, locked_by, created_at
      FROM jobs WHERE ($1::text IS NULL OR status = $1) ORDER BY id DESC LIMIT 200`, [status || null]),
    many(db, `SELECT type, count(*) FILTER (WHERE status = 'queued')::int AS queued, count(*) FILTER (WHERE status = 'running')::int AS running,
      count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
      max(finished_at) FILTER (WHERE status = 'succeeded') AS last_success FROM jobs GROUP BY type ORDER BY type`),
  ]);
  return { items, summary, types: JOB_TYPES };
});

const enqueueSchema = z.object({
  type: z.string().refine((t) => JOB_TYPES.includes(t), 'Tipo de tarea desconocido'),
  payload: z.record(z.string(), z.unknown()).default({}),
  runNow: z.boolean().default(false),
});

export const POST = api(async ({ req, ipHash }) => {
  const u = await requireAdmin();
  const body = enqueueSchema.parse(await readJson(req));
  if (body.type === 'discovery' && body.payload.query != null && (typeof body.payload.query !== 'string' || body.payload.query.length > 200)) throw new HttpError(422, 'Consulta no válida');
  const db = getDb();
  const id = await enqueue(db, body.type, body.payload, { priority: 90, createdBy: u.id, dedupeKey: `manual:${body.type}:${JSON.stringify(body.payload)}` });
  await audit(db, { id: u.id, email: u.email }, 'job.enqueue', { type: 'job', id: id ?? 'dup' }, body, ipHash);
  const run = body.runNow ? await runWorker(db, { timeBudgetMs: 40_000, schedule: false, workerId: `manual:${u.id.slice(0, 8)}`, maxJobs: 5 }) : null;
  return { id, duplicate: id == null, run };
});
