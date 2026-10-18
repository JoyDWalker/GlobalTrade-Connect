// Edición de la ficha por su titular. Los cambios quedan registrados y pasan a revisión.
import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb, one } from '@/lib/db';
import { requireCompanyAccess } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { companyDetail, saveCompany } from '@/lib/services/companies';
import { companyInputSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
const uuid = z.string().uuid();

export const GET = api<{ id: string }>(async ({ params }) => {
  const id = uuid.parse(params.id);
  await requireCompanyAccess(id);
  const c = await companyDetail(getDb(), { id }, { privateView: true });
  if (!c || c.deleted_at) throw new HttpError(404, 'Empresa no encontrada');
  return { company: c };
});

export const PUT = api<{ id: string }>(async ({ req, params, ipHash }) => {
  const id = uuid.parse(params.id);
  const u = await requireCompanyAccess(id);
  const input = companyInputSchema.parse(await readJson(req));
  const db = getDb();
  await db.tx(async (q) => {
    const before = await one<{ record_status: string; name: string; website: string | null; tax_id: string | null; verification_level: string }>(q,
      'SELECT record_status, name, website, tax_id, verification_level FROM companies WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!before) throw new HttpError(404, 'Empresa no encontrada');
    if (before.record_status === 'hidden' && u.role !== 'admin') throw new HttpError(403, 'Esta ficha está oculta por el equipo. Contacta con soporte.');
    // Cambiar datos de identidad invalida la verificación previa hasta nueva revisión
    const identityChanged = before.name !== input.name || (before.website ?? null) !== (input.website ?? null) || (before.tax_id ?? null) !== (input.tax_id ?? null);
    const extra: Record<string, unknown> = {};
    if (before.record_status === 'rejected') extra.record_status = 'pending_review';
    if (identityChanged && before.verification_level !== 'none') { extra.verification_level = 'none'; extra.verification_method = null; }
    await saveCompany(q, input, { id, actorId: u.id, changeSource: 'owner', extra });
    await q.query(`INSERT INTO review_tasks (company_id, kind, priority, details, dedupe_key, requested_by) VALUES ($1, 'owner_update', 40, $2, $3, $4)
      ON CONFLICT (dedupe_key) WHERE status = 'open' AND dedupe_key IS NOT NULL DO NOTHING`, [id, JSON.stringify({ identityChanged }), `owner_update:${id}`, u.id]);
    await audit(q, { id: u.id, email: u.email }, 'company.update_by_owner', { type: 'company', id }, { identityChanged }, ipHash);
  });
  return { company: await companyDetail(db, { id }, { privateView: true }) };
});
