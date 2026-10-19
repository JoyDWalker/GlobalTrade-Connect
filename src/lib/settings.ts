// Configuración editable en caliente (tabla app_settings) con valores por defecto seguros.
import type { Queryable } from './db';
import { one } from './db';
import { defaultSettings } from './seed/catalog';

export interface Settings {
  external_search: { enabled: boolean; min_internal_results: number; max_results_per_source: number; cache_hours: number; timeout_ms: number };
  limits: { searches_per_hour_anon: number; searches_per_hour_user: number; external_per_day_anon: number; external_per_day_user: number; daily_budget_usd: number };
  worker: { batch_size: number; time_budget_ms: number; stale_after_days: number; link_check_after_days: number; stuck_after_minutes: number; concurrency: number };
  discovery_queries: string[];
}
const DEFAULTS = Object.fromEntries(defaultSettings.map(([k, v]) => [k, v])) as unknown as Settings;

export async function getSetting<K extends keyof Settings>(q: Queryable, key: K): Promise<Settings[K]> {
  const r = await one<{ value: any }>(q, 'SELECT value FROM app_settings WHERE key = $1', [key]);
  const v = typeof r?.value === 'string' ? JSON.parse(r.value) : r?.value;
  if (Array.isArray(DEFAULTS[key])) return (v ?? DEFAULTS[key]) as Settings[K];
  return { ...(DEFAULTS[key] as object), ...(v ?? {}) } as Settings[K];
}

export async function setSetting(q: Queryable, key: keyof Settings, value: unknown, userId: string | null) {
  await q.query(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [key, JSON.stringify(value), userId]);
}
