// Empresas: guardado con historial y deduplicación, búsqueda interna, fichas y exportación.
import type { Queryable } from '../db';
import { many, one } from '../db';
import { canonicalName, isGenericDomain, normalize, normalizeDomain, normalizeTaxId, slugify } from '../text';
import type { CompanyInput, SearchParams } from '../validation';
import { minMatches, parseQuery } from '../search/query';

export class DuplicateCompanyError extends Error {
  constructor(public existing: { id: string; slug: string; name: string }, public reason: string) {
    super(`Ya existe una empresa con ${reason}: ${existing.name}`);
  }
}

export type ChangeSource = 'owner' | 'admin' | 'worker' | 'external' | 'system';
export interface SaveOptions {
  id?: string | null;
  actorId?: string | null;
  changeSource: ChangeSource;
  /** Columnas controladas por el sistema (estado, verificación, origen…) */
  extra?: Partial<Record<'record_status' | 'verification_level' | 'verification_method' | 'is_featured' | 'rejection_reason' | 'origin' | 'is_demo' | 'logo_url' | 'created_at', unknown>>;
  sourceKey?: string;
}

const COLUMNS = ['name', 'legal_name', 'description', 'main_activity', 'country_code', 'region', 'city', 'address', 'postal_code',
  'coverage_area', 'website', 'email', 'phone', 'company_types', 'keywords', 'year_founded', 'employees_range', 'export_capacity_tons',
  'production_capacity', 'minimum_order_kg', 'minimum_order_notes', 'commercial_terms', 'social', 'tax_id', 'lei'] as const;

// ───────────────────────── Duplicados ─────────────────────────

export async function findDuplicate(q: Queryable, c: { domain?: string | null; country_code?: string | null; tax_id_normalized?: string | null; lei?: string | null; name?: string }, excludeId?: string | null) {
  const ex = excludeId ?? '00000000-0000-0000-0000-000000000000';
  if (c.lei) {
    const r = await one<{ id: string; slug: string; name: string }>(q, 'SELECT id, slug, name FROM companies WHERE lei = $1 AND deleted_at IS NULL AND id <> $2', [c.lei, ex]);
    if (r) return { existing: r, reason: 'el mismo código LEI' };
  }
  if (c.tax_id_normalized && c.country_code) {
    const r = await one<{ id: string; slug: string; name: string }>(q, 'SELECT id, slug, name FROM companies WHERE country_code = $1 AND tax_id_normalized = $2 AND deleted_at IS NULL AND id <> $3', [c.country_code, c.tax_id_normalized, ex]);
    if (r) return { existing: r, reason: 'el mismo identificador fiscal' };
  }
  if (c.domain && !isGenericDomain(c.domain)) {
    const r = await one<{ id: string; slug: string; name: string }>(q, 'SELECT id, slug, name FROM companies WHERE domain = $1 AND deleted_at IS NULL AND id <> $2', [c.domain, ex]);
    if (r) return { existing: r, reason: 'el mismo sitio web' };
  }
  return null;
}

/** Candidatos a duplicado no bloqueantes (mismo nombre canónico y país). */
export async function similarByName(q: Queryable, name: string, country: string | null, excludeId?: string | null) {
  const canon = canonicalName(name);
  if (canon.length < 4) return [];
  const rows = await many<{ id: string; slug: string; name: string; country_code: string }>(q,
    `SELECT id, slug, name, country_code FROM companies WHERE deleted_at IS NULL AND id <> $1 AND ($2::text IS NULL OR country_code = $2)
       AND search_text LIKE $3 LIMIT 50`, [excludeId ?? '00000000-0000-0000-0000-000000000000', country, `%${normalize(name).split(' ')[0]}%`]);
  return rows.filter((r) => canonicalName(r.name) === canon);
}

// ───────────────────────── Guardado ─────────────────────────

async function uniqueSlug(q: Queryable, name: string, id?: string | null) {
  const base = slugify(name);
  for (let i = 1; i < 500; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const r = await one(q, 'SELECT 1 FROM companies WHERE slug = $1 AND id IS DISTINCT FROM $2', [slug, id ?? null]);
    if (!r) return slug;
  }
  return `${base}-${Date.now()}`;
}

async function categoryClosure(q: Queryable, ids: number[]) {
  if (!ids.length) return [];
  const rows = await many<{ id: number }>(q, `WITH RECURSIVE up AS (
      SELECT id, parent_id FROM categories WHERE id = ANY($1::bigint[])
      UNION SELECT c.id, c.parent_id FROM categories c JOIN up ON c.id = up.parent_id)
    SELECT DISTINCT id FROM up`, [ids]);
  return rows.map((r) => Number(r.id));
}

export async function refreshSearchText(q: Queryable, id: string) {
  await q.query(`UPDATE companies c SET search_text = lower(concat_ws(' ',
      c.name, c.legal_name, c.description, c.main_activity, c.city, c.region, c.coverage_area, c.domain,
      (SELECT name FROM countries WHERE iso_code = c.country_code),
      array_to_string(c.keywords, ' '),
      (SELECT string_agg(b.name, ' ') FROM business_types b WHERE b.slug = ANY(c.company_types)),
      (SELECT string_agg(ca.name || ' ' || replace(ca.slug, '-', ' '), ' ') FROM company_categories x JOIN categories ca ON ca.id = x.category_id WHERE x.company_id = c.id),
      (SELECT string_agg(o.name || ' ' || coalesce(o.hs_code, ''), ' ') FROM offerings o WHERE o.company_id = c.id),
      (SELECT string_agg(ce.name, ' ') FROM company_certifications x JOIN certifications ce ON ce.id = x.certification_id WHERE x.company_id = c.id)
    )) WHERE c.id = $1`, [id]);
  // Sin tildes: se normaliza en la aplicación para no depender de la extensión unaccent
  const row = await one<{ search_text: string }>(q, 'SELECT search_text FROM companies WHERE id = $1', [id]);
  if (row) await q.query('UPDATE companies SET search_text = $2 WHERE id = $1', [id, normalize(row.search_text)]);
}

function diff(before: Record<string, any> | null, after: Record<string, any>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before?.[k] ?? null;
    const b = after[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = { from: k === 'tax_id' ? '[privado]' : a, to: k === 'tax_id' ? '[privado]' : b };
  }
  return changes;
}

/**
 * Crea o actualiza una empresa y sus relaciones en una transacción (q debe ser la transacción).
 * Lanza DuplicateCompanyError si choca con otra empresa por LEI, NIF o dominio.
 */
export async function saveCompany(q: Queryable, input: CompanyInput, opts: SaveOptions) {
  const id = opts.id ?? null;
  const domain = normalizeDomain(input.website) ?? (input.email ? normalizeDomain(input.email) : null);
  const tax = normalizeTaxId(input.tax_id);
  const dup = await findDuplicate(q, { domain: isGenericDomain(domain) ? null : domain, country_code: input.country_code, tax_id_normalized: tax, lei: input.lei }, id);
  if (dup) throw new DuplicateCompanyError(dup.existing, dup.reason);

  const before = id ? await one(q, `SELECT ${COLUMNS.join(', ')}, record_status, verification_level, is_featured FROM companies WHERE id = $1`, [id]) : null;
  if (id && !before) throw new Error('Empresa no encontrada');

  const values: Record<string, unknown> = Object.fromEntries(COLUMNS.map((c) => [c, (input as any)[c] ?? null]));
  values.company_types = input.company_types;
  values.keywords = [...new Set(input.keywords.map((k) => k.trim()).filter(Boolean))];
  values.social = Object.fromEntries(Object.entries(input.social || {}).filter(([, v]) => v));
  Object.assign(values, opts.extra ?? {});
  const row: Record<string, unknown> = {
    ...values,
    slug: await uniqueSlug(q, input.name, id),
    domain: isGenericDomain(domain) ? null : domain,
    tax_id_normalized: tax,
    last_checked_at: new Date().toISOString(),
  };
  const keys = Object.keys(row);
  const jsonCols = new Set(['social']);
  const params = keys.map((k) => (jsonCols.has(k) ? JSON.stringify(row[k]) : row[k]));

  let companyId: string;
  if (id) {
    await q.query(`UPDATE companies SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...params]);
    companyId = id;
  } else {
    const r = await one<{ id: string }>(q, `INSERT INTO companies (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, params);
    companyId = r!.id;
  }

  // Relaciones
  const cats = await categoryClosure(q, input.categories);
  await q.query('DELETE FROM company_categories WHERE company_id = $1', [companyId]);
  if (cats.length) await q.query('INSERT INTO company_categories (company_id, category_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING', [companyId, cats]);

  await q.query('DELETE FROM offerings WHERE company_id = $1', [companyId]);
  for (const o of input.offerings) {
    await q.query('INSERT INTO offerings (company_id, kind, name, description, hs_code) VALUES ($1,$2,$3,$4,$5)', [companyId, o.kind, o.name, o.description, o.hs_code]);
  }

  await q.query('DELETE FROM company_certifications WHERE company_id = $1', [companyId]);
  if (input.certifications.length) await q.query(`INSERT INTO company_certifications (company_id, certification_id)
    SELECT $1, id FROM certifications WHERE slug = ANY($2::text[]) ON CONFLICT DO NOTHING`, [companyId, input.certifications]);
  await q.query('DELETE FROM company_languages WHERE company_id = $1', [companyId]);
  if (input.languages.length) await q.query(`INSERT INTO company_languages (company_id, language_code)
    SELECT $1, code FROM languages WHERE code = ANY($2::text[]) ON CONFLICT DO NOTHING`, [companyId, input.languages]);
  await q.query('DELETE FROM company_client_types WHERE company_id = $1', [companyId]);
  if (input.client_types.length) await q.query(`INSERT INTO company_client_types (company_id, client_type)
    SELECT $1, slug FROM client_types WHERE slug = ANY($2::text[]) ON CONFLICT DO NOTHING`, [companyId, input.client_types]);
  await q.query('DELETE FROM company_markets WHERE company_id = $1', [companyId]);
  for (const [dir, list] of [['export', input.export_markets], ['import', input.import_markets]] as const) {
    if (list.length) await q.query(`INSERT INTO company_markets (company_id, country_code, direction)
      SELECT $1, iso_code, $3 FROM countries WHERE iso_code = ANY($2::text[]) ON CONFLICT DO NOTHING`, [companyId, list, dir]);
  }

  await q.query('DELETE FROM company_contacts WHERE company_id = $1', [companyId]);
  const hasPrimary = input.contacts.some((c) => c.is_primary);
  for (const [i, c] of input.contacts.entries()) {
    await q.query(`INSERT INTO company_contacts (company_id, full_name, job_title, email, phone, whatsapp, languages, is_primary, is_personal, consent_public)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [companyId, c.full_name, c.job_title, c.email, c.phone, c.whatsapp, c.languages, hasPrimary ? c.is_primary : i === 0, c.is_personal, c.consent_public]);
  }

  // Procedencia del registro
  if (opts.sourceKey) {
    const src = await one<{ id: number }>(q, 'SELECT id FROM sources WHERE key = $1', [opts.sourceKey]);
    if (src) {
      await q.query(`INSERT INTO company_sources (company_id, source_id, external_id, source_url, title)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source_id, external_id) DO UPDATE SET last_seen_at = now(), title = EXCLUDED.title`,
      [companyId, src.id, companyId, input.website, input.name]);
    }
  }

  await refreshSearchText(q, companyId);
  const changes = diff(before, { ...values, record_status: values.record_status ?? before?.record_status });
  if (Object.keys(changes).length) {
    await q.query('INSERT INTO company_changes (company_id, changed_by, change_source, changes) VALUES ($1,$2,$3,$4)',
      [companyId, opts.actorId ?? null, opts.changeSource, JSON.stringify(id ? changes : { created: { from: null, to: input.name } })]);
  }
  return companyId;
}

/** Cambios de estado (aprobar, ocultar, verificar…) con historial. */
export async function setCompanyStatus(q: Queryable, id: string, patch: { record_status?: string; verification_level?: string; verification_method?: string | null; is_featured?: boolean; rejection_reason?: string | null }, actorId: string | null) {
  const before = await one(q, 'SELECT record_status, verification_level, verification_method, is_featured, rejection_reason FROM companies WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!before) return null;
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (patch.verification_level === 'verified') { params.push(actorId); sets.push('verified_at = now()', `verified_by = $${params.length}`); }
  if (patch.verification_level === 'none') sets.push('verified_at = NULL', 'verified_by = NULL');
  if (!sets.length) return before;
  await q.query(`UPDATE companies SET ${sets.join(', ')} WHERE id = $1`, params);
  const changes = diff(before, { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
  if (Object.keys(changes).length) {
    await q.query('INSERT INTO company_changes (company_id, changed_by, change_source, changes) VALUES ($1,$2,$3,$4)', [id, actorId, 'admin', JSON.stringify(changes)]);
  }
  return { ...before, ...patch };
}

/** Borrado lógico: conserva leads, historial y procedencia. */
export async function softDeleteCompany(q: Queryable, id: string, actorId: string | null) {
  const r = await q.query("UPDATE companies SET deleted_at = now(), record_status = 'hidden' WHERE id = $1 AND deleted_at IS NULL", [id]);
  if (r.rowCount) await q.query('INSERT INTO company_changes (company_id, changed_by, change_source, changes) VALUES ($1,$2,$3,$4)', [id, actorId, 'admin', JSON.stringify({ deleted: { from: null, to: true } })]);
  return r.rowCount > 0;
}

// ───────────────────────── Búsqueda interna ─────────────────────────

/** La empresa tiene teléfono o correo públicos (propios o de un contacto publicable). */
const CONTACTABLE_SQL = `(c.email IS NOT NULL OR c.phone IS NOT NULL OR EXISTS (SELECT 1 FROM company_contacts k WHERE k.company_id = c.id
  AND (k.email IS NOT NULL OR k.phone IS NOT NULL) AND NOT k.hidden AND (NOT k.is_personal OR k.consent_public)))`;

export interface CompanyCard {
  id: string; slug: string; name: string; logo_url: string | null; city: string | null; region: string | null;
  country_code: string | null; country_name: string | null; flag_url: string | null; company_types: string[]; type_names: string[];
  verification_level: string; record_status: string; is_featured: boolean; is_demo: boolean; origin: string; domain: string | null;
  excerpt: string | null; sectors: { name: string; slug: string }[]; certifications: string[]; sources: string[];
  website: string | null; email: string | null; phone: string | null;
  /** Señales de que la empresa existe y está activa */
  sig_registry: boolean; sig_website: boolean; sig_maps: boolean; last_checked_at: string | null; created_at: string;
}

let countryNameCache: { at: number; map: Map<string, string> } | null = null;
export async function countryNameMap(q: Queryable) {
  if (countryNameCache && Date.now() - countryNameCache.at < 3600e3) return countryNameCache.map;
  const rows = await many<{ iso_code: string; name: string }>(q, 'SELECT iso_code, name FROM countries');
  const map = new Map(rows.map((r) => [normalize(r.name), r.iso_code]));
  for (const [alias, iso] of [['usa', 'US'], ['eeuu', 'US'], ['ee uu', 'US'], ['estados unidos', 'US'], ['reino unido', 'GB'], ['uk', 'GB'], ['brazil', 'BR'], ['spain', 'ES'], ['switzerland', 'CH'], ['belgium', 'BE'], ['germany', 'DE'], ['china', 'CN'], ['mexico', 'MX'], ['peru', 'PE']] as const) map.set(alias, iso);
  countryNameCache = { at: Date.now(), map };
  return map;
}

export interface SearchOutcome {
  total: number; page: number; pageSize: number; pages: number; items: CompanyCard[];
  interpreted: { terms: string[]; countries: string[]; types: string[] };
}

/**
 * Búsqueda sobre la base de datos propia. `admin` permite ver cualquier estado.
 * La consulta en lenguaje natural se descompone en términos, países y tipos de empresa.
 */
export async function searchCompanies(q: Queryable, p: SearchParams, { admin = false, ids }: { admin?: boolean; ids?: string[] } = {}): Promise<SearchOutcome> {
  const where: string[] = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (admin) {
    if (p.status.length) where.push(`c.record_status = ANY(${add(p.status)}::text[])`);
  } else {
    where.push(p.includeDetected ? "c.record_status IN ('published', 'detected')" : "c.record_status = 'published'");
  }
  if (ids) where.push(`c.id = ANY(${add(ids)}::uuid[])`);

  const parsed = parseQuery(p.q, p.q ? await countryNameMap(q) : new Map());
  const countries = [...new Set([...p.country, ...(p.country.length ? [] : parsed.countries)])];
  const types = [...new Set([...p.type, ...(p.type.length ? [] : parsed.types)])];

  let matchExpr = '0';
  if (parsed.terms.length) {
    const parts = parsed.terms.map((t) => `(CASE WHEN c.search_text LIKE ${add(`%${t}%`)} THEN 1 ELSE 0 END)`);
    matchExpr = parts.join(' + ');
    where.push(`(${matchExpr}) >= ${minMatches(parsed.terms.length)}`);
  }
  if (p.category) {
    where.push(`EXISTS (SELECT 1 FROM company_categories x JOIN categories ca ON ca.id = x.category_id WHERE x.company_id = c.id AND ca.slug = ${add(p.category)})`);
  }
  if (countries.length) where.push(`c.country_code = ANY(${add(countries)}::text[])`);
  if (p.region) where.push(`lower(c.region) = lower(${add(p.region)})`);
  if (p.city) where.push(`lower(c.city) LIKE lower(${add(`%${p.city}%`)})`);
  // Tipo deducido del texto ("fabricantes de…"): también incluye fichas aún sin tipo asignado (p. ej. detectadas)
  if (types.length) where.push(p.type.length ? `c.company_types && ${add(types)}::text[]` : `(c.company_types && ${add(types)}::text[] OR cardinality(c.company_types) = 0)`);
  for (const cert of p.cert) where.push(`EXISTS (SELECT 1 FROM company_certifications x JOIN certifications ce ON ce.id = x.certification_id WHERE x.company_id = c.id AND ce.slug = ${add(cert)})`);
  for (const lang of p.lang) where.push(`EXISTS (SELECT 1 FROM company_languages x WHERE x.company_id = c.id AND x.language_code = ${add(lang)})`);
  if (p.client.length) where.push(`EXISTS (SELECT 1 FROM company_client_types x WHERE x.company_id = c.id AND x.client_type = ANY(${add(p.client)}::text[]))`);
  if (p.verification.length) where.push(`c.verification_level = ANY(${add(p.verification)}::text[])`);
  if (p.source.length) where.push(`EXISTS (SELECT 1 FROM company_sources cs JOIN sources s ON s.id = cs.source_id WHERE cs.company_id = c.id AND s.key = ANY(${add(p.source)}::text[]))`);
  if (p.minCapacity) where.push(`c.export_capacity_tons >= ${add(p.minCapacity)}`);
  if (p.maxMinOrder) where.push(`c.minimum_order_kg <= ${add(p.maxMinOrder)}`);
  if (p.featured) where.push('c.is_featured');
  if (p.contactable) where.push(CONTACTABLE_SQL);

  const whereSql = where.join(' AND ');
  const whereParams = [...params];
  const nameBonus = parsed.terms.length
    ? parsed.terms.map((t) => `(CASE WHEN lower(c.name) LIKE ${add(`%${t}%`)} THEN 3 ELSE 0 END)`).join(' + ') : '0';
  const verifiedRank = "(CASE c.verification_level WHEN 'verified' THEN 0 WHEN 'contrasted' THEN 1 ELSE 2 END)";
  const statusRank = "(CASE c.record_status WHEN 'published' THEN 0 ELSE 1 END)";
  const ORDER: Record<SearchParams['sort'], string> = {
    // A igual coincidencia, primero las que se pueden contactar
    relevance: `(${matchExpr}) * 2 + ${nameBonus} DESC, (CASE WHEN ${CONTACTABLE_SQL} THEN 0 ELSE 1 END), ${statusRank}, ${verifiedRank}, c.is_featured DESC, c.name`,
    name: 'lower(c.name)',
    country: 'co.name NULLS LAST, lower(c.name)',
    newest: 'c.created_at DESC, c.id',
    verified: `${verifiedRank}, ${statusRank}, lower(c.name)`,
  };

  const total = Number((await one<{ n: string }>(q, `SELECT count(*) AS n FROM companies c LEFT JOIN countries co ON co.iso_code = c.country_code WHERE ${whereSql}`, whereParams))!.n);
  const offset = (p.page - 1) * p.pageSize;
  const rows = await many<{ id: string }>(q, `SELECT c.id FROM companies c LEFT JOIN countries co ON co.iso_code = c.country_code
    WHERE ${whereSql} ORDER BY ${ORDER[p.sort]} LIMIT ${add(p.pageSize)} OFFSET ${add(offset)}`, params);
  return {
    total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)),
    items: await companyCards(q, rows.map((r) => r.id)),
    interpreted: { terms: parsed.terms, countries, types },
  };
}

/** Tarjetas resumidas en el orden de `ids`. */
export async function companyCards(q: Queryable, ids: string[]): Promise<CompanyCard[]> {
  if (!ids.length) return [];
  const rows = await many<CompanyCard>(q, `SELECT c.id, c.slug, c.name, c.logo_url, c.city, c.region, c.country_code, co.name AS country_name, co.flag_url,
      c.company_types, c.verification_level, c.record_status, c.is_featured, c.is_demo, c.origin, c.domain, c.last_checked_at, c.created_at,
      c.website,
      coalesce(c.email, (SELECT k.email FROM company_contacts k WHERE k.company_id = c.id AND k.email IS NOT NULL AND NOT k.hidden AND (NOT k.is_personal OR k.consent_public) ORDER BY k.is_primary DESC, k.id LIMIT 1)) AS email,
      coalesce(c.phone, (SELECT k.phone FROM company_contacts k WHERE k.company_id = c.id AND k.phone IS NOT NULL AND NOT k.hidden AND (NOT k.is_personal OR k.consent_public) ORDER BY k.is_primary DESC, k.id LIMIT 1)) AS phone,
      (c.lei IS NOT NULL OR c.verification_level <> 'none' OR EXISTS (SELECT 1 FROM verification_events v WHERE v.company_id = c.id AND v.kind = 'registry_lookup' AND v.result = 'match')) AS sig_registry,
      c.website_status IN ('ok', 'redirect') AS sig_website,
      EXISTS (SELECT 1 FROM data_provenance d WHERE d.company_id = c.id AND (d.source_url LIKE 'https://www.google.com/maps%' OR d.source_url LIKE 'https://www.openstreetmap.org/%')) AS sig_maps,
      left(coalesce(c.description, c.main_activity, (SELECT snippet FROM company_sources WHERE company_id = c.id ORDER BY last_seen_at DESC LIMIT 1)), 200) AS excerpt,
      coalesce((SELECT array_agg(b.name ORDER BY b.sort_order) FROM business_types b WHERE b.slug = ANY(c.company_types)), '{}') AS type_names,
      coalesce((SELECT json_agg(json_build_object('name', ca.name, 'slug', ca.slug) ORDER BY ca.sort_order)
        FROM company_categories x JOIN categories ca ON ca.id = x.category_id
        WHERE x.company_id = c.id AND ca.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories ch JOIN company_categories y ON y.category_id = ch.id AND y.company_id = c.id WHERE ch.parent_id = ca.id)), '[]') AS sectors,
      coalesce((SELECT array_agg(ce.name ORDER BY ce.name) FROM company_certifications x JOIN certifications ce ON ce.id = x.certification_id WHERE x.company_id = c.id), '{}') AS certifications,
      coalesce((SELECT array_agg(DISTINCT s.key) FROM company_sources cs JOIN sources s ON s.id = cs.source_id WHERE cs.company_id = c.id), '{}') AS sources
    FROM companies c LEFT JOIN countries co ON co.iso_code = c.country_code WHERE c.id = ANY($1::uuid[])`, [ids]);
  const by = new Map(rows.map((r) => [r.id, normalizeRow(r)]));
  return ids.map((id) => by.get(id)).filter(Boolean) as CompanyCard[];
}

/** PGlite y pg devuelven fechas/JSON de forma ligeramente distinta: se homogeneiza. */
function normalizeRow<T extends Record<string, any>>(r: T): T {
  const out: Record<string, any> = { ...r };
  for (const [k, v] of Object.entries(out)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'string' && (k === 'sectors') ) out[k] = JSON.parse(v);
  }
  return out as T;
}

// ───────────────────────── Ficha ─────────────────────────

export async function companyDetail(q: Queryable, by: { slug?: string; id?: string }, { privateView = false } = {}) {
  const c = await one(q, `SELECT c.*, co.name AS country_name, co.flag_url FROM companies c LEFT JOIN countries co ON co.iso_code = c.country_code
    WHERE ${by.id ? 'c.id = $1' : 'c.slug = $1'} AND (c.deleted_at IS NULL OR $2)`, [by.id ?? by.slug, privateView]);
  if (!c) return null;
  const id = c.id as string;
  const [categories, offerings, certifications, languages, clientTypes, markets, contacts, sources, provenance, verifications, typeNames] = await Promise.all([
    many(q, `SELECT ca.id, ca.name, ca.slug, ca.parent_id FROM company_categories x JOIN categories ca ON ca.id = x.category_id WHERE x.company_id = $1 ORDER BY ca.parent_id NULLS FIRST, ca.sort_order`, [id]),
    many(q, 'SELECT kind, name, description, hs_code FROM offerings WHERE company_id = $1 ORDER BY kind, name', [id]),
    many(q, 'SELECT ce.slug, ce.name, x.evidence_url FROM company_certifications x JOIN certifications ce ON ce.id = x.certification_id WHERE x.company_id = $1 ORDER BY ce.name', [id]),
    many(q, 'SELECT l.code, l.name FROM company_languages x JOIN languages l ON l.code = x.language_code WHERE x.company_id = $1 ORDER BY l.name', [id]),
    many(q, 'SELECT t.slug, t.name FROM company_client_types x JOIN client_types t ON t.slug = x.client_type WHERE x.company_id = $1 ORDER BY t.name', [id]),
    many(q, 'SELECT m.direction, co.iso_code, co.name, co.flag_url FROM company_markets m JOIN countries co ON co.iso_code = m.country_code WHERE m.company_id = $1 ORDER BY co.name', [id]),
    many(q, 'SELECT * FROM company_contacts WHERE company_id = $1 ORDER BY is_primary DESC, id', [id]),
    many(q, `SELECT s.key, s.name, s.kind, s.reliability, cs.source_url, cs.title, cs.snippet, cs.first_seen_at, cs.last_seen_at
      FROM company_sources cs JOIN sources s ON s.id = cs.source_id WHERE cs.company_id = $1 ORDER BY s.reliability DESC`, [id]),
    many(q, `SELECT p.field, p.value, p.status, p.source_url, p.collected_at, p.checked_at, s.name AS source_name
      FROM data_provenance p LEFT JOIN sources s ON s.id = p.source_id WHERE p.company_id = $1 ORDER BY p.field, p.collected_at DESC`, [id]),
    many(q, `SELECT v.kind, v.result, v.details, v.created_at, s.name AS source_name FROM verification_events v LEFT JOIN sources s ON s.id = v.source_id
      WHERE v.company_id = $1 ORDER BY v.created_at DESC LIMIT 20`, [id]),
    many<{ slug: string; name: string }>(q, 'SELECT slug, name FROM business_types WHERE slug = ANY($1::text[]) ORDER BY sort_order', [c.company_types]),
  ]);
  const visibleContacts = contacts.filter((k) => privateView || (!k.hidden && (!k.is_personal || k.consent_public))).map((k) => ({
    id: k.id, full_name: k.full_name, job_title: k.job_title, languages: k.languages, is_primary: k.is_primary,
    is_personal: k.is_personal, consent_public: k.consent_public, hidden: k.hidden,
    email: k.email, phone: k.phone, whatsapp: k.whatsapp,
  }));
  const detail: Record<string, any> = normalizeRow({
    ...c, categories, offerings, certifications, languages, client_types: clientTypes,
    export_markets: markets.filter((m) => m.direction === 'export'), import_markets: markets.filter((m) => m.direction === 'import'),
    contacts: visibleContacts, has_private_contacts: contacts.length > visibleContacts.length,
    sources: sources.map(normalizeRow), provenance: provenance.map(normalizeRow), verifications: verifications.map(normalizeRow),
    type_names: typeNames,
  });
  delete detail.search_vector;
  delete detail.search_text;
  if (!privateView) {
    for (const k of ['tax_id', 'tax_id_normalized', 'rejection_reason', 'verified_by', 'deleted_at']) delete detail[k];
  } else {
    detail.changes = (await many(q, `SELECT ch.change_source, ch.changes, ch.created_at, p.email AS actor_email FROM company_changes ch
      LEFT JOIN profiles p ON p.id = ch.changed_by WHERE ch.company_id = $1 ORDER BY ch.created_at DESC LIMIT 50`, [id])).map(normalizeRow);
  }
  return detail;
}

export const isPubliclyVisible = (c: { record_status: string; deleted_at?: unknown }) =>
  !c.deleted_at && (c.record_status === 'published' || c.record_status === 'detected');

// ───────────────────────── Exportación ─────────────────────────

const LEVEL: Record<string, string> = { none: 'Sin verificar', contrasted: 'Información contrastada', verified: 'Verificada' };
const STATUS: Record<string, string> = { detected: 'Detectada (sin revisar)', pending_review: 'Pendiente de revisión', published: 'Publicada', hidden: 'Oculta', rejected: 'Rechazada' };

export function exportColumns(privateView: boolean): [string, string][] {
  const cols: [string, string][] = [
    ['Nombre', 'name'], ['Razón social', 'legal_name'], ['País', 'country_name'], ['Región', 'region'], ['Ciudad', 'city'],
    ['Actividad', 'type_names'], ['Sectores', 'sectors'], ['Productos y servicios', 'offerings'], ['Certificaciones', 'certifications'],
    ['Idiomas', 'languages'], ['Exporta a', 'export_markets'], ['Importa de', 'import_markets'],
    ['Capacidad exportación (t/año)', 'export_capacity_tons'], ['Pedido mínimo (kg)', 'minimum_order_kg'],
    ['Web', 'website'], ['Email corporativo', 'email'], ['Teléfono', 'phone'], ['Contacto', 'contact_name'], ['Email contacto', 'contact_email'],
    ['Estado', 'record_status'], ['Verificación', 'verification_level'], ['Fuentes', 'sources'], ['Última comprobación', 'last_checked_at'], ['Ficha', 'url'],
  ];
  if (privateView) cols.push(['NIF/ID fiscal', 'tax_id'], ['LEI', 'lei'], ['Origen', 'origin'], ['Alta', 'created_at'], ['Demo', 'is_demo']);
  return cols;
}

export async function exportRows(q: Queryable, ids: string[], siteUrl: string, { privateView = false } = {}) {
  const out: Record<string, unknown>[] = [];
  for (const id of ids) {
    const c = await companyDetail(q, { id }, { privateView });
    if (!c) continue;
    if (!privateView && !isPubliclyVisible(c as any)) continue;
    const k = c.contacts.find((x: any) => x.is_primary) || c.contacts[0] || {};
    const names = (a: any[], key = 'name') => a.map((x) => x[key]).join(', ');
    out.push({
      ...c,
      type_names: names(c.type_names), sectors: names(c.categories.filter((x: any) => x.parent_id)), offerings: names(c.offerings),
      certifications: names(c.certifications), languages: names(c.languages), export_markets: names(c.export_markets), import_markets: names(c.import_markets),
      contact_name: k.full_name, contact_email: k.email, record_status: STATUS[c.record_status], verification_level: LEVEL[c.verification_level],
      sources: names(c.sources), url: `${siteUrl}/empresa/${c.slug}`, is_demo: c.is_demo ? 'Sí' : 'No',
    });
  }
  return out;
}
