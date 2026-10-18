// Cambio de rol o bloqueo. Solo un administrador puede hacerlo y nunca sobre sí mismo.
import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb, one } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';

export const PUT = api<{ id: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const id = z.string().uuid().parse(params.id);
  const body = z.object({ role: z.enum(['user', 'company', 'admin']).optional(), is_blocked: z.boolean().optional() }).parse(await readJson(req));
  if (id === u.id) throw new HttpError(409, 'No puedes cambiar tu propio rol ni bloquearte');
  const db = getDb();
  const before = await one<{ role: string; is_blocked: boolean; email: string }>(db, 'SELECT role, is_blocked, email FROM profiles WHERE id = $1', [id]);
  if (!before) throw new HttpError(404, 'Usuario no encontrado');
  await db.query('UPDATE profiles SET role = coalesce($2, role), is_blocked = coalesce($3, is_blocked) WHERE id = $1', [id, body.role ?? null, body.is_blocked ?? null]);
  await audit(db, { id: u.id, email: u.email }, 'user.update', { type: 'user', id }, { before: { role: before.role, is_blocked: before.is_blocked }, after: body }, ipHash);
  return { ok: true };
});
