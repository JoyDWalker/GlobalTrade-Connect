// Listado de empresas en seguimiento (solo administradores).
import { api } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { listFollowups } from '@/lib/services/followups';

export const dynamic = 'force-dynamic';

export const GET = api(async ({ req }) => {
  await requireAdmin();
  const sp = req.nextUrl.searchParams;
  return listFollowups(getDb(), { status: sp.get('status'), tag: sp.get('tag'), q: sp.get('q')?.slice(0, 100), due: sp.get('due') === '1', page: Number(sp.get('page')) || 1 });
});
