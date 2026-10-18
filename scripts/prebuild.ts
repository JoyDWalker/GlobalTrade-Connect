// Se ejecuta antes de `next build`. En PRODUCCIÓN aplica las migraciones pendientes (las destructivas se bloquean);
// en previews y desarrollo no toca ninguna base de datos salvo que se pida con MIGRATE_ON_BUILD=true.
// Si una migración falla, el build falla y Vercel mantiene la versión anterior en producción.
import './load-env';
import { createPgDb } from '../src/lib/db';
import { migrate } from '../src/lib/migrations';
import { seedCatalog } from '../src/lib/seed';

const appEnv = process.env.APP_ENV ?? process.env.VERCEL_ENV ?? 'development';
const shouldMigrate = process.env.MIGRATE_ON_BUILD === 'true' || (appEnv === 'production' && process.env.MIGRATE_ON_BUILD !== 'false');

if (!shouldMigrate || !process.env.DATABASE_URL) {
  console.log(`[prebuild] Migraciones omitidas (entorno: ${appEnv}).`);
} else {
  const db = createPgDb();
  try {
    const files = await migrate(db, { allowDestructive: process.env.ALLOW_DESTRUCTIVE_MIGRATIONS === 'true', log: (m) => console.log('[prebuild]', m) });
    await seedCatalog(db); // idempotente: solo añade catálogos que falten
    console.log(`[prebuild] Migraciones aplicadas: ${files.length ? files.join(', ') : 'ninguna'}`);
  } catch (e) {
    console.error('[prebuild] ERROR en migraciones: se cancela el despliegue.', (e as Error).message);
    process.exit(1);
  } finally {
    await db.close();
  }
}
