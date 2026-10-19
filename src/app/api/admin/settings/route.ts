import { z } from 'zod';
import { api, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { getSetting, setSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const schemas = {
  external_search: z.object({ enabled: z.boolean(), min_internal_results: z.number().int().min(0).max(100), max_results_per_source: z.number().int().min(1).max(20), cache_hours: z.number().int().min(1).max(24 * 30), timeout_ms: z.number().int().min(1000).max(20000), ai_expansion: z.boolean().default(true), max_queries: z.number().int().min(1).max(10).default(6), admins_only: z.boolean().default(true) }),
  limits: z.object({ searches_per_hour_anon: z.number().int().min(1).max(10000), searches_per_hour_user: z.number().int().min(1).max(10000), external_per_day_anon: z.number().int().min(0).max(1000), external_per_day_user: z.number().int().min(0).max(5000), daily_budget_usd: z.number().min(0).max(10000) }),
  worker: z.object({ batch_size: z.number().int().min(1).max(100), time_budget_ms: z.number().int().min(5000).max(55000), stale_after_days: z.number().int().min(1).max(3650), link_check_after_days: z.number().int().min(1).max(3650), stuck_after_minutes: z.number().int().min(2).max(1440), concurrency: z.number().int().min(1).max(12).default(6) }),
  discovery_queries: z.array(z.string().trim().min(3).max(200)).max(20),
};

export const GET = api(async () => {
  await requireAdmin();
  const db = getDb();
  return Object.fromEntries(await Promise.all(Object.keys(schemas).map(async (k) => [k, await getSetting(db, k as keyof typeof schemas)])));
});

export const PUT = api(async ({ req, ipHash }) => {
  const u = await requireAdmin();
  const body = z.object({ key: z.enum(Object.keys(schemas) as [keyof typeof schemas]), value: z.unknown() }).parse(await readJson(req));
  const value = schemas[body.key].parse(body.value);
  const db = getDb();
  await setSetting(db, body.key, value, u.id);
  await audit(db, { id: u.id, email: u.email }, 'settings.update', { type: 'setting', id: body.key }, { value }, ipHash);
  return { ok: true };
});
