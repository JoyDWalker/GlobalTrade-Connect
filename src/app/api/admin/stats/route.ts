import { api } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { adminStats, sourceUsage } from '@/lib/services/admin';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireAdmin();
  const db = getDb();
  const [stats, sources] = await Promise.all([adminStats(db), sourceUsage(db)]);
  return { ...stats, costs: sources.map((s: any) => ({ key: s.key, name: s.name, cost_today: s.cost_today, cost_30d: s.cost_30d, requests_today: s.requests_today, errors_30d: s.errors_30d })) };
});
