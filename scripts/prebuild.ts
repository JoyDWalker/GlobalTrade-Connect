// Se ejecuta antes de `next build`. En PRODUCCIÓN aplica las migraciones pendientes (las destructivas se bloquean);
// en previews y desarrollo no toca ninguna base de datos salvo que se pida con MIGRATE_ON_BUILD=true.
// Si una migración falla, el build falla y Vercel mantiene la versión anterior en producción.
import './load-env';
import { createPgDb } from '../src/lib/db';
import { migrate } from '../src/lib/migrations';
import { seedCatalog } from '../src/lib/seed';
import { resolveEnv } from '../src/lib/env-resolve';

const appEnv = process.env.APP_ENV ?? process.env.VERCEL_ENV ?? 'development';
const shouldMigrate = process.env.MIGRATE_ON_BUILD === 'true' || (appEnv === 'production' && process.env.MIGRATE_ON_BUILD !== 'false');
const r = resolveEnv(process.env);
const NETWORK = /ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|ETIMEDOUT|timeout|getaddrinfo/i;

async function run(url: string, lock: boolean) {
  const db = createPgDb(url, { max: 1 });
  try {
    const files = await migrate(db, { lock, allowDestructive: process.env.ALLOW_DESTRUCTIVE_MIGRATIONS === 'true', log: (m) => console.log('[prebuild]', m) });
    await seedCatalog(db); // idempotente: solo añade catálogos que falten
    console.log(`[prebuild] Migraciones aplicadas: ${files.length ? files.join(', ') : 'ninguna'}`);
  } finally {
    await db.close();
  }
}

if (!shouldMigrate || !r.DATABASE_URL) {
  console.log(`[prebuild] Migraciones omitidas (entorno: ${appEnv}${r.DATABASE_URL ? '' : ', sin base de datos configurada'}).`);
} else {
  try {
    await run(r.MIGRATION_DATABASE_URL!, true);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (r.MIGRATION_DATABASE_URL !== r.DATABASE_URL && NETWORK.test(msg)) {
      // La conexión directa puede no estar disponible desde el entorno de build (p. ej. solo IPv6): se usa el pooler
      console.log('[prebuild] Conexión directa no disponible; se reintenta por el pooler.');
      try { await run(r.DATABASE_URL, false); }
      catch (e2) { console.error('[prebuild] ERROR en migraciones: se cancela el despliegue.', (e2 as Error).message); process.exit(1); }
    } else {
      console.error('[prebuild] ERROR en migraciones: se cancela el despliegue.', msg);
      process.exit(1);
    }
  }
}
