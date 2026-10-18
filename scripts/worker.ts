// Worker independiente (Railway, VPS o local): procesa la cola en bucle.
//   npm run worker            bucle continuo
//   npm run worker -- --once  una sola pasada (para el cron del sistema)
import './load-env';
import { createPgDb } from '../src/lib/db';
import { log } from '../src/lib/logger';
import { runWorker } from '../src/lib/jobs/worker';

const once = process.argv.includes('--once');
const db = createPgDb();
let stop = false;
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { stop = true; log.info('Parando el worker tras la tarea en curso…'); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

do {
  try {
    const r = await runWorker(db, { timeBudgetMs: 55_000 });
    log.info('Pasada del worker', { scheduled: r.scheduled, recovered: r.recovered, processed: r.processed.length, failed: r.processed.filter((p) => !p.ok).length });
    if (!r.processed.length && !once) await sleep(30_000);
  } catch (e) {
    log.error('Error en el worker', { error: e });
    if (!once) await sleep(60_000);
  }
} while (!once && !stop);
await db.close();
