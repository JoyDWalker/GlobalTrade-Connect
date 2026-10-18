import { api, checkSpam, HttpError, readJson } from '@/lib/api';
import { getDb, one } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';
import { hit } from '@/lib/rate-limit';
import { inquirySchema } from '@/lib/validation';
import { createInquiry } from '@/lib/services/leads';

export const POST = api<{ slug: string }>(async ({ req, params, ipHash }) => {
  const db = getDb();
  const body = await readJson(req);
  checkSpam(body);
  await hit(db, `inquiry:${ipHash}`, 6, 600);
  const d = inquirySchema.parse(body);
  const company = await one<{ id: string; name: string; slug: string; record_status: string }>(db,
    "SELECT id, name, slug, record_status FROM companies WHERE slug = $1 AND deleted_at IS NULL AND record_status IN ('published', 'detected')", [params.slug]);
  if (!company) throw new HttpError(404, 'Empresa no encontrada');
  const user = await getSessionUser();
  const r = await createInquiry(db, company, d, { userId: user?.id ?? null, ipHash });
  return { ok: true, ...r };
});
