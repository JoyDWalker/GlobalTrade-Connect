import { api, checkSpam, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';
import { hit } from '@/lib/rate-limit';
import { supplierRequestSchema } from '@/lib/validation';
import { createSupplierRequest } from '@/lib/services/leads';

export const POST = api(async ({ req, ipHash }) => {
  const db = getDb();
  const body = await readJson(req);
  checkSpam(body);
  await hit(db, `supplier:${ipHash}`, 5, 3600);
  const d = supplierRequestSchema.parse(body);
  const user = await getSessionUser();
  return { ok: true, id: await createSupplierRequest(db, d, user?.id ?? null) };
});
