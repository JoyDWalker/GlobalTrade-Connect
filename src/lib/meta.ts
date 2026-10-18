// Catálogos para filtros y formularios (con caché en memoria de 5 minutos por instancia).
import type { Queryable } from './db';
import { many } from './db';

export interface Meta {
  countries: { iso_code: string; name: string; continent: string | null; flag_url: string | null; is_priority: boolean; company_count: number }[];
  categories: { id: number; name: string; slug: string; parent_id: number | null; company_count: number }[];
  certifications: { slug: string; name: string }[];
  languages: { code: string; name: string }[];
  business_types: { slug: string; name: string }[];
  client_types: { slug: string; name: string }[];
  sources: { key: string; name: string; kind: string }[];
}

let cached: { at: number; data: Meta } | null = null;

export async function getMeta(q: Queryable, { fresh = false } = {}): Promise<Meta> {
  if (!fresh && cached && Date.now() - cached.at < 300_000) return cached.data;
  const visible = "c.deleted_at IS NULL AND c.record_status IN ('published', 'detected')";
  const [countries, categories, certifications, languages, business_types, client_types, sources] = await Promise.all([
    many(q, `SELECT co.iso_code, co.name, co.continent, co.flag_url, co.is_priority,
      (SELECT count(*)::int FROM companies c WHERE c.country_code = co.iso_code AND ${visible}) AS company_count
      FROM countries co ORDER BY co.is_priority DESC, co.sort_order, co.name`),
    many(q, `SELECT ca.id::int AS id, ca.name, ca.slug, ca.parent_id::int AS parent_id,
      (SELECT count(*)::int FROM company_categories x JOIN companies c ON c.id = x.company_id WHERE x.category_id = ca.id AND ${visible}) AS company_count
      FROM categories ca WHERE ca.is_active ORDER BY ca.sort_order, ca.name`),
    many(q, 'SELECT slug, name FROM certifications ORDER BY name'),
    many(q, 'SELECT code, name FROM languages ORDER BY name'),
    many(q, 'SELECT slug, name FROM business_types ORDER BY sort_order, name'),
    many(q, 'SELECT slug, name FROM client_types ORDER BY name'),
    many(q, "SELECT key, name, kind FROM sources WHERE key <> 'seed_demo' ORDER BY reliability DESC"),
  ]);
  const data = { countries, categories, certifications, languages, business_types, client_types, sources } as Meta;
  cached = { at: Date.now(), data };
  return data;
}

export function invalidateMeta() { cached = null; }
