import { api } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';
import { savedCompanyIds } from '@/lib/services/lists';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const user = await getSessionUser();
  return { user: user && { id: user.id, email: user.email, full_name: user.full_name, role: user.role, companyIds: user.companyIds }, saved: user ? await savedCompanyIds(getDb(), user.id) : [] };
});
