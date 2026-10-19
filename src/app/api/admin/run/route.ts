// Importación continua desde el panel: cada llamada encola una tanda de importación y ejecuta el worker ~45 s.
// La página de tareas la repite mientras esté abierta; no necesita cron ni secretos.
import { api } from '@/lib/api';
import { getDb, one } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { enqueue } from '@/lib/jobs/queue';
import { runWorker } from '@/lib/jobs/worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = api(async () => {
  const u = await requireAdmin();
  const db = getDb();
  // Una sola tanda de importación a la vez (evita repetir el mismo país y saturar la fuente)
  if (!(await one(db, "SELECT 1 FROM jobs WHERE type = 'import_wikidata' AND status IN ('queued', 'running')"))) {
    await enqueue(db, 'import_wikidata', {}, { dedupeKey: 'continuo:import_wikidata', priority: 80 });
  }
  const r = await runWorker(db, { timeBudgetMs: 45_000, schedule: true, workerId: `continuo:${u.id.slice(0, 8)}` });
  const stats = await one<{ total: number; contactable: number }>(db, `SELECT count(*)::int AS total,
    count(*) FILTER (WHERE email IS NOT NULL OR phone IS NOT NULL)::int AS contactable FROM companies WHERE deleted_at IS NULL`);
  return { processed: r.processed.length, failed: r.processed.filter((p) => !p.ok).length, imported: r.processed.filter((p) => p.type === 'import_wikidata').length, ...stats };
});
