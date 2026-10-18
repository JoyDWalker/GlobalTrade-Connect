import { api } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const GET = api(async ({ req }) => {
  await requireAdmin();
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  const items = await many(getDb(), `SELECT p.id, p.email, p.full_name, p.role, p.is_blocked, p.created_at,
      coalesce((SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug)) FROM company_members m JOIN companies c ON c.id = m.company_id WHERE m.user_id = p.id), '[]') AS companies
    FROM profiles p WHERE ($1 = '' OR lower(p.email) LIKE '%' || $1 || '%' OR lower(coalesce(p.full_name, '')) LIKE '%' || $1 || '%')
    ORDER BY p.created_at DESC LIMIT 200`, [q]);
  return { items };
});
