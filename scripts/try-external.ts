// Prueba manual de las fuentes externas reales contra una base en memoria (no toca ninguna base de datos real).
// Uso: node --import tsx scripts/try-external.ts "fabricantes de envases en México"
import { createPgliteDb } from '../src/lib/db-pglite';
import { setDb } from '../src/lib/db';
import { migrate } from '../src/lib/migrations';
import { seedCatalog } from '../src/lib/seed';
import { runExternalSearch } from '../src/lib/search/external';

process.env.APP_SECRET ??= 'local-try-external-secret-local-try-external';
process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_ENV ??= 'development';
const db = await createPgliteDb();
await migrate(db);
await seedCatalog(db);
setDb(db);
for (const query of process.argv.slice(2)) {
  const r = await runExternalSearch(db, { query, actorKey: 'cli', isUser: true });
  console.log(`\n«${query}» → ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
  for (const s of r.sources) console.log(`  ${s.key.padEnd(10)} ${s.status}${s.results ? ` · ${s.results}` : ''}${s.message ? ` · ${s.message}` : ''}`);
  for (const c of r.items.slice(0, 8)) console.log(`   - ${c.name} (${c.country_code ?? '?'}) ${c.domain ?? ''} [${c.sources.join(',')}]`);
}
await db.close();
