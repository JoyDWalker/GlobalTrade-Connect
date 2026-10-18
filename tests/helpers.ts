import { createPgliteDb } from '@/lib/db-pglite';
import { setDb } from '@/lib/db';
import { migrate } from '@/lib/migrations';
import { seedCatalog, seedDemo } from '@/lib/seed';

/** Base de datos PostgreSQL limpia (en memoria) con migraciones y catálogos aplicados. */
export async function freshDb({ demo = false } = {}) {
  const db = await createPgliteDb();
  await migrate(db);
  await seedCatalog(db);
  if (demo) await seedDemo(db, 'test');
  setDb(db);
  return db;
}
