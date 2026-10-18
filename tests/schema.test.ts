import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { migrate, loadMigrations } from '@/lib/migrations';
import { searchCompanies } from '@/lib/services/companies';
import { searchParamsFromUrl } from '@/lib/validation';

describe('migraciones y datos', () => {
  it('aplica las migraciones y es idempotente', async () => {
    const db = await freshDb();
    expect(await migrate(db)).toEqual([]);
    const n = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n;
    expect(n).toBe(loadMigrations().length);
    const countries = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM countries')).rows[0].n;
    expect(countries).toBeGreaterThan(240);
  });

  it('activa RLS en todas las tablas públicas', async () => {
    const db = await freshDb();
    const rows = (await db.query<{ tablename: string; rowsecurity: boolean }>("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'")).rows;
    expect(rows.filter((r) => !r.rowsecurity).map((r) => r.tablename)).toEqual([]);
  });

  it('carga la demo y la búsqueda encuentra por texto, país y tipo', async () => {
    const db = await freshDb({ demo: true });
    const all = await searchCompanies(db, searchParamsFromUrl(new URLSearchParams('')));
    expect(all.total).toBe(22);   // 24 de demo, 2 pendientes de revisión no son públicas
    const r = await searchCompanies(db, searchParamsFromUrl(new URLSearchParams('q=exportadores de café verde en Colombia')));
    expect(r.interpreted.countries).toEqual(['CO']);
    expect(r.interpreted.types).toEqual(['exportador']);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((c) => c.country_code === 'CO')).toBe(true);
  });
});
