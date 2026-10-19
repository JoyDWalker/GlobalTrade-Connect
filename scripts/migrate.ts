// npm run db:migrate [-- --dry-run]
import './load-env';
import { createPgDb } from '../src/lib/db';
import { migrate } from '../src/lib/migrations';
import { resolveEnv } from '../src/lib/env-resolve';

const dryRun = process.argv.includes('--dry-run');
const db = createPgDb(resolveEnv(process.env).MIGRATION_DATABASE_URL, { max: 1 });
try {
  const files = await migrate(db, { dryRun, allowDestructive: process.env.ALLOW_DESTRUCTIVE_MIGRATIONS === 'true', log: console.log });
  console.log(files.length ? `${dryRun ? 'Pendientes' : 'Aplicadas'}: ${files.join(', ')}` : 'Esquema al día.');
} catch (e) {
  console.error('Error en migraciones:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
