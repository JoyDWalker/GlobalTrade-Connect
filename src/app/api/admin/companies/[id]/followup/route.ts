// Seguimiento comercial privado de una empresa (solo administradores).
import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb, one } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { followupInput, getFollowup, saveFollowup } from '@/lib/services/followups';

export const dynamic = 'force-dynamic';
const uuid = z.string().uuid();

async function companyOr404(id: string) {
  if (!(await one(getDb(), 'SELECT 1 FROM companies WHERE id = $1 AND deleted_at IS NULL', [id]))) throw new HttpError(404, 'Empresa no encontrada');
}

export const GET = api<{ id: string }>(async ({ params }) => {
  await requireAdmin();
  const id = uuid.parse(params.id);
  await companyOr404(id);
  return getFollowup(getDb(), id);
});

export const PUT = api<{ id: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const id = uuid.parse(params.id);
  await companyOr404(id);
  const input = followupInput.parse(await readJson(req));
  const db = getDb();
  await saveFollowup(db, id, input, u.id);
  await audit(db, { id: u.id, email: u.email }, 'followup.update', { type: 'company', id }, { status: input.status }, ipHash);
  return getFollowup(db, id);
});
