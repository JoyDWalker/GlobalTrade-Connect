// PostgreSQL embebido (PGlite) para pruebas automatizadas y desarrollo local sin Docker.
// No se usa en producción.
import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from './db';

function wrap(pg: Pick<PGlite, 'query' | 'exec'>): Queryable {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      if (!params.length && /;\s*\S/.test(text.trim().replace(/;\s*$/, ''))) {
        // Varias sentencias (migraciones): protocolo simple
        const results = await pg.exec(text);
        const last = results[results.length - 1];
        return { rows: (last?.rows ?? []) as T[], rowCount: last?.affectedRows ?? 0 };
      }
      const r = await pg.query<T>(text, params as any[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  };
}

export async function createPgliteDb(dataDir?: string): Promise<Db & { pg: PGlite }> {
  const pg = await PGlite.create(dataDir);
  const base = wrap(pg);
  return {
    pg,
    ...base,
    async tx(fn) {
      return pg.transaction(async (t) => fn(wrap(t as any)));
    },
    close: () => pg.close(),
  };
}
