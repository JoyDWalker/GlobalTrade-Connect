import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { cancelJob, retryJob } from '@/lib/jobs/queue';

export const POST = api<{ id: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const { action } = z.object({ action: z.enum(['retry', 'cancel']) }).parse(await readJson(req));
  const db = getDb();
  const ok = action === 'retry' ? await retryJob(db, Number(params.id)) : await cancelJob(db, Number(params.id));
  if (!ok) throw new HttpError(409, action === 'retry' ? 'Solo se pueden reintentar tareas fallidas o canceladas' : 'Solo se pueden cancelar tareas en cola');
  await audit(db, { id: u.id, email: u.email }, `job.${action}`, { type: 'job', id: params.id }, {}, ipHash);
  return { ok: true };
});
