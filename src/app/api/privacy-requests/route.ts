import { api, checkSpam, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { hit } from '@/lib/rate-limit';
import { privacyRequestSchema } from '@/lib/validation';
import { createPrivacyRequest } from '@/lib/services/leads';

export const POST = api(async ({ req, ipHash }) => {
  const db = getDb();
  const body = await readJson(req);
  checkSpam(body);
  await hit(db, `privacy:${ipHash}`, 3, 3600);
  await createPrivacyRequest(db, privacyRequestSchema.parse(body));
  return { ok: true };
});
