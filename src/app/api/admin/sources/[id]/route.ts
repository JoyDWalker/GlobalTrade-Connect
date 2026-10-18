import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';

export const PUT = api<{ id: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const body = z.object({
    enabled: z.boolean(),
    daily_quota: z.coerce.number().int().min(0).max(1_000_000).nullable(),
    cost_per_1000_usd: z.coerce.number().min(0).max(10_000),
    reliability: z.coerce.number().int().min(0).max(100),
  }).parse(await readJson(req));
  const db = getDb();
  const r = await db.query('UPDATE sources SET enabled = $2, daily_quota = $3, cost_per_1000_usd = $4, reliability = $5 WHERE id = $1',
    [Number(params.id), body.enabled, body.daily_quota, body.cost_per_1000_usd, body.reliability]);
  if (!r.rowCount) throw new HttpError(404, 'Fuente no encontrada');
  await audit(db, { id: u.id, email: u.email }, 'source.update', { type: 'source', id: params.id }, body, ipHash);
  return { ok: true };
});
