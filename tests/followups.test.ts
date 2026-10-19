// Seguimiento comercial privado y búsqueda externa reservada a administradores.
import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { freshDb } from './helpers';
import { setTestUser, type SessionUser } from '@/lib/auth/session';
import * as followup from '@/app/api/admin/companies/[id]/followup/route';
import * as notes from '@/app/api/admin/companies/[id]/notes/route';
import * as noteOne from '@/app/api/admin/companies/[id]/notes/[noteId]/route';
import * as followups from '@/app/api/admin/followups/route';
import * as exportRoute from '@/app/api/admin/export/[entity]/route';
import * as external from '@/app/api/search/external/route';
import { performSearch } from '@/lib/search';
import { searchParamsFromUrl } from '@/lib/validation';

const ORIGIN = 'http://localhost:3000';
const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`${ORIGIN}${path}`, { method, headers: { host: 'localhost:3000', origin: ORIGIN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) as Promise<any> });
async function makeUser(db: any, email: string, role: SessionUser['role'] = 'user'): Promise<SessionUser> {
  const r = await db.query("INSERT INTO profiles (id, email, role) VALUES (gen_random_uuid(), $1, $2) RETURNING id", [email, role]);
  return { id: r.rows[0].id, email, full_name: null, role, is_blocked: false, companyIds: [] };
}
afterEach(() => setTestUser(undefined));

describe('estadísticas de consultas', () => {
  it('muestra la consulta como se escribió, no la raíz interna', async () => {
    const db = await freshDb();
    const { adminStats } = await import('@/lib/services/admin');
    for (const q of ['envases compostables', 'Envases compostables', ' ENVASES COMPOSTABLES ']) await performSearch(db, searchParamsFromUrl(new URLSearchParams({ q })), { user: null, ipHash: 'x' });
    const top = (await adminStats(db)).topQueries;
    expect(top[0]).toMatchObject({ query: 'envases compostables', n: 3 });
  });
});

describe('seguimiento comercial', () => {
  it('solo el administrador accede; guarda estado, etiquetas, próxima acción y notas', async () => {
    const db = await freshDb({ demo: true });
    const c = (await db.query("SELECT id, name FROM companies WHERE record_status = 'published' ORDER BY name LIMIT 1")).rows[0];
    setTestUser(await makeUser(db, 'u@x.example'));
    expect((await followup.GET(req('GET', `/api/admin/companies/${c.id}/followup`), ctx({ id: c.id }))).status).toBe(403);

    setTestUser(await makeUser(db, 'a@x.example', 'admin'));
    let r = await (await followup.GET(req('GET', '/'), ctx({ id: c.id }))).json();
    expect(r).toEqual({ followup: null, notes: [] });

    r = await (await followup.PUT(req('PUT', '/', { status: 'pendiente', tags: ['Importador', 'importador', 'feria'], next_action: 'Llamar', next_action_at: '2020-01-01' }), ctx({ id: c.id }))).json();
    expect(r.followup).toMatchObject({ status: 'pendiente', tags: ['importador', 'feria'], next_action: 'Llamar', next_action_at: '2020-01-01' });

    // Una llamada cuenta como contacto: pasa de pendiente a contactado
    r = await (await notes.POST(req('POST', '/', { kind: 'llamada', body: 'Hablé con compras; enviar catálogo' }), ctx({ id: c.id }))).json();
    expect(r.followup.status).toBe('contactado');
    expect(r.followup.last_contact_at).toBeTruthy();
    expect(r.notes[0]).toMatchObject({ kind: 'llamada', body: 'Hablé con compras; enviar catálogo', author: 'a@x.example' });

    const list = await (await followups.GET(req('GET', '/api/admin/followups?due=1&tag=feria'), ctx())).json();
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ name: c.name, status: 'contactado', last_note: 'Hablé con compras; enviar catálogo' });
    expect(list.tags).toEqual(['feria', 'importador']);

    const csv = await (await exportRoute.GET(req('GET', '/api/admin/export/followups?format=csv'), ctx({ entity: 'followups' }))).text();
    expect(csv).toContain(c.name);
    expect(csv).toContain('Contactado');

    r = await (await noteOne.DELETE(req('DELETE', '/'), ctx({ id: c.id, noteId: String(r.notes[0].id) }))).json();
    expect(r.notes).toEqual([]);
    expect((await followup.PUT(req('PUT', '/', { status: 'inventado', tags: [] }), ctx({ id: c.id }))).status).toBe(422);
  });

  it('la búsqueda en fuentes externas está reservada a administradores', async () => {
    const db = await freshDb();
    setTestUser(null);
    expect((await external.POST(req('POST', '/api/search/external', { q: 'dulces' }), ctx())).status).toBe(403);
    setTestUser(await makeUser(db, 'u2@x.example'));
    expect((await external.POST(req('POST', '/api/search/external', { q: 'dulces' }), ctx())).status).toBe(403);
    const visitor = await performSearch(db, searchParamsFromUrl(new URLSearchParams('q=dulces')), { user: null, ipHash: 'x' });
    expect(visitor.suggestExternal).toBe(false);
    expect(visitor.canExternal).toBe(false);
    setTestUser(await makeUser(db, 'a2@x.example', 'admin'));
    await db.query('UPDATE sources SET enabled = false');   // sin llamadas reales a Internet en las pruebas
    expect((await external.POST(req('POST', '/api/search/external', { q: 'dulces' }), ctx())).status).toBe(200);
  });
});
