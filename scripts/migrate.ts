// npm run db:migrate [-- --dry-run]
import './load-env';
import { createPgDb } from '../src/lib/db';
import { migrate } from '../src/lib/migrations';

const dryRun = process.argv.includes('--dry-run');
const db = createPgDb();
try {
  const files = await migrate(db, { dryRun, allowDestructive: process.env.ALLOW_DESTRUCTIVE_MIGRATIONS === 'true', log: console.log });
  console.log(files.length ? `${dryRun ? 'Pendientes' : 'Aplicadas'}: ${files.join(', ')}` : 'Esquema al día.');
} catch (e) {
  console.error('Error en migraciones:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
