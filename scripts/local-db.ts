// PostgreSQL local sin Docker (PGlite) en el puerto 54329, con datos persistentes en ./.pglite
// Uso: npm run db:local   (y en otra terminal: npm run db:migrate && npm run db:seed -- --demo && npm run dev)
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.LOCAL_DB_PORT ?? 54329);
const db = await PGlite.create('./.pglite');
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 } as any);
await server.start();
console.log(`PostgreSQL local (PGlite) en postgres://postgres@127.0.0.1:${port}/postgres`);
console.log(`En .env.local: DATABASE_URL=postgres://postgres@127.0.0.1:${port}/postgres  DATABASE_SSL=disable  DB_POOL_MAX=1`);
for (const s of ['SIGINT', 'SIGTERM'] as const) {
  process.on(s, async () => { await server.stop(); await db.close(); process.exit(0); });
}
