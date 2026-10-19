import { createPgliteDb } from '@/lib/db-pglite';
import { setDb } from '@/lib/db';
import { migrate } from '@/lib/migrations';
import { seedCatalog, seedDemo } from '@/lib/seed';

let previous: Awaited<ReturnType<typeof createPgliteDb>> | null = null;

/** Base de datos PostgreSQL limpia (en memoria) con migraciones y catálogos aplicados. Cierra la anterior. */
export async function freshDb({ demo = false } = {}) {
  if (previous) await previous.close().catch(() => {});
  const db = await createPgliteDb();
  previous = db;
  await migrate(db);
  await seedCatalog(db);
  if (demo) await seedDemo(db, 'test');
  setDb(db);
  return db;
}
