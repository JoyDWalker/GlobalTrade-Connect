import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { isLeadKind, LEAD_KINDS } from '@/lib/services/admin-leads';

export const PUT = api<{ kind: string; id: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  if (!isLeadKind(params.kind)) throw new HttpError(404, 'Listado desconocido');
  const def = LEAD_KINDS[params.kind];
  const { status } = z.object({ status: z.enum(def.statuses as unknown as [string, ...string[]]) }).parse(await readJson(req));
  const db = getDb();
  const extra = params.kind === 'privacy' ? ", resolved_at = CASE WHEN $2 = 'new' THEN NULL ELSE now() END, resolved_by = $3" : '';
  const r = await db.query(`UPDATE ${def.table} SET status = $2${extra} WHERE id = $1`, params.kind === 'privacy' ? [Number(params.id), status, u.id] : [Number(params.id), status]);
  if (!r.rowCount) throw new HttpError(404, 'No encontrado');
  await audit(db, { id: u.id, email: u.email }, `${params.kind}.status`, { type: params.kind, id: params.id }, { status }, ipHash);
  return { ok: true };
});
