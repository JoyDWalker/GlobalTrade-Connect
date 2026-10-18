import { api } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const GET = api(async ({ req }) => {
  await requireAdmin();
  const action = req.nextUrl.searchParams.get('action');
  const items = await many(getDb(), `SELECT id, actor_email, action, entity_type, entity_id, details, created_at FROM audit_log
    WHERE ($1::text IS NULL OR action LIKE $1 || '%') ORDER BY id DESC LIMIT 300`, [action || null]);
  return { items };
});
