import { api, HttpError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { canManageCompany, getSessionUser } from '@/lib/auth/session';
import { companyDetail, isPubliclyVisible } from '@/lib/services/companies';

export const dynamic = 'force-dynamic';

export const GET = api<{ slug: string }>(async ({ params }) => {
  const user = await getSessionUser();
  const c = await companyDetail(getDb(), { slug: params.slug }, { privateView: false });
  if (!c || (!isPubliclyVisible(c as any) && !canManageCompany(user, c.id))) throw new HttpError(404, 'Empresa no encontrada');
  return { company: c };
});
