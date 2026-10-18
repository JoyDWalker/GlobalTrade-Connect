// npm run db:seed [-- --demo]
// Catálogos (idempotente) y, opcionalmente, empresas ficticias de demostración (bloqueado en producción).
import './load-env';
import { createPgDb } from '../src/lib/db';
import { env } from '../src/lib/env';
import { seedCatalog, seedDemo } from '../src/lib/seed';

const db = createPgDb();
try {
  await seedCatalog(db);
  console.log('Catálogos cargados.');
  if (process.argv.includes('--demo')) console.log(`Empresas de demostración creadas: ${await seedDemo(db, env().APP_ENV)}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
