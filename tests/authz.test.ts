// Autenticación y autorización: se llaman las rutas reales de la API con distintos usuarios.
import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { freshDb } from './helpers';
import { setTestUser, type SessionUser } from '@/lib/auth/session';
import * as adminStats from '@/app/api/admin/stats/route';
import * as adminUser from '@/app/api/admin/users/[id]/route';
import * as adminActions from '@/app/api/admin/companies/[id]/actions/route';
import * as lists from '@/app/api/lists/route';
import * as listOne from '@/app/api/lists/[id]/route';
import * as listItems from '@/app/api/lists/[id]/items/route';
import * as accountCompany from '@/app/api/account/companies/[id]/route';
import * as companies from '@/app/api/companies/route';
import * as companyOne from '@/app/api/companies/[slug]/route';
import * as cron from '@/app/api/cron/worker/route';

const ORIGIN = 'http://localhost:3000';
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${ORIGIN}${path}`, { method, headers: { host: 'localhost:3000', origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) as Promise<any> });

async function makeUser(db: Awaited<ReturnType<typeof freshDb>>, email: string, role: SessionUser['role'] = 'user'): Promise<SessionUser> {
  const r = await db.query<{ id: string }>("INSERT INTO profiles (id, email, role) VALUES (gen_random_uuid(), $1, $2) RETURNING id", [email, role]);
  return { id: r.rows[0].id, email, full_name: null, role, is_blocked: false, companyIds: [] };
}

afterEach(() => setTestUser(undefined));

describe('autorización en el servidor', () => {
  it('las rutas de administración exigen sesión y rol admin', async () => {
    await freshDb();
    setTestUser(null);
    expect((await adminStats.GET(req('GET', '/api/admin/stats'), ctx())).status).toBe(401);
    const db = await freshDb();
    setTestUser(await makeUser(db, 'u@x.example'));
    expect((await adminStats.GET(req('GET', '/api/admin/stats'), ctx())).status).toBe(403);
    setTestUser(await makeUser(db, 'a@x.example', 'admin'));
    expect((await adminStats.GET(req('GET', '/api/admin/stats'), ctx())).status).toBe(200);
  });

  it('un administrador no puede cambiar su propio rol; los cambios quedan auditados', async () => {
    const db = await freshDb();
    const admin = await makeUser(db, 'a@x.example', 'admin');
    const other = await makeUser(db, 'o@x.example');
    setTestUser(admin);
    expect((await adminUser.PUT(req('PUT', `/api/admin/users/${admin.id}`, { role: 'user' }), ctx({ id: admin.id }))).status).toBe(409);
    expect((await adminUser.PUT(req('PUT', `/api/admin/users/${other.id}`, { role: 'company' }), ctx({ id: other.id }))).status).toBe(200);
    const log = await db.query("SELECT action FROM audit_log WHERE entity_id = $1", [other.id]);
    expect(log.rows[0].action).toBe('user.update');
    // Un usuario normal no puede hacerse administrador
    setTestUser({ ...other, role: 'company' });
    expect((await adminUser.PUT(req('PUT', `/api/admin/users/${other.id}`, { role: 'admin' }), ctx({ id: other.id }))).status).toBe(403);
  });

  it('rechaza mutaciones desde otro origen (CSRF)', async () => {
    const db = await freshDb();
    setTestUser(await makeUser(db, 'a@x.example', 'admin'));
    const r = await adminActions.POST(req('POST', '/api/admin/companies/x/actions', { action: 'publish' }, { origin: 'https://evil.example' }), ctx({ id: 'x' }));
    expect(r.status).toBe(403);
  });

  it('cada usuario solo accede a sus listas', async () => {
    const db = await freshDb({ demo: true });
    const a = await makeUser(db, 'a@x.example');
    const b = await makeUser(db, 'b@x.example');
    const company = (await db.query("SELECT id FROM companies WHERE record_status = 'published' LIMIT 1")).rows[0].id;
    setTestUser(a);
    const created = await (await lists.POST(req('POST', '/api/lists', { name: 'Proveedores café' }), ctx())).json();
    expect((await listItems.POST(req('POST', `/api/lists/${created.id}/items`, { companyIds: [company] }), ctx({ id: created.id }))).status).toBe(200);
    expect((await (await listOne.GET(req('GET', `/api/lists/${created.id}`), ctx({ id: created.id }))).json()).items).toHaveLength(1);
    setTestUser(b);
    expect((await listOne.GET(req('GET', `/api/lists/${created.id}`), ctx({ id: created.id }))).status).toBe(404);
    expect((await listItems.POST(req('POST', `/api/lists/${created.id}/items`, { companyIds: [company] }), ctx({ id: created.id }))).status).toBe(404);
    expect((await (await lists.GET(req('GET', '/api/lists'), ctx())).json()).lists.map((l: any) => l.name)).toEqual(['Favoritos']);
  });

  it('solo el titular o un admin puede editar una empresa', async () => {
    const db = await freshDb({ demo: true });
    const c = (await db.query("SELECT id FROM companies LIMIT 1")).rows[0].id;
    const owner = await makeUser(db, 'owner@x.example', 'company');
    await db.query('INSERT INTO company_members (company_id, user_id) VALUES ($1, $2)', [c, owner.id]);
    setTestUser(await makeUser(db, 'intruso@x.example', 'company'));
    expect((await accountCompany.GET(req('GET', `/api/account/companies/${c}`), ctx({ id: c }))).status).toBe(403);
    setTestUser({ ...owner, companyIds: [c] });
    const r = await accountCompany.GET(req('GET', `/api/account/companies/${c}`), ctx({ id: c }));
    expect(r.status).toBe(200);
    expect((await r.json()).company.tax_id).toBeTruthy();          // el titular ve sus datos privados
  });

  it('el cron exige el secreto', async () => {
    await freshDb();
    process.env.CRON_SECRET = 'cron-secret-for-tests';
    const { resetEnvCache } = await import('@/lib/env');
    resetEnvCache();
    expect((await cron.GET(req('GET', '/api/cron/worker'))).status).toBe(401);
    expect((await cron.GET(req('GET', '/api/cron/worker', undefined, { authorization: 'Bearer otro' }))).status).toBe(401);
    expect((await cron.GET(req('GET', '/api/cron/worker', undefined, { authorization: 'Bearer cron-secret-for-tests' }))).status).toBe(200);
  });
});

describe('visibilidad pública', () => {
  it('un visitante busca sin sesión y no ve fichas pendientes ni datos privados', async () => {
    const db = await freshDb({ demo: true });
    setTestUser(null);
    const r = await (await companies.GET(req('GET', '/api/companies?q=cafe'), ctx())).json();
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.every((c: any) => ['published', 'detected'].includes(c.record_status))).toBe(true);
    const pending = (await db.query("SELECT slug FROM companies WHERE record_status = 'pending_review' LIMIT 1")).rows[0].slug;
    expect((await companyOne.GET(req('GET', `/api/companies/${pending}`), ctx({ slug: pending }))).status).toBe(404);
    const pub = (await db.query("SELECT slug FROM companies WHERE record_status = 'published' LIMIT 1")).rows[0].slug;
    const detail = await (await companyOne.GET(req('GET', `/api/companies/${pub}`), ctx({ slug: pub }))).json();
    expect(detail.company.tax_id).toBeUndefined();
    expect(detail.company.sources.length).toBeGreaterThan(0);          // procedencia visible
  });

  it('la exportación pública respeta filtros y visibilidad', async () => {
    const db = await freshDb({ demo: true });
    setTestUser(null);
    const csv = await (await companies.GET(req('GET', '/api/companies?country=CH&format=csv'), ctx())).text();
    const lines = csv.trim().split('\r\n');
    const visibleCH = (await db.query("SELECT count(*)::int AS n FROM companies WHERE country_code = 'CH' AND record_status = 'published'")).rows[0].n;
    expect(lines.length - 1).toBe(visibleCH);
    expect(csv).not.toContain('Léman Coffee Roasters');                // pendiente de revisión
    expect(csv).not.toContain('DEMO-CH');                              // NIF nunca en exportación pública
    const pendingId = (await db.query("SELECT id FROM companies WHERE record_status = 'pending_review' LIMIT 1")).rows[0].id;
    const sel = await companies.POST(req('POST', '/api/companies', { ids: [pendingId], format: 'csv' }), ctx());
    expect(sel.status).toBe(404);
  });
});

describe('propietario de la aplicación', () => {
  it('recibe el rol de administrador al entrar con su correo confirmado; nadie más', async () => {
    const { ensureOwnerAdmin } = await import('@/lib/auth/session');
    const db = await freshDb();
    const owner = await makeUser(db, 'JoyD.Walker2@gmail.com');
    expect((await ensureOwnerAdmin(db, owner, false)).role).toBe('user');          // correo sin confirmar: no
    expect((await ensureOwnerAdmin(db, owner, true)).role).toBe('admin');
    expect((await db.query('SELECT role FROM profiles WHERE id = $1', [owner.id])).rows[0].role).toBe('admin');
    expect((await db.query("SELECT action FROM audit_log WHERE entity_id = $1", [owner.id])).rows[0].action).toBe('user.grant_admin_owner');
    const other = await makeUser(db, 'otra@x.example');
    expect((await ensureOwnerAdmin(db, other, true)).role).toBe('user');
  });
});
