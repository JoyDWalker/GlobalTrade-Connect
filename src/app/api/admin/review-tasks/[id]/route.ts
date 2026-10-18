import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';

export const PUT = api<{ id: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const body = z.object({ status: z.enum(['open', 'resolved', 'dismissed']), resolution: z.string().trim().max(500).optional().nullable() }).parse(await readJson(req));
  const db = getDb();
  const r = await db.query(`UPDATE review_tasks SET status = $2, resolution = $3, resolved_by = CASE WHEN $2 = 'open' THEN NULL ELSE $4::uuid END,
    resolved_at = CASE WHEN $2 = 'open' THEN NULL ELSE now() END WHERE id = $1`, [Number(params.id), body.status, body.resolution ?? null, u.id]);
  if (!r.rowCount) throw new HttpError(404, 'Tarea no encontrada');
  await audit(db, { id: u.id, email: u.email }, 'review_task.update', { type: 'review_task', id: params.id }, body, ipHash);
  return { ok: true };
});
