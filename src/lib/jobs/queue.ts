// Cola de tareas persistente en PostgreSQL (FOR UPDATE SKIP LOCKED): sin Redis, válida en serverless.
import type { Queryable } from '../db';
import { many, one } from '../db';

export interface Job { id: number; type: string; payload: any; status: string; attempts: number; max_attempts: number; dedupe_key: string | null; created_at: string }

export async function enqueue(q: Queryable, type: string, payload: Record<string, unknown> = {}, opts: { dedupeKey?: string; runAt?: Date; priority?: number; maxAttempts?: number; createdBy?: string | null } = {}) {
  const r = await one<{ id: number }>(q, `INSERT INTO jobs (type, payload, dedupe_key, run_at, priority, max_attempts, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (dedupe_key) WHERE status IN ('queued', 'running') AND dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
  [type, JSON.stringify(payload), opts.dedupeKey ?? null, (opts.runAt ?? new Date()).toISOString(), opts.priority ?? 50, opts.maxAttempts ?? 3, opts.createdBy ?? null]);
  return r?.id ?? null;
}

/** Encola una tarea periódica una sola vez por periodo (p. ej. "check_links:2026-10-18"). */
export async function enqueueOncePerPeriod(q: Queryable, type: string, periodKey: string, payload: Record<string, unknown> = {}) {
  const key = `${type}:${periodKey}`;
  const r = await one<{ id: number }>(q, `INSERT INTO jobs (type, payload, dedupe_key, priority)
    SELECT $1, $2, $3, 30 WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE dedupe_key = $3) RETURNING id`, [type, JSON.stringify(payload), key]);
  return r?.id ?? null;
}

export async function claimNext(q: Queryable, workerId: string): Promise<Job | null> {
  const r = await one<Job>(q, `UPDATE jobs SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1, started_at = now()
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() ORDER BY priority DESC, run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, type, payload, status, attempts, max_attempts, dedupe_key, created_at`, [workerId]);
  if (r && typeof r.payload === 'string') r.payload = JSON.parse(r.payload);
  return r;
}

export async function completeJob(q: Queryable, id: number, result: unknown) {
  await q.query("UPDATE jobs SET status = 'succeeded', finished_at = now(), locked_at = NULL, result = $2, last_error = NULL WHERE id = $1", [id, JSON.stringify(result ?? null)]);
}

/** Reintento con espera exponencial (1, 4, 16 min…) o fallo definitivo. Devuelve true si es definitivo. */
export async function failJob(q: Queryable, job: Pick<Job, 'id' | 'attempts' | 'max_attempts'>, error: string) {
  const final = job.attempts >= job.max_attempts;
  if (final) {
    await q.query("UPDATE jobs SET status = 'failed', finished_at = now(), locked_at = NULL, last_error = $2 WHERE id = $1", [job.id, error.slice(0, 2000)]);
  } else {
    const delayMin = 4 ** (job.attempts - 1);
    await q.query(`UPDATE jobs SET status = 'queued', locked_at = NULL, locked_by = NULL, last_error = $2, run_at = now() + make_interval(mins => $3) WHERE id = $1`, [job.id, error.slice(0, 2000), delayMin]);
  }
  return final;
}

/** Recupera tareas interrumpidas (proceso caído o función serverless cortada). */
export async function recoverStuck(q: Queryable, stuckMinutes: number) {
  const rows = await many<{ id: number }>(q, `UPDATE jobs SET
      status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
      finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
      last_error = 'Interrumpida: se superó el tiempo máximo de ejecución', locked_at = NULL, locked_by = NULL
    WHERE status = 'running' AND locked_at < now() - make_interval(mins => $1) RETURNING id`, [stuckMinutes]);
  return rows.length;
}

export async function cancelJob(q: Queryable, id: number) {
  return (await q.query("UPDATE jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status = 'queued'", [id])).rowCount > 0;
}

export async function retryJob(q: Queryable, id: number) {
  return (await q.query("UPDATE jobs SET status = 'queued', run_at = now(), attempts = 0, last_error = NULL, finished_at = NULL WHERE id = $1 AND status IN ('failed', 'cancelled')", [id])).rowCount > 0;
}
