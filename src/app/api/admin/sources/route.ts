import { api } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { sourceUsage } from '@/lib/services/admin';
import { SEARCH_ADAPTERS } from '@/lib/sources/registry';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireAdmin();
  const db = getDb();
  const configured = Object.fromEntries(SEARCH_ADAPTERS.map((a) => [a.key, a.isConfigured()]));
  const sources = (await sourceUsage(db)).map((s: any) => ({ ...s, credentials: s.kind === 'search_api' ? (configured[s.key] ? 'configured' : 'missing') : 'not_required' }));
  const recent = await many(db, `SELECT r.id, s.key AS source, r.purpose, r.query, r.status, r.http_status, r.duration_ms, r.results, r.cost_usd, r.error, r.created_at
    FROM external_requests r JOIN sources s ON s.id = r.source_id ORDER BY r.id DESC LIMIT 100`);
  return { sources, recent };
});
