// Lógica de dominio de empresas: validación, guardado, búsqueda y fichas.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError, Validator, normalize, slugify, nowIso } from './util.js';

const STATUS = ['pending_review', 'approved', 'rejected'];
const VERIFICATION = ['verified', 'pending', 'unverified'];

const placeholders = (arr) => arr.map(() => '?').join(',');
const csvList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(','))
  .map((s) => String(s).trim()).filter(Boolean).slice(0, 30);

// ───────────────────────── Validación ─────────────────────────

export function validateCompany(db, body, { admin = false, requireContact = true } = {}) {
  const v = new Validator(body);
  const year = new Date().getFullYear();
  const d = {
    name: v.str('name', { required: true, max: 150, min: 2, label: 'El nombre' }),
    description: v.str('description', { max: 3000 }),
    website: v.url('website'),
    tax_id: v.str('tax_id', { max: 40 }),
    country_id: v.int('country_id', { required: true, min: 1 }),
    region: v.str('region', { max: 100 }),
    city: v.str('city', { required: true, max: 100, label: 'La ciudad' }),
    address: v.str('address', { max: 200 }),
    coverage_area: v.str('coverage_area', { max: 300 }),
    company_type: v.str('company_type', { required: true, max: 40, label: 'El tipo de empresa' }),
    year_founded: v.int('year_founded', { min: 1800, max: year }),
    export_capacity: v.int('export_capacity', { min: 0, max: 10_000_000 }),
    production_capacity: v.str('production_capacity', { max: 200 }),
    minimum_order: v.num('minimum_order', { min: 0, max: 1e9 }),
    minimum_order_notes: v.str('minimum_order_notes', { max: 200 }),
    commercial_terms: v.str('commercial_terms', { max: 1500 }),
    linkedin_url: v.url('linkedin_url'),
    instagram_url: v.url('instagram_url'),
    facebook_url: v.url('facebook_url'),
    other_social_url: v.url('other_social_url'),
    business_types: v.ids('business_types'),
    categories: v.ids('categories', { required: true }),
    products: v.ids('products', { max: 200 }),
    certifications: v.ids('certifications'),
    languages: v.ids('languages'),
    client_types: v.ids('client_types'),
    export_markets: v.ids('export_markets', { max: 250 }),
    import_markets: v.ids('import_markets', { max: 250 }),
    remove_logo: v.bool('remove_logo'),
  };

  if (d.country_id && !db.get('SELECT 1 FROM countries WHERE id = ?', d.country_id)) v.fail('country_id', 'País no válido');
  if (d.company_type && !db.get('SELECT 1 FROM business_types WHERE slug = ?', d.company_type)) v.fail('company_type', 'Tipo no válido');

  // Logo: data URL (el navegador lo redimensiona antes de enviarlo)
  if (body.logo_data) {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.logo_data));
    if (!m) v.fail('logo', 'Formato de imagen no admitido (PNG, JPG o WebP)');
    else {
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 400 * 1024) v.fail('logo', 'El logo no puede superar 400 KB');
      else d.logo = { ext: m[1] === 'jpeg' ? 'jpg' : m[1], buf };
    }
  }

  // Contactos
  const contacts = Array.isArray(body.contacts) ? body.contacts.slice(0, 10) : [];
  d.contacts = [];
  contacts.forEach((c, i) => {
    const cv = new Validator(c);
    const row = {
      full_name: cv.str('full_name', { required: true, max: 120, label: 'El nombre' }),
      job_title: cv.str('job_title', { max: 120 }),
      email: cv.email('email', { required: true }),
      phone: cv.phone('phone'),
      whatsapp: cv.phone('whatsapp'),
      languages: csvList(c.languages).filter((x) => /^[a-z]{2}$/.test(x)).join(','),
      is_primary: cv.bool('is_primary'),
      consent_public: cv.bool('consent_public'),
    };
    for (const [k, msg] of Object.entries(cv.errors)) v.fail(`contacts.${i}.${k}`, msg);
    if (row.full_name || row.email) d.contacts.push(row);
  });
  if (requireContact && !d.contacts.length) v.fail('contacts.0.full_name', 'Añade al menos una persona de contacto');

  if (admin) {
    d.status = v.oneOf('status', STATUS, { def: 'approved' });
    d.verification_status = v.oneOf('verification_status', VERIFICATION, { def: 'pending' });
    d.is_featured = v.bool('is_featured');
    d.rejection_reason = v.str('rejection_reason', { max: 500 });
  }
  v.done();
  return d;
}

// ───────────────────────── Guardado ─────────────────────────

function uniqueSlug(db, name, id) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; db.get('SELECT 1 FROM companies WHERE slug = ? AND id IS NOT ?', slug, id ?? null); i++) slug = `${base}-${i}`;
  return slug;
}

function replaceLinks(db, table, col, companyId, ids) {
  db.run(`DELETE FROM ${table} WHERE company_id = ?`, companyId);
  for (const id of ids) db.run(`INSERT OR IGNORE INTO ${table} (company_id, ${col}) VALUES (?, ?)`, companyId, id);
}

const COLUMNS = ['name', 'description', 'website', 'tax_id', 'country_id', 'region', 'city', 'address', 'coverage_area',
  'company_type', 'year_founded', 'export_capacity', 'production_capacity', 'minimum_order', 'minimum_order_notes',
  'commercial_terms', 'linkedin_url', 'instagram_url', 'facebook_url', 'other_social_url'];
const ADMIN_COLUMNS = ['status', 'verification_status', 'is_featured', 'rejection_reason'];

/**
 * Crea o actualiza una empresa con todas sus relaciones.
 * `extra` permite fijar columnas controladas por el sistema (status, is_demo, created_at…).
 */
export function saveCompany(db, d, id = null, extra = {}) {
  return db.tx(() => {
    const cols = [...COLUMNS, ...ADMIN_COLUMNS.filter((c) => c in d)];
    const values = { ...Object.fromEntries(cols.map((c) => [c, d[c]])), ...extra };
    values.slug = uniqueSlug(db, d.name, id);
    const keys = Object.keys(values);
    if (id) {
      db.run(`UPDATE companies SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...keys.map((k) => values[k]), nowIso(), id);
    } else {
      id = Number(db.run(`INSERT INTO companies (${keys.join(',')}) VALUES (${placeholders(keys)})`,
        ...keys.map((k) => values[k])).lastInsertRowid);
    }

    // Categorías: se guardan también las categorías padre y las de los productos elegidos
    const catIds = new Set(d.categories);
    if (d.products.length) {
      for (const r of db.all(`SELECT category_id FROM products WHERE id IN (${placeholders(d.products)})`, ...d.products)) catIds.add(r.category_id);
    }
    for (const cid of [...catIds]) {
      let p = db.get('SELECT parent_id FROM categories WHERE id = ?', cid);
      while (p?.parent_id) { catIds.add(p.parent_id); p = db.get('SELECT parent_id FROM categories WHERE id = ?', p.parent_id); }
    }
    const validCat = (ids, table) => ids.length
      ? db.all(`SELECT id FROM ${table} WHERE id IN (${placeholders(ids)})`, ...ids).map((r) => r.id) : [];

    replaceLinks(db, 'company_categories', 'category_id', id, validCat([...catIds], 'categories'));
    replaceLinks(db, 'company_products', 'product_id', id, validCat(d.products, 'products'));
    replaceLinks(db, 'company_certifications', 'certification_id', id, validCat(d.certifications, 'certifications'));
    replaceLinks(db, 'company_languages', 'language_id', id, validCat(d.languages, 'languages'));
    replaceLinks(db, 'company_client_types', 'client_type_id', id, validCat(d.client_types, 'client_types'));
    const primaryType = db.get('SELECT id FROM business_types WHERE slug = ?', d.company_type)?.id;
    replaceLinks(db, 'company_business_types', 'business_type_id', id,
      validCat([...new Set([primaryType, ...d.business_types].filter(Boolean))], 'business_types'));

    db.run('DELETE FROM company_markets WHERE company_id = ?', id);
    for (const [dir, list] of [['export', d.export_markets], ['import', d.import_markets]]) {
      for (const cid of validCat(list, 'countries')) {
        db.run('INSERT OR IGNORE INTO company_markets (company_id, country_id, direction) VALUES (?,?,?)', id, cid, dir);
      }
    }

    if (d.contacts) {
      db.run('DELETE FROM contacts WHERE company_id = ?', id);
      const hasPrimary = d.contacts.some((c) => c.is_primary);
      d.contacts.forEach((c, i) => db.run(
        `INSERT INTO contacts (company_id, full_name, job_title, email, phone, whatsapp, languages, is_primary, consent_public)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        id, c.full_name, c.job_title, c.email, c.phone, c.whatsapp, c.languages,
        hasPrimary ? c.is_primary : i === 0, c.consent_public,
      ));
    }

    if (d.logo) {
      const dir = path.join(config.uploadsDir, 'logos');
      fs.mkdirSync(dir, { recursive: true });
      const file = `${id}-${crypto.randomBytes(4).toString('hex')}.${d.logo.ext}`;
      fs.writeFileSync(path.join(dir, file), d.logo.buf);
      db.run('UPDATE companies SET logo_url = ? WHERE id = ?', `/uploads/logos/${file}`, id);
    } else if (d.remove_logo) {
      db.run('UPDATE companies SET logo_url = NULL WHERE id = ?', id);
    }

    refreshSearchIndex(db, id);
    return id;
  });
}

export function refreshSearchIndex(db, id) {
  const c = db.get(`SELECT c.*, co.name AS country_name FROM companies c JOIN countries co ON co.id = c.country_id WHERE c.id = ?`, id);
  if (!c) return;
  const names = (sql) => db.all(sql, id).map((r) => r.n).join(' ');
  const text = [
    c.name, c.description, c.city, c.region, c.country_name, c.coverage_area, c.production_capacity,
    names('SELECT ca.name || \' \' || ca.slug AS n FROM company_categories x JOIN categories ca ON ca.id = x.category_id WHERE x.company_id = ?'),
    names('SELECT p.name || \' \' || COALESCE(p.hs_code, \'\') AS n FROM company_products x JOIN products p ON p.id = x.product_id WHERE x.company_id = ?'),
    names('SELECT ce.name AS n FROM company_certifications x JOIN certifications ce ON ce.id = x.certification_id WHERE x.company_id = ?'),
    names('SELECT b.name AS n FROM company_business_types x JOIN business_types b ON b.id = x.business_type_id WHERE x.company_id = ?'),
    names('SELECT t.name AS n FROM company_client_types x JOIN client_types t ON t.id = x.client_type_id WHERE x.company_id = ?'),
  ].join(' ');
  db.run('UPDATE companies SET search_name = ?, search_text = ? WHERE id = ?', normalize(c.name), normalize(text), id);
}

// ───────────────────────── Búsqueda ─────────────────────────

export function searchCompanies(db, q, { admin = false, ids = null, all = false } = {}) {
  const where = [];
  const params = [];
  const list = (k) => csvList(q.get?.(k) ?? q[k]);
  const val = (k) => String(q.get?.(k) ?? q[k] ?? '').trim();

  if (!admin) where.push("c.status = 'approved'");
  else if (val('status')) { where.push(`c.status IN (${placeholders(list('status'))})`); params.push(...list('status')); }

  if (ids) { where.push(`c.id IN (${placeholders(ids) || 'NULL'})`); params.push(...ids); }

  const terms = normalize(val('q')).split(/\s+/).filter((t) => t.length >= 2).slice(0, 6);
  for (const t of terms) { where.push('c.search_text LIKE ?'); params.push(`%${t}%`); }

  const hasLink = (table, col, lookup, lookupCol, values, mode = 'any') => {
    if (!values.length) return;
    if (mode === 'any') {
      where.push(`EXISTS (SELECT 1 FROM ${table} x JOIN ${lookup} l ON l.id = x.${col} WHERE x.company_id = c.id AND l.${lookupCol} IN (${placeholders(values)}))`);
      params.push(...values);
    } else {
      for (const v of values) {
        where.push(`EXISTS (SELECT 1 FROM ${table} x JOIN ${lookup} l ON l.id = x.${col} WHERE x.company_id = c.id AND l.${lookupCol} = ?)`);
        params.push(v);
      }
    }
  };
  hasLink('company_categories', 'category_id', 'categories', 'slug', list('category'));
  hasLink('company_categories', 'category_id', 'categories', 'slug', list('subcategory'));
  hasLink('company_business_types', 'business_type_id', 'business_types', 'slug', list('type'));
  hasLink('company_certifications', 'certification_id', 'certifications', 'slug', list('cert'), 'all');
  hasLink('company_languages', 'language_id', 'languages', 'code', list('lang'), 'all');
  hasLink('company_client_types', 'client_type_id', 'client_types', 'slug', list('client'));
  hasLink('company_products', 'product_id', 'products', 'id', list('product').map(Number));

  const countries = list('country').map((s) => s.toUpperCase());
  if (countries.length) { where.push(`co.iso_code IN (${placeholders(countries)})`); params.push(...countries); }
  if (val('region')) { where.push('lower(c.region) = lower(?)'); params.push(val('region')); }
  if (val('city')) { where.push('c.city LIKE ?'); params.push(`%${val('city')}%`); }
  const ver = list('verification').filter((s) => VERIFICATION.includes(s));
  if (ver.length) { where.push(`c.verification_status IN (${placeholders(ver)})`); params.push(...ver); }
  if (val('minCapacity') && Number(val('minCapacity')) > 0) { where.push('c.export_capacity >= ?'); params.push(Number(val('minCapacity'))); }
  if (val('maxMinOrder') && Number(val('maxMinOrder')) > 0) { where.push('c.minimum_order <= ?'); params.push(Number(val('maxMinOrder'))); }
  if (val('featured') === '1') where.push('c.is_featured = 1');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const scoreSql = terms.length
    ? terms.map(() => '(CASE WHEN instr(c.search_name, ?) > 0 THEN 10 ELSE 0 END)').join(' + ')
    : '0';
  const scoreParams = terms;

  const verifiedFirst = "(CASE c.verification_status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END)";
  const SORTS = {
    relevance: `score DESC, ${verifiedFirst}, c.is_featured DESC, c.name COLLATE NOCASE`,
    name: 'c.name COLLATE NOCASE',
    country: 'co.name, c.name COLLATE NOCASE',
    newest: 'c.created_at DESC, c.id DESC',
    verified: `${verifiedFirst}, c.name COLLATE NOCASE`,
  };
  const sort = SORTS[val('sort')] ? val('sort') : 'relevance';

  const total = db.get(`SELECT COUNT(*) AS n FROM companies c JOIN countries co ON co.id = c.country_id ${whereSql}`, ...params).n;
  const pageSize = all ? 10000 : Math.min(Math.max(Number(val('pageSize')) || 12, 1), 48);
  const page = all ? 1 : Math.max(Number(val('page')) || 1, 1);

  const rows = db.all(
    `SELECT c.id, ${scoreSql} AS score FROM companies c JOIN countries co ON co.id = c.country_id
     ${whereSql} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`,
    ...scoreParams, ...params, pageSize, (page - 1) * pageSize,
  );
  return { total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), sort, items: companyCards(db, rows.map((r) => r.id)) };
}

/** Datos resumidos para tarjetas, manteniendo el orden de `ids`. */
export function companyCards(db, ids) {
  if (!ids.length) return [];
  const ph = placeholders(ids);
  const rows = db.all(
    `SELECT c.id, c.slug, c.name, c.logo_url, c.city, c.region, c.company_type, b.name AS company_type_name,
            c.verification_status, c.status, c.is_featured, c.is_demo, c.created_at, c.export_capacity, c.minimum_order,
            substr(c.description, 1, 180) AS excerpt,
            co.name AS country_name, co.iso_code AS country_iso, co.flag_url
       FROM companies c JOIN countries co ON co.id = c.country_id
       LEFT JOIN business_types b ON b.slug = c.company_type
      WHERE c.id IN (${ph})`, ...ids);
  const by = new Map(rows.map((r) => [r.id, { ...r, categories: [], subcategories: [], certifications: [] }]));
  for (const r of db.all(
    `SELECT x.company_id, ca.name, ca.slug, ca.parent_id FROM company_categories x JOIN categories ca ON ca.id = x.category_id
      WHERE x.company_id IN (${ph}) ORDER BY ca.sort_order, ca.name`, ...ids)) {
    by.get(r.company_id)?.[r.parent_id ? 'subcategories' : 'categories'].push({ name: r.name, slug: r.slug });
  }
  for (const r of db.all(
    `SELECT x.company_id, ce.name, ce.slug FROM company_certifications x JOIN certifications ce ON ce.id = x.certification_id
      WHERE x.company_id IN (${ph}) ORDER BY ce.name`, ...ids)) {
    by.get(r.company_id)?.certifications.push({ name: r.name, slug: r.slug });
  }
  return ids.map((id) => by.get(id)).filter(Boolean);
}

// ───────────────────────── Ficha ─────────────────────────

/**
 * Ficha completa. `privateView` (admin o propietario) incluye NIF y contactos sin restricciones.
 */
export function companyDetail(db, { id, slug }, { privateView = false } = {}) {
  const c = db.get(
    `SELECT c.*, co.name AS country_name, co.iso_code AS country_iso, co.flag_url, b.name AS company_type_name
       FROM companies c JOIN countries co ON co.id = c.country_id
       LEFT JOIN business_types b ON b.slug = c.company_type
      WHERE ${id ? 'c.id = ?' : 'c.slug = ?'}`, id ?? slug);
  if (!c) return null;
  const cid = c.id;
  delete c.search_text; delete c.search_name;
  const out = { ...c };
  out.categories = db.all(`SELECT ca.id, ca.name, ca.slug, ca.parent_id FROM company_categories x JOIN categories ca ON ca.id = x.category_id
    WHERE x.company_id = ? ORDER BY ca.parent_id IS NOT NULL, ca.sort_order, ca.name`, cid);
  out.products = db.all(`SELECT p.id, p.name, p.hs_code, p.category_id FROM company_products x JOIN products p ON p.id = x.product_id
    WHERE x.company_id = ? ORDER BY p.name`, cid);
  out.certifications = db.all(`SELECT ce.id, ce.name, ce.slug FROM company_certifications x JOIN certifications ce ON ce.id = x.certification_id
    WHERE x.company_id = ? ORDER BY ce.name`, cid);
  out.languages = db.all(`SELECT l.id, l.code, l.name FROM company_languages x JOIN languages l ON l.id = x.language_id
    WHERE x.company_id = ? ORDER BY l.name`, cid);
  out.business_types = db.all(`SELECT b.id, b.slug, b.name FROM company_business_types x JOIN business_types b ON b.id = x.business_type_id
    WHERE x.company_id = ? ORDER BY b.name`, cid);
  out.client_types = db.all(`SELECT t.id, t.slug, t.name FROM company_client_types x JOIN client_types t ON t.id = x.client_type_id
    WHERE x.company_id = ? ORDER BY t.name`, cid);
  const markets = db.all(`SELECT m.direction, co.id, co.name, co.iso_code, co.flag_url FROM company_markets m JOIN countries co ON co.id = m.country_id
    WHERE m.company_id = ? ORDER BY co.name`, cid);
  out.export_markets = markets.filter((m) => m.direction === 'export');
  out.import_markets = markets.filter((m) => m.direction === 'import');
  const contacts = db.all('SELECT * FROM contacts WHERE company_id = ? ORDER BY is_primary DESC, id', cid);
  out.contacts = contacts.map((k) => {
    const pub = privateView || k.consent_public;
    return {
      id: k.id, full_name: k.full_name, job_title: k.job_title, languages: k.languages,
      is_primary: k.is_primary, consent_public: k.consent_public,
      email: pub ? k.email : null, phone: pub ? k.phone : null, whatsapp: pub ? k.whatsapp : null,
    };
  });
  if (!privateView) {
    delete out.tax_id; delete out.rejection_reason;
  }
  return out;
}

// ───────────────────────── Exportación ─────────────────────────

export function exportColumns(privateView) {
  const cols = [
    ['Nombre', 'name'], ['País', 'country_name'], ['Región', 'region'], ['Ciudad', 'city'],
    ['Tipo principal', 'company_type_name'], ['Tipos', 'business_types'], ['Categorías', 'categories'],
    ['Productos', 'products'], ['Certificaciones', 'certifications'], ['Idiomas', 'languages'],
    ['Clientes', 'client_types'], ['Mercados exportación', 'export_markets'], ['Origen importación', 'import_markets'],
    ['Capacidad exportación (t/año)', 'export_capacity'], ['Pedido mínimo (kg)', 'minimum_order'],
    ['Pedido mínimo (notas)', 'minimum_order_notes'], ['Verificación', 'verification_status'],
    ['Web', 'website'], ['Contacto', 'contact_name'], ['Cargo', 'contact_title'], ['Email', 'contact_email'],
    ['Teléfono', 'contact_phone'], ['WhatsApp', 'contact_whatsapp'], ['Ficha', 'profile_url'],
  ];
  if (privateView) cols.push(['Estado', 'status'], ['NIF/ID fiscal', 'tax_id'], ['Alta', 'created_at'], ['Datos demo', 'is_demo']);
  return cols;
}

export function exportRows(db, ids, { privateView = false } = {}) {
  const VER = { verified: 'Verificada', pending: 'Pendiente', unverified: 'No verificada' };
  return ids.map((id) => {
    const c = companyDetail(db, { id }, { privateView });
    const k = c.contacts.find((x) => x.is_primary) || c.contacts[0] || {};
    const names = (a, key = 'name') => a.map((x) => x[key]).join(', ');
    return {
      ...c,
      business_types: names(c.business_types), categories: names(c.categories), products: names(c.products),
      certifications: names(c.certifications), languages: names(c.languages), client_types: names(c.client_types),
      export_markets: names(c.export_markets), import_markets: names(c.import_markets),
      verification_status: VER[c.verification_status], contact_name: k.full_name, contact_title: k.job_title,
      contact_email: k.email, contact_phone: k.phone, contact_whatsapp: k.whatsapp,
      profile_url: `${config.baseUrl}/#/empresa/${c.slug}`, is_demo: c.is_demo ? 'Sí' : 'No',
    };
  });
}

export function assertCompany(db, slug) {
  const c = db.get("SELECT id, name, slug FROM companies WHERE slug = ? AND status = 'approved'", slug);
  if (!c) throw new HttpError(404, 'Empresa no encontrada');
  return c;
}
