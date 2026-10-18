// Migraciones SQL versionadas (db/migrations/NNNN_nombre.sql), con checksum y bloqueo contra
// ejecuciones simultáneas. Las migraciones destructivas exigen confirmación explícita.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Db } from './db';

export const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');
const LOCK_ID = 727274; // pg_advisory_lock

const DESTRUCTIVE = /\b(drop\s+(table|column|schema|type|index)|truncate|delete\s+from|alter\s+table\s+\S+\s+drop)\b/i;

export interface Migration { version: string; file: string; sql: string; checksum: string; destructive: boolean }

/** Quita comentarios para no confundir texto explicativo con sentencias destructivas. */
const stripComments = (sql: string) => sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return fs.readdirSync(dir).filter((f) => /^\d{4}_[\w-]+(\.destructive)?\.sql$/.test(f)).sort().map((file) => {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    return {
      version: file.slice(0, 4), file, sql,
      checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      destructive: DESTRUCTIVE.test(stripComments(sql)),
    };
  });
}

export interface MigrateOptions { dir?: string; allowDestructive?: boolean; dryRun?: boolean; log?: (m: string) => void }

export async function migrate(db: Db, opts: MigrateOptions = {}) {
  const say = opts.log ?? (() => {});
  const migrations = loadMigrations(opts.dir);
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, file text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  await db.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  try {
    const applied = new Map((await db.query<{ version: string; checksum: string; file: string }>(
      'SELECT version, checksum, file FROM schema_migrations')).rows.map((r) => [r.version, r]));
    const pending: Migration[] = [];
    for (const m of migrations) {
      const prev = applied.get(m.version);
      if (prev) {
        if (prev.checksum !== m.checksum) throw new Error(`La migración ${m.file} ya aplicada ha cambiado (checksum distinto). Crea una migración nueva en lugar de editarla.`);
        continue;
      }
      pending.push(m);
    }
    for (const m of pending) {
      if (m.destructive && !(m.file.includes('.destructive.') && opts.allowDestructive)) {
        throw new Error(`La migración ${m.file} contiene operaciones destructivas. Renómbrala a *.destructive.sql, revisa su impacto y ejecútala con ALLOW_DESTRUCTIVE_MIGRATIONS=true.`);
      }
    }
    if (opts.dryRun) return pending.map((m) => m.file);
    for (const m of pending) {
      say(`Aplicando ${m.file}…`);
      await db.tx(async (q) => {
        await q.query(m.sql);
        await q.query('INSERT INTO schema_migrations (version, file, checksum) VALUES ($1,$2,$3)', [m.version, m.file, m.checksum]);
      });
    }
    return pending.map((m) => m.file);
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
  }
}

export async function migrationStatus(db: Db) {
  const files = loadMigrations();
  const rows = await db.query<{ version: string }>('SELECT version FROM schema_migrations').catch(() => ({ rows: [] as { version: string }[] }));
  const done = new Set(rows.rows.map((r) => r.version));
  return { total: files.length, applied: files.filter((f) => done.has(f.version)).length, pending: files.filter((f) => !done.has(f.version)).map((f) => f.file) };
}
