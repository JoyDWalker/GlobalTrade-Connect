import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers';
import { bulkSource, HANDLERS } from '@/lib/jobs/worker';
import { companiesQuery, parseCompanies } from '@/lib/sources/wikidata-bulk';
import { SourceError } from '@/lib/sources/http';
import { NextRequest } from 'next/server';
import { setTestUser } from '@/lib/auth/session';
import * as runRoute from '@/app/api/admin/run/route';

const original = { ...bulkSource };
afterEach(() => Object.assign(bulkSource, original));
const run = (db: any) => HANDLERS.import_wikidata({ db, job: {} as any, deadline: Date.now() + 30_000 });

const binding = (n: number, name: string, extra: Record<string, string> = {}) => ({
  item: { value: `http://www.wikidata.org/entity/Q${n}` }, n: { value: String(n) }, name: { value: name },
  website: { value: `https://www.${name.toLowerCase().replace(/[^a-z]/g, '')}.example/` }, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v }])),
});

describe('importación automática desde Wikidata', () => {
  it('interpreta la respuesta y descarta elementos sin nombre real o sin web', () => {
    const r = parseCompanies({ results: { bindings: [
      binding(10, 'Chocolates Valor', { mail: 'mailto:Info@Valor.es', tel: '+34 965 000 000', industry: 'industria del chocolate', city: 'Villajoyosa', desc: 'empresa española' }),
      { ...binding(11, 'Q11') },
      { n: { value: '12' }, name: { value: 'Sin web' } },
    ] } }, 'ES');
    expect(r.rows).toBe(3);
    expect(r.lastKey).toBe(12);
    expect(r.hits).toEqual([expect.objectContaining({
      externalId: 'wikidata:Q10', name: 'Chocolates Valor', domain: 'chocolatesvalor.example', email: 'info@valor.es', phone: '+34 965 000 000',
      countryCode: 'ES', city: 'Villajoyosa', snippet: 'industria del chocolate — empresa española',
    })]);
    const q = companiesQuery('ES', 500, 200);
    expect(q).toContain('wdt:P297 "ES"');
    expect(q).toContain('FILTER(?n > 500)');
    expect(q).toContain('LIMIT 200');
  });

  it('importa por tandas, continúa donde se quedó, sin tareas de revisión y respeta el tope', async () => {
    const db = await freshDb();
    await db.query("UPDATE countries SET is_priority = (iso_code = 'ES')");
    const page = vi.fn(async (iso: string, after: number, limit: number) => {
      const all = [binding(5, 'Aceites Uno'), binding(8, 'Conservas Dos', { tel: '+34 965 111 222' }), binding(9, 'Vinos Tres')].filter((b) => Number(b.n.value) > after).slice(0, limit);
      return { ...parseCompanies({ results: { bindings: all } }, iso), httpStatus: 200, attempts: 1 };
    });
    Object.assign(bulkSource, { page });
    await db.query(`UPDATE app_settings SET value = value || '{"batch_size": 2}'::jsonb WHERE key = 'bulk_import'`);

    expect(await run(db)).toEqual({ country: 'ES', fetched: 2, created: 2, finished: false });
    expect(page).toHaveBeenLastCalledWith('ES', 0, 2, expect.any(Number));
    expect(await run(db)).toEqual({ country: 'ES', fetched: 1, created: 1, finished: true });
    expect(page).toHaveBeenLastCalledWith('ES', 8, 2, expect.any(Number));
    const companies = (await db.query("SELECT name, phone, record_status, country_code FROM companies ORDER BY name")).rows;
    expect(companies).toEqual([
      { name: 'Aceites Uno', phone: null, record_status: 'detected', country_code: 'ES' },
      { name: 'Conservas Dos', phone: '+34 965 111 222', record_status: 'detected', country_code: 'ES' },
      { name: 'Vinos Tres', phone: null, record_status: 'detected', country_code: 'ES' },
    ]);
    expect((await db.query('SELECT count(*)::int AS n FROM review_tasks')).rows[0].n).toBe(0);
    const cursor = (await db.query("SELECT last_key::int AS last_key, done, imported FROM import_cursors WHERE country_code = 'ES'")).rows[0];
    expect(cursor).toEqual({ last_key: 9, done: true, imported: 3 });

    // La búsqueda de contactos las programa a ritmo controlado
    expect(await HANDLERS.fill_contacts({ db, job: {} as any, deadline: Date.now() + 10_000 })).toEqual({ queued: 3 });

    await db.query(`UPDATE app_settings SET value = value || '{"max_companies": 3}'::jsonb WHERE key = 'bulk_import'`);
    expect(await run(db)).toEqual({ skipped: 'tope de 3 empresas alcanzado' });
  });

  it('si un país falla tres veces seguidas pasa al siguiente', async () => {
    const db = await freshDb();
    await db.query("UPDATE countries SET is_priority = (iso_code = 'US')");
    Object.assign(bulkSource, { page: vi.fn(async () => { throw new SourceError('timeout', 'Tiempo de espera agotado'); }) });
    for (let i = 0; i < 3; i++) expect(await run(db)).toMatchObject({ country: 'US', error: 'Tiempo de espera agotado' });
    expect((await db.query("SELECT done, failures FROM import_cursors WHERE country_code = 'US'")).rows[0]).toEqual({ done: true, failures: 3 });
    expect(await run(db)).toMatchObject({ error: 'Tiempo de espera agotado' });
    expect((await run(db) as any).country).not.toBe('US');
  });

  it('la importación continua desde el panel solo la usa el administrador e importa en cada ronda', async () => {
    const db = await freshDb();
    await db.query("UPDATE countries SET is_priority = (iso_code = 'ES')");
    Object.assign(bulkSource, { page: vi.fn(async (iso: string) => ({ ...parseCompanies({ results: { bindings: [binding(5, 'Aceites Uno', { tel: '+34 965 111 222' })] } }, iso), httpStatus: 200, attempts: 1 })) });
    const req = () => new NextRequest('http://localhost:3000/api/admin/run', { method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: '{}' });
    const ctx = { params: Promise.resolve({}) as Promise<any> };
    setTestUser(null);
    expect((await runRoute.POST(req(), ctx)).status).toBe(401);
    const r = await db.query("INSERT INTO profiles (id, email, role) VALUES (gen_random_uuid(), 'a@x.example', 'admin') RETURNING id");
    setTestUser({ id: r.rows[0].id, email: 'a@x.example', full_name: null, role: 'admin', is_blocked: false, companyIds: [] });
    const res = await (await runRoute.POST(req(), ctx)).json();
    setTestUser(undefined);
    expect(res).toMatchObject({ total: 1, contactable: 1 });
    expect(res.imported).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe('consultas de importación', () => {
  it('excluyen entidades que no son proveedores (y sus subtipos) y piden lo necesario', async () => {
    const { qleverQuery, EXCLUDED_TYPES } = await import('@/lib/sources/wikidata-bulk');
    const q = qleverQuery('ES', 42, 200);
    expect(q).toContain('wdt:P297 "ES"');
    expect(q).toContain('FILTER(?n > 42)');
    expect(q).toContain('MINUS { ?item wdt:P31/wdt:P279* ?badType');
    expect(EXCLUDED_TYPES).toContain('Q847017');           // club deportivo
    expect(EXCLUDED_TYPES).not.toContain('Q48204');        // "asociación": se conservan las cooperativas
  });

  it('un límite de peticiones de la fuente no cuenta como fallo del país', async () => {
    const db = await freshDb();
    await db.query("UPDATE countries SET is_priority = (iso_code = 'DE')");
    Object.assign(bulkSource, { page: vi.fn(async () => { throw new SourceError('rate_limited', 'QLever: límite de peticiones alcanzado', 429); }) });
    expect(await run(db)).toEqual({ country: 'DE', retryLater: 'QLever: límite de peticiones alcanzado' });
    expect((await db.query("SELECT done, failures FROM import_cursors WHERE country_code = 'DE'")).rows[0]).toEqual({ done: false, failures: 0 });
  });
});
