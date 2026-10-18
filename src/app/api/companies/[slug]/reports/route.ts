import { api, checkSpam, HttpError, readJson } from '@/lib/api';
import { getDb, one } from '@/lib/db';
import { hit } from '@/lib/rate-limit';
import { dataReportSchema } from '@/lib/validation';
import { createDataReport } from '@/lib/services/leads';

export const POST = api<{ slug: string }>(async ({ req, params, ipHash }) => {
  const db = getDb();
  const body = await readJson(req);
  checkSpam(body);
  await hit(db, `report:${ipHash}`, 5, 600);
  const d = dataReportSchema.parse(body);
  const c = await one<{ id: string }>(db, 'SELECT id FROM companies WHERE slug = $1 AND deleted_at IS NULL', [params.slug]);
  if (!c) throw new HttpError(404, 'Empresa no encontrada');
  await createDataReport(db, c.id, d);
  return { ok: true };
});
