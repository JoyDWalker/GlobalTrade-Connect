import { api, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { saveCompany, searchCompanies } from '@/lib/services/companies';
import { adminCompanyExtras, companyInputSchema, searchParamsFromUrl } from '@/lib/validation';
import { invalidateMeta } from '@/lib/meta';

export const dynamic = 'force-dynamic';

export const GET = api(async ({ req }) => {
  await requireAdmin();
  const p = searchParamsFromUrl(req.nextUrl.searchParams);
  return searchCompanies(getDb(), { ...p, sort: req.nextUrl.searchParams.get('sort') ? p.sort : 'newest', pageSize: Math.min(p.pageSize, 50) }, { admin: true });
});

export const POST = api(async ({ req, ipHash }) => {
  const u = await requireAdmin();
  const body = await readJson(req);
  const input = companyInputSchema.parse(body);
  const extras = adminCompanyExtras.parse(body);
  const db = getDb();
  const id = await db.tx(async (q) => {
    const cid = await saveCompany(q, input, { actorId: u.id, changeSource: 'admin', sourceKey: 'manual',
      extra: { origin: 'admin', record_status: extras.record_status ?? 'published', verification_level: extras.verification_level ?? 'none',
        verification_method: extras.verification_method, is_featured: extras.is_featured ?? false } });
    await audit(q, { id: u.id, email: u.email }, 'company.create', { type: 'company', id: cid }, { name: input.name }, ipHash);
    return cid;
  });
  invalidateMeta();
  return { id };
});
