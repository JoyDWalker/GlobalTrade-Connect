import { api } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const GET = api(async ({ req }) => {
  await requireAdmin();
  const sp = req.nextUrl.searchParams;
  const status = ['open', 'resolved', 'dismissed'].includes(sp.get('status') ?? '') ? sp.get('status') : 'open';
  const kind = sp.get('kind');
  const items = await many(getDb(), `SELECT t.id, t.kind, t.status, t.priority, t.details, t.created_at, t.resolution, t.resolved_at,
      c.id AS company_id, c.name AS company_name, c.slug AS company_slug, c.record_status, c.verification_level, c.country_code,
      p.email AS requested_by_email
    FROM review_tasks t LEFT JOIN companies c ON c.id = t.company_id LEFT JOIN profiles p ON p.id = t.requested_by
    WHERE t.status = $1 AND ($2::text IS NULL OR t.kind = $2) ORDER BY t.priority DESC, t.created_at LIMIT 200`, [status, kind || null]);
  const counts = await many(getDb(), "SELECT kind, count(*)::int AS n FROM review_tasks WHERE status = 'open' GROUP BY kind ORDER BY n DESC");
  return { items, counts };
});
