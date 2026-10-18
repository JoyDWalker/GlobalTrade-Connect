import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { claimNext, enqueue, enqueueOncePerPeriod, failJob, recoverStuck } from '@/lib/jobs/queue';
import { HANDLERS, runWorker, scheduleRecurring } from '@/lib/jobs/worker';

describe('cola de tareas', () => {
  it('no duplica tareas activas con la misma clave', async () => {
    const db = await freshDb();
    expect(await enqueue(db, 'send_emails', {}, { dedupeKey: 'k1' })).not.toBeNull();
    expect(await enqueue(db, 'send_emails', {}, { dedupeKey: 'k1' })).toBeNull();
    expect(await enqueueOncePerPeriod(db, 'cleanup', '2026-10-18')).not.toBeNull();
    expect(await enqueueOncePerPeriod(db, 'cleanup', '2026-10-18')).toBeNull();
  });

  it('reintenta con espera progresiva y falla tras el máximo de intentos', async () => {
    const db = await freshDb();
    await enqueue(db, 'x', {}, { maxAttempts: 2 });
    const j1 = (await claimNext(db, 'w'))!;
    expect(await failJob(db, j1, 'boom')).toBe(false);
    const queued = (await db.query('SELECT status, run_at > now() AS later FROM jobs WHERE id = $1', [j1.id])).rows[0];
    expect(queued).toMatchObject({ status: 'queued', later: true });
    await db.query('UPDATE jobs SET run_at = now() WHERE id = $1', [j1.id]);
    const j2 = (await claimNext(db, 'w'))!;
    expect(j2.attempts).toBe(2);
    expect(await failJob(db, j2, 'boom')).toBe(true);
    expect((await db.query('SELECT status FROM jobs WHERE id = $1', [j1.id])).rows[0].status).toBe('failed');
  });

  it('recupera tareas interrumpidas', async () => {
    const db = await freshDb();
    await enqueue(db, 'x', {});
    const j = (await claimNext(db, 'w'))!;
    await db.query("UPDATE jobs SET locked_at = now() - interval '1 hour' WHERE id = $1", [j.id]);
    expect(await recoverStuck(db, 15)).toBe(1);
    expect((await db.query('SELECT status FROM jobs WHERE id = $1', [j.id])).rows[0].status).toBe('queued');
  });

  it('el worker programa tareas periódicas una sola vez y las ejecuta', async () => {
    const db = await freshDb({ demo: true });
    expect(await scheduleRecurring(db)).toBeGreaterThan(3);
    expect(await scheduleRecurring(db)).toBe(0);
    await db.query("DELETE FROM jobs WHERE type = 'check_links'");    // sin red en las pruebas
    const r = await runWorker(db, { timeBudgetMs: 20000, schedule: false });
    expect(r.processed.length).toBeGreaterThan(0);
    expect(r.processed.filter((p) => !p.ok)).toEqual([]);
    const dup = await HANDLERS.detect_duplicates({ db, job: {} as any, deadline: Date.now() + 10000 });
    expect(dup).toEqual({ groups: 0 });
  });
});
