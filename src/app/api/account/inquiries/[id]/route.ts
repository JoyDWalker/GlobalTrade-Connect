import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';

// Solo puede cambiar el estado quien pertenece a la empresa destinataria
export const PUT = api<{ id: string }>(async ({ req, params }) => {
  const u = await requireUser();
  const { status } = z.object({ status: z.enum(['new', 'read', 'answered', 'archived']) }).parse(await readJson(req));
  const r = await getDb().query('UPDATE inquiries SET status = $3 WHERE id = $1 AND company_id IN (SELECT company_id FROM company_members WHERE user_id = $2)',
    [Number(params.id), u.id, status]);
  if (!r.rowCount) throw new HttpError(404, 'Solicitud no encontrada');
  return { ok: true };
});
