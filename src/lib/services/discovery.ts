// Encola la búsqueda de web/contactos de empresas sin web y la ejecuta en segundo plano tras responder.
import type { Db } from '../db';
import { many } from '../db';
import { log } from '../logger';
import { enqueue } from '../jobs/queue';
import { runWorker } from '../jobs/worker';

/** Encola discover_website para las empresas indicadas que no tienen web y aún no se ha buscado. Devuelve cuántas. */
export async function queueWebsiteDiscovery(db: Db, ids: string[], priority = 55) {
  if (!ids.length) return 0;
  const rows = await many<{ id: string }>(db, `SELECT id FROM companies WHERE id = ANY($1::uuid[]) AND website IS NULL AND website_discovered_at IS NULL
    AND deleted_at IS NULL AND is_demo = false`, [ids]);
  let n = 0;
  for (const r of rows) if (await enqueue(db, 'discover_website', { companyId: r.id }, { dedupeKey: `discover:${r.id}`, priority })) n++;
  return n;
}

/** Procesa las tareas de búsqueda de webs y de lectura de webs pendientes (para llamar dentro de after()). */
export async function processContactJobs(db: Db, label: string, maxJobs = 20, timeBudgetMs = 50_000) {
  try {
    const w = await runWorker(db, { timeBudgetMs, schedule: false, types: ['discover_website', 'enrich_company'], maxJobs, workerId: label });
    log.info('Webs y contactos procesados en segundo plano', { label, processed: w.processed.length, failed: w.processed.filter((p) => !p.ok).length });
  } catch (e) {
    log.warn('No se pudieron procesar webs y contactos en segundo plano', { label, error: e });
  }
}
