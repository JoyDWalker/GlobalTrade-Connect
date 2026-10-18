// Consultas del panel de administración: estadísticas, costes, salud de fuentes y catálogos.
import type { Queryable } from '../db';
import { many, one } from '../db';
import { slugify } from '../text';
import { HttpError } from '../api';

export const sqlConflict = (e: unknown) => {
  const msg = (e as Error).message ?? '';
  if (/unique|duplicate/i.test(msg)) return new HttpError(409, 'Ya existe un elemento con ese nombre o código');
  if (/foreign key|violates/i.test(msg)) return new HttpError(409, 'No se puede eliminar: está en uso');
  return e;
};

export async function adminStats(q: Queryable) {
  const totals = await one(q, `SELECT
      count(*) FILTER (WHERE deleted_at IS NULL)::int AS companies,
      count(*) FILTER (WHERE deleted_at IS NULL AND record_status = 'published')::int AS published,
      count(*) FILTER (WHERE deleted_at IS NULL AND record_status = 'detected')::int AS detected,
      count(*) FILTER (WHERE deleted_at IS NULL AND record_status = 'pending_review')::int AS pending_review,
      count(*) FILTER (WHERE deleted_at IS NULL AND verification_level = 'verified')::int AS verified,
      count(*) FILTER (WHERE deleted_at IS NULL AND verification_level = 'contrasted')::int AS contrasted,
      (SELECT count(*)::int FROM review_tasks WHERE status = 'open') AS open_tasks,
      (SELECT count(*)::int FROM inquiries) AS inquiries,
      (SELECT count(*)::int FROM inquiries WHERE status = 'new') AS inquiries_new,
      (SELECT count(*)::int FROM supplier_requests WHERE status = 'new') AS supplier_requests_new,
      (SELECT count(*)::int FROM privacy_requests WHERE status = 'new') AS privacy_new,
      (SELECT count(*)::int FROM data_reports WHERE status = 'new') AS reports_new,
      (SELECT count(*)::int FROM jobs WHERE status = 'failed' AND finished_at > now() - interval '7 days') AS jobs_failed_7d,
      (SELECT count(*)::int FROM profiles) AS users
    FROM companies`);
  const byCountry = await many(q, `SELECT co.iso_code, co.name, co.flag_url, count(*)::int AS n FROM companies c JOIN countries co ON co.iso_code = c.country_code
    WHERE c.deleted_at IS NULL AND c.record_status IN ('published', 'detected') GROUP BY co.iso_code ORDER BY n DESC, co.name LIMIT 15`);
  const bySector = await many(q, `SELECT ca.name, ca.slug, count(*)::int AS n FROM company_categories x JOIN categories ca ON ca.id = x.category_id
    JOIN companies c ON c.id = x.company_id WHERE c.deleted_at IS NULL AND c.record_status IN ('published', 'detected')
    AND ca.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM categories p WHERE p.id = ca.parent_id AND p.parent_id IS NULL)
    GROUP BY ca.id ORDER BY n DESC LIMIT 12`);
  const searches = await many(q, `SELECT date_trunc('day', created_at)::date::text AS day, count(*)::int AS n,
      count(*) FILTER (WHERE external_status IN ('ok', 'partial'))::int AS external FROM searches
    WHERE created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`);
  const topQueries = await many(q, `SELECT query_normalized AS query, count(*)::int AS n, round(avg(internal_results))::int AS avg_results FROM searches
    WHERE created_at > now() - interval '30 days' AND query_normalized <> '' GROUP BY 1 ORDER BY n DESC LIMIT 10`);
  return { totals, byCountry, bySector, searches, topQueries };
}

/** Uso, errores y coste estimado por fuente (hoy y últimos 30 días). */
export async function sourceUsage(q: Queryable) {
  return many(q, `SELECT s.id, s.key, s.name, s.kind, s.enabled, s.daily_quota, s.cost_per_1000_usd, s.reliability, s.notes, s.terms_url, s.licence,
      count(r.id) FILTER (WHERE r.created_at >= date_trunc('day', now()) AND r.status NOT IN ('cached', 'disabled', 'quota_exceeded'))::int AS requests_today,
      count(r.id) FILTER (WHERE r.status NOT IN ('cached', 'disabled', 'quota_exceeded'))::int AS requests_30d,
      count(r.id) FILTER (WHERE r.status = 'cached')::int AS cached_30d,
      count(r.id) FILTER (WHERE r.status IN ('error', 'timeout', 'rate_limited'))::int AS errors_30d,
      coalesce(sum(r.cost_usd) FILTER (WHERE r.created_at >= date_trunc('day', now())), 0)::float AS cost_today,
      coalesce(sum(r.cost_usd), 0)::float AS cost_30d,
      max(r.created_at) FILTER (WHERE r.status = 'ok') AS last_ok_at,
      (SELECT error FROM external_requests e WHERE e.source_id = s.id AND e.error IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS last_error
    FROM sources s LEFT JOIN external_requests r ON r.source_id = s.id AND r.created_at > now() - interval '30 days'
    GROUP BY s.id ORDER BY s.kind, s.reliability DESC`);
}

// ───────── Catálogos editables ─────────
export const TAXONOMIES = {
  categories: { table: 'categories', pk: 'id', order: 'parent_id NULLS FIRST, sort_order, name', fields: ['name', 'slug', 'parent_id', 'sort_order', 'is_active'] },
  countries: { table: 'countries', pk: 'iso_code', order: 'is_priority DESC, sort_order, name', fields: ['iso_code', 'name', 'continent', 'flag_url', 'is_priority', 'sort_order'] },
  certifications: { table: 'certifications', pk: 'id', order: 'name', fields: ['slug', 'name'] },
  languages: { table: 'languages', pk: 'code', order: 'name', fields: ['code', 'name'] },
  'business-types': { table: 'business_types', pk: 'slug', order: 'sort_order, name', fields: ['slug', 'name', 'sort_order'] },
  'client-types': { table: 'client_types', pk: 'slug', order: 'name', fields: ['slug', 'name'] },
} as const;
export type TaxonomyKey = keyof typeof TAXONOMIES;

export function taxonomyValues(key: TaxonomyKey, body: Record<string, unknown>) {
  const def = TAXONOMIES[key];
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of def.fields) {
    const v = body[f];
    if (f === 'name') { const s = String(v ?? '').trim(); if (!s || s.length > 120) errors.name = 'Nombre obligatorio (máx. 120)'; out.name = s; }
    else if (f === 'slug') out.slug = slugify(String(v ?? '') || String(body.name ?? ''));
    else if (f === 'iso_code') { const s = String(v ?? '').toUpperCase(); if (!/^[A-Z]{2}$/.test(s)) errors.iso_code = 'Código ISO de 2 letras'; out.iso_code = s; }
    else if (f === 'code') { const s = String(v ?? '').toLowerCase(); if (!/^[a-z]{2}$/.test(s)) errors.code = 'Código ISO 639-1 de 2 letras'; out.code = s; }
    else if (f === 'parent_id') out.parent_id = v === '' || v == null ? null : Number(v);
    else if (f === 'sort_order') out.sort_order = Number.isFinite(Number(v)) && v !== '' ? Number(v) : 100;
    else if (f === 'is_priority' || f === 'is_active') out[f] = v === true || v === 'true' || v === 'on' || (f === 'is_active' && v === undefined);
    else if (f === 'flag_url' || f === 'continent') { const s = String(v ?? '').trim(); out[f] = s ? s.slice(0, 300) : null; if (f === 'flag_url' && s && !/^(https:\/\/|\/)/.test(s)) errors.flag_url = 'URL https o ruta local'; }
  }
  return { values: out, errors };
}
