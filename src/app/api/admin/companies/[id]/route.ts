import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { companyDetail, saveCompany, setCompanyStatus, softDeleteCompany } from '@/lib/services/companies';
import { adminCompanyExtras, companyInputSchema } from '@/lib/validation';
import { invalidateMeta } from '@/lib/meta';

export const dynamic = 'force-dynamic';
const uuid = z.string().uuid();

export const GET = api<{ id: string }>(async ({ params }) => {
  await requireAdmin();
  const db = getDb();
  const id = uuid.parse(params.id);
  const c = await companyDetail(db, { id }, { privateView: true });
  if (!c) throw new HttpError(404, 'Empresa no encontrada');
  const [members, tasks, inquiries] = await Promise.all([
    many(db, 'SELECT p.id, p.email, p.full_name, m.role FROM company_members m JOIN profiles p ON p.id = m.user_id WHERE m.company_id = $1', [id]),
    many(db, "SELECT id, kind, status, priority, details, created_at, resolution FROM review_tasks WHERE company_id = $1 ORDER BY status = 'open' DESC, created_at DESC LIMIT 30", [id]),
    many(db, 'SELECT count(*)::int AS n FROM inquiries WHERE company_id = $1', [id]),
  ]);
  return { company: c, members, tasks, inquiries: inquiries[0]?.n ?? 0 };
});

export const PUT = api<{ id: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const id = uuid.parse(params.id);
  const body = await readJson(req);
  const input = companyInputSchema.parse(body);
  const extras = adminCompanyExtras.parse(body);
  const db = getDb();
  await db.tx(async (q) => {
    await saveCompany(q, input, { id, actorId: u.id, changeSource: 'admin' });
    await setCompanyStatus(q, id, extras, u.id);
    await audit(q, { id: u.id, email: u.email }, 'company.update', { type: 'company', id }, { fields: Object.keys(body) }, ipHash);
  });
  invalidateMeta();
  return { company: await companyDetail(db, { id }, { privateView: true }) };
});

/** Borrado lógico (recuperable). Los leads e historial se conservan. */
export const DELETE = api<{ id: string }>(async ({ params, ipHash }) => {
  const u = await requireAdmin();
  const id = uuid.parse(params.id);
  const db = getDb();
  const ok = await db.tx(async (q) => {
    const done = await softDeleteCompany(q, id, u.id);
    if (done) await audit(q, { id: u.id, email: u.email }, 'company.delete', { type: 'company', id }, {}, ipHash);
    return done;
  });
  if (!ok) throw new HttpError(404, 'Empresa no encontrada');
  invalidateMeta();
  return { ok: true };
});
