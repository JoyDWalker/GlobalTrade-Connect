// Acceso a PostgreSQL. Producción: node-postgres con TLS. Pruebas: PGlite con la misma interfaz.
import pg from 'pg';
import { env } from './env';
import { log } from './logger';

export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface Queryable {
  query<T = Record<string, any>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Atajos sobre cualquier Queryable. */
export async function many<T = Record<string, any>>(q: Queryable, text: string, params: unknown[] = []) {
  return (await q.query<T>(text, params)).rows;
}
export async function one<T = Record<string, any>>(q: Queryable, text: string, params: unknown[] = []) {
  return (await q.query<T>(text, params)).rows[0] ?? null;
}

function sslConfig(): pg.PoolConfig['ssl'] {
  const e = env();
  if (e.DATABASE_SSL === 'disable') return false;
  if (e.DATABASE_SSL === 'verify-full' || e.DATABASE_CA_CERT) {
    return { rejectUnauthorized: true, ca: e.DATABASE_CA_CERT?.replace(/\\n/g, '\n') };
  }
  // 'require': conexión cifrada sin verificar la cadena del certificado (añade DATABASE_CA_CERT para verificarla)
  return { rejectUnauthorized: false };
}

export function createPgDb(connectionString = env().DATABASE_URL, opts: { max?: number } = {}): Db {
  const url = new URL(connectionString);
  url.search = '';   // sslmode, supa, pgbouncer…: el TLS se configura de forma explícita abajo
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: sslConfig(),
    max: opts.max ?? env().DB_POOL_MAX,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 15_000,
    application_name: 'globaltrade-connect',
  });
  pool.on('error', (e) => log.error('Error en el pool de PostgreSQL', { error: e }));
  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    async query<T>(text: string, params: unknown[] = []) {
      const r = await c.query(text, params as any[]);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
  });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// Instancia única por proceso (sobrevive a la recarga en caliente de Next.js en desarrollo)
const g = globalThis as unknown as { __gtcDb?: Db };
let override: Db | null = null;

export function getDb(): Db {
  if (override) return override;
  g.__gtcDb ??= createPgDb();
  return g.__gtcDb;
}

/** Permite inyectar otra base de datos (PGlite en pruebas). */
export function setDb(db: Db | null) { override = db; }
