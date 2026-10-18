// Área de administración (rol admin).
import { config } from '../config.js';
import { requireAdmin } from '../auth.js';
import { sendMail } from '../mailer.js';
import { HttpError, Validator, normalize, slugify } from '../util.js';
import { companyDetail, exportColumns, exportRows, saveCompany, searchCompanies, validateCompany } from '../companies.js';
import { exportFile } from './public.js';

// Taxonomías gestionables: añadir países, categorías o certificaciones no requiere tocar código.
const TAXONOMIES = {
  categories: { table: 'categories', order: 'parent_id IS NOT NULL, parent_id, sort_order, name',
    fields: { name: 'name', slug: 'slug', parent_id: 'ref:categories', sort_order: 'int' } },
  products: { table: 'products', order: 'category_id, name',
    fields: { name: 'name', category_id: 'ref:categories!', hs_code: 'text' } },
  countries: { table: 'countries', order: 'is_priority DESC, sort_order, name',
    fields: { name: 'name', iso_code: 'iso', flag_url: 'text', is_priority: 'bool', sort_order: 'int' } },
  certifications: { table: 'certifications', order: 'name', fields: { name: 'name', slug: 'slug' } },
  languages: { table: 'languages', order: 'id', fields: { code: 'lang', name: 'name' } },
  'business-types': { table: 'business_types', order: 'id', fields: { slug: 'slug', name: 'name' } },
  'client-types': { table: 'client_types', order: 'id', fields: { slug: 'slug', name: 'name' } },
};

function taxonomyValues(db, def, body) {
  const v = new Validator(body);
  const out = {};
  for (const [field, kind] of Object.entries(def.fields)) {
    if (kind === 'name') out[field] = v.str(field, { required: true, max: 120, label: 'El nombre' });
    else if (kind === 'text') out[field] = v.str(field, { max: 300 });
    else if (kind === 'int') out[field] = v.int(field, { min: 0, max: 100000 }) ?? 100;
    else if (kind === 'bool') out[field] = v.bool(field) ? 1 : 0;
    else if (kind === 'slug') out[field] = slugify(v.str(field, { max: 80 }) || body.name || '');
    else if (kind === 'iso') {
      const iso = (v.str(field, { required: true, max: 2, min: 2, label: 'El código ISO' }) || '').toUpperCase();
      if (iso && !/^[A-Z]{2}$/.test(iso)) v.fail(field, 'Usa el código ISO de 2 letras');
      out[field] = iso;
    } else if (kind === 'lang') {
      const code = (v.str(field, { required: true, max: 2, min: 2 }) || '').toLowerCase();
      if (code && !/^[a-z]{2}$/.test(code)) v.fail(field, 'Usa el código ISO 639-1 de 2 letras');
      out[field] = code;
    } else if (kind.startsWith('ref:')) {
      const table = kind.slice(4).replace('!', '');
      const id = v.int(field, { required: kind.endsWith('!'), min: 1 });
      if (id && !db.get(`SELECT 1 FROM ${table} WHERE id = ?`, id)) v.fail(field, 'Referencia no válida');
      out[field] = id;
    }
  }
  v.done();
  return out;
}

const sqlError = (e) => {
  if (/UNIQUE/.test(e.message)) return new HttpError(409, 'Ya existe un elemento con ese nombre, código o slug');
  if (/FOREIGN KEY/.test(e.message)) return new HttpError(409, 'No se puede eliminar: está en uso por alguna empresa');
  return e;
};

const statusMail = {
  approved: (c) => ['Tu empresa ya está publicada', `¡Enhorabuena! ${c.name} ya es visible en GlobalTrade Connect: ${config.baseUrl}/#/empresa/${c.slug}`],
  rejected: (c, reason) => ['Tu solicitud de alta no ha sido aprobada', `La ficha de ${c.name} no ha sido aprobada.${reason ? `\n\nMotivo: ${reason}` : ''}\n\nPuedes corregir los datos desde tu cuenta.`],
};

export function registerAdminRoutes(r, db) {
  const A = requireAdmin;

  // ───────────── Estadísticas ─────────────
  r.get('/api/admin/stats', A, () => ({
    totals: db.get(`SELECT COUNT(*) AS companies,
        SUM(status = 'approved') AS approved, SUM(status = 'pending_review') AS pending_review, SUM(status = 'rejected') AS rejected,
        SUM(verification_status = 'verified') AS verified,
        (SELECT COUNT(*) FROM inquiries) AS inquiries, (SELECT COUNT(*) FROM inquiries WHERE status = 'new') AS inquiries_new,
        (SELECT COUNT(*) FROM supplier_requests) AS supplier_requests, (SELECT COUNT(*) FROM supplier_requests WHERE status = 'new') AS supplier_requests_new,
        (SELECT COUNT(*) FROM data_reports WHERE status = 'new') AS reports_new,
        (SELECT COUNT(*) FROM privacy_requests WHERE status = 'new') AS privacy_new
      FROM companies`),
    by_country: db.all(`SELECT co.name, co.iso_code, co.flag_url, COUNT(c.id) AS n, SUM(c.verification_status = 'verified') AS verified
      FROM countries co LEFT JOIN companies c ON c.country_id = co.id AND c.status = 'approved'
      GROUP BY co.id HAVING n > 0 OR co.is_priority = 1 ORDER BY n DESC, co.name`),
    by_category: db.all(`SELECT ca.name, ca.slug, ca.parent_id, COUNT(c.id) AS n FROM categories ca
      LEFT JOIN company_categories x ON x.category_id = ca.id LEFT JOIN companies c ON c.id = x.company_id AND c.status = 'approved'
      GROUP BY ca.id ORDER BY ca.parent_id IS NOT NULL, n DESC`),
    by_type: db.all(`SELECT b.name, COUNT(c.id) AS n FROM business_types b LEFT JOIN companies c ON c.company_type = b.slug AND c.status = 'approved'
      GROUP BY b.id ORDER BY n DESC`),
    inquiries_by_month: db.all(`SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS n FROM inquiries
      GROUP BY month ORDER BY month DESC LIMIT 12`),
  }));

  // ───────────── Empresas ─────────────
  r.get('/api/admin/companies', A, (ctx) => {
    if (!ctx.query.get('sort')) ctx.query.set('sort', 'newest');
    return searchCompanies(db, ctx.query, { admin: true });
  });
  r.get('/api/admin/companies/:id', A, (ctx) => {
    const c = companyDetail(db, { id: Number(ctx.params.id) }, { privateView: true });
    if (!c) throw new HttpError(404, 'Empresa no encontrada');
    c.users = db.all('SELECT id, name, email, created_at FROM users WHERE company_id = ?', c.id);
    return { company: c };
  });
  r.post('/api/admin/companies', A, (ctx) => {
    const d = validateCompany(db, ctx.body, { admin: true, requireContact: false });
    return { id: saveCompany(db, d) };
  });
  r.put('/api/admin/companies/:id', A, (ctx) => {
    const id = Number(ctx.params.id);
    if (!db.get('SELECT 1 FROM companies WHERE id = ?', id)) throw new HttpError(404, 'Empresa no encontrada');
    const d = validateCompany(db, ctx.body, { admin: true, requireContact: false });
    saveCompany(db, d, id);
    return { company: companyDetail(db, { id }, { privateView: true }) };
  });
  r.delete('/api/admin/companies/:id', A, (ctx) => {
    const r2 = db.run('DELETE FROM companies WHERE id = ?', Number(ctx.params.id));
    if (!r2.changes) throw new HttpError(404, 'Empresa no encontrada');
    return { ok: true };
  });
  // Acciones rápidas: aprobar, rechazar, verificar, destacar
  r.post('/api/admin/companies/:id/status', A, (ctx) => {
    const id = Number(ctx.params.id);
    const c = db.get('SELECT * FROM companies WHERE id = ?', id);
    if (!c) throw new HttpError(404, 'Empresa no encontrada');
    const v = new Validator(ctx.body);
    const status = v.oneOf('status', ['pending_review', 'approved', 'rejected']);
    const verification = v.oneOf('verification_status', ['verified', 'pending', 'unverified']);
    const reason = v.str('rejection_reason', { max: 500 });
    v.done();
    const sets = [];
    const params = [];
    if (status) { sets.push('status = ?', 'rejection_reason = ?'); params.push(status, status === 'rejected' ? reason : null); }
    if (verification) { sets.push('verification_status = ?'); params.push(verification); }
    if ('is_featured' in ctx.body) { sets.push('is_featured = ?'); params.push(v.bool('is_featured') ? 1 : 0); }
    if (!sets.length) throw new HttpError(400, 'Nada que actualizar');
    db.run(`UPDATE companies SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, ...params, id);
    if (status && status !== c.status && statusMail[status]) {
      const to = db.get('SELECT email FROM contacts WHERE company_id = ? ORDER BY is_primary DESC, id LIMIT 1', id)?.email;
      const [subject, body] = statusMail[status](c, reason);
      sendMail(db, { to, subject, body, relatedType: 'company', relatedId: id });
    }
    return { company: companyDetail(db, { id }, { privateView: true }) };
  });

  // ───────────── Duplicados ─────────────
  r.get('/api/admin/duplicates', A, () => {
    const rows = db.all(`SELECT c.id, c.name, c.slug, c.website, c.tax_id, c.status, co.name AS country_name FROM companies c
      JOIN countries co ON co.id = c.country_id`);
    const emails = db.all('SELECT company_id, lower(email) AS email FROM contacts WHERE email IS NOT NULL');
    const byId = new Map(rows.map((x) => [x.id, x]));
    const groups = [];
    const group = (reason, keyFn, list = rows) => {
      const m = new Map();
      for (const x of list) {
        const k = keyFn(x);
        if (!k) continue;
        const ids = m.get(k) || new Set();
        ids.add(x.company_id ?? x.id);
        m.set(k, ids);
      }
      for (const [k, ids] of m) if (ids.size > 1) groups.push({ reason, key: k, companies: [...ids].map((i) => byId.get(i)) });
    };
    const STOP = /\b(s\.?a\.?s?|s\.?l\.?u?|ltda|ltd|gmbh|ag|sa|srl|bv|nv|bvba|inc|llc|cia|y|e|and|de|del|la|el)\b/g;
    group('Nombre similar', (x) => normalize(x.name).replace(STOP, '').replace(/[^a-z0-9]/g, ''));
    group('Mismo email de contacto', (x) => x.email, emails);
    group('Mismo sitio web', (x) => { try { return new URL(x.website).hostname.replace(/^www\./, ''); } catch { return null; } });
    group('Mismo identificador fiscal', (x) => (x.tax_id ? x.tax_id.toUpperCase().replace(/[^A-Z0-9]/g, '') : null));
    return { groups };
  });

  // ───────────── Leads ─────────────
  const listWithStatus = (sql, statuses) => (ctx) => {
    const st = ctx.query.get('status');
    return { items: db.all(sql.replace('/*WHERE*/', st && statuses.includes(st) ? 'WHERE x.status = ?' : ''), ...(st && statuses.includes(st) ? [st] : [])) };
  };
  const updateStatus = (table, statuses) => (ctx) => {
    const v = new Validator(ctx.body);
    const status = v.oneOf('status', statuses, { required: true });
    v.done();
    const r2 = db.run(`UPDATE ${table} SET status = ? WHERE id = ?`, status, Number(ctx.params.id));
    if (!r2.changes) throw new HttpError(404, 'No encontrado');
    return { ok: true };
  };

  const INQ = ['new', 'read', 'answered', 'archived'];
  const INQ_SQL = `SELECT x.*, c.name AS company_name, c.slug AS company_slug FROM inquiries x JOIN companies c ON c.id = x.company_id /*WHERE*/ ORDER BY x.created_at DESC LIMIT 500`;
  r.get('/api/admin/inquiries', A, listWithStatus(INQ_SQL, INQ));
  r.put('/api/admin/inquiries/:id', A, updateStatus('inquiries', INQ));

  const SR = ['new', 'in_progress', 'closed'];
  const SR_SQL = `SELECT x.*, ca.name AS category_name FROM supplier_requests x LEFT JOIN categories ca ON ca.id = x.category_id /*WHERE*/ ORDER BY x.created_at DESC LIMIT 500`;
  r.get('/api/admin/supplier-requests', A, listWithStatus(SR_SQL, SR));
  r.put('/api/admin/supplier-requests/:id', A, updateStatus('supplier_requests', SR));

  const REP = ['new', 'resolved', 'dismissed'];
  r.get('/api/admin/reports', A, listWithStatus(`SELECT x.*, c.name AS company_name, c.slug AS company_slug FROM data_reports x
    JOIN companies c ON c.id = x.company_id /*WHERE*/ ORDER BY x.created_at DESC LIMIT 500`, REP));
  r.put('/api/admin/reports/:id', A, updateStatus('data_reports', REP));

  const PRIV = ['new', 'completed', 'rejected'];
  r.get('/api/admin/privacy-requests', A, listWithStatus('SELECT x.* FROM privacy_requests x /*WHERE*/ ORDER BY x.created_at DESC LIMIT 500', PRIV));
  r.put('/api/admin/privacy-requests/:id', A, updateStatus('privacy_requests', PRIV));

  // Ejecuta el derecho de supresión: anonimiza leads y elimina contactos/cuentas con ese email
  r.post('/api/admin/privacy-requests/:id/execute', A, (ctx) => {
    const pr = db.get('SELECT * FROM privacy_requests WHERE id = ?', Number(ctx.params.id));
    if (!pr) throw new HttpError(404, 'Solicitud no encontrada');
    if (pr.request_type !== 'deletion') throw new HttpError(400, 'Solo aplicable a solicitudes de supresión');
    const email = pr.email.toLowerCase();
    const res = db.tx(() => ({
      inquiries: db.run(`UPDATE inquiries SET sender_name = '[eliminado]', sender_company = NULL, email = 'eliminado@anonimizado.invalid',
        phone = NULL, message = '[Contenido eliminado por solicitud RGPD]' WHERE lower(email) = ?`, email).changes,
      supplier_requests: db.run(`UPDATE supplier_requests SET user_name = '[eliminado]', company_name = NULL, email = 'eliminado@anonimizado.invalid',
        phone = NULL, notes = NULL WHERE lower(email) = ?`, email).changes,
      reports: db.run('UPDATE data_reports SET reporter_email = NULL WHERE lower(reporter_email) = ?', email).changes,
      contacts: db.run('DELETE FROM contacts WHERE lower(email) = ?', email).changes,
      users: db.run("DELETE FROM users WHERE lower(email) = ? AND role != 'admin'", email).changes,
      outbox: db.run("UPDATE mail_outbox SET to_email = 'eliminado@anonimizado.invalid', body = '[eliminado]' WHERE lower(to_email) = ?", email).changes,
    }));
    db.run("UPDATE privacy_requests SET status = 'completed', resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), details = NULL WHERE id = ?", pr.id);
    return { ok: true, affected: res };
  });

  r.get('/api/admin/outbox', A, () => ({ items: db.all('SELECT * FROM mail_outbox ORDER BY id DESC LIMIT 200') }));

  // ───────────── Taxonomías ─────────────
  const tax = (ctx) => {
    const def = TAXONOMIES[ctx.params.type];
    if (!def) throw new HttpError(404, 'Taxonomía desconocida');
    return def;
  };
  r.get('/api/admin/taxonomy/:type', A, (ctx) => {
    const def = tax(ctx);
    return { items: db.all(`SELECT * FROM ${def.table} ORDER BY ${def.order}`) };
  });
  r.post('/api/admin/taxonomy/:type', A, (ctx) => {
    const def = tax(ctx);
    const vals = taxonomyValues(db, def, ctx.body);
    const keys = Object.keys(vals);
    try {
      return { id: db.run(`INSERT INTO ${def.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => vals[k])).lastInsertRowid };
    } catch (e) { throw sqlError(e); }
  });
  r.put('/api/admin/taxonomy/:type/:id', A, (ctx) => {
    const def = tax(ctx);
    const vals = taxonomyValues(db, def, ctx.body);
    if (def.table === 'categories' && Number(vals.parent_id) === Number(ctx.params.id)) throw new HttpError(422, 'Una categoría no puede ser su propio padre');
    const keys = Object.keys(vals);
    try {
      db.run(`UPDATE ${def.table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => vals[k]), Number(ctx.params.id));
    } catch (e) { throw sqlError(e); }
    return { ok: true };
  });
  r.delete('/api/admin/taxonomy/:type/:id', A, (ctx) => {
    const def = tax(ctx);
    if (def.table === 'business_types') {
      const slug = db.get('SELECT slug FROM business_types WHERE id = ?', Number(ctx.params.id))?.slug;
      if (slug && db.get('SELECT 1 FROM companies WHERE company_type = ?', slug)) throw new HttpError(409, 'No se puede eliminar: es el tipo principal de alguna empresa');
    }
    try { db.run(`DELETE FROM ${def.table} WHERE id = ?`, Number(ctx.params.id)); } catch (e) { throw sqlError(e); }
    return { ok: true };
  });

  // ───────────── Exportaciones (CSV / Excel) ─────────────
  r.get('/api/admin/export/:entity', A, (ctx) => {
    const format = ctx.query.get('format') === 'xlsx' ? 'xlsx' : 'csv';
    switch (ctx.params.entity) {
      case 'companies': {
        const ids = db.all(`SELECT id FROM companies ${ctx.query.get('status') ? 'WHERE status = ?' : ''} ORDER BY name`,
          ...(ctx.query.get('status') ? [ctx.query.get('status')] : [])).map((x) => x.id);
        return exportFile(exportRows(db, ids, { privateView: true }), exportColumns(true), 'empresas', format);
      }
      case 'inquiries':
        return exportFile(db.all(INQ_SQL.replace('/*WHERE*/', '').replace('LIMIT 500', '')), [
          ['Fecha', 'created_at'], ['Tipo', 'inquiry_type'], ['Estado', 'status'], ['Empresa destinataria', 'company_name'],
          ['Nombre', 'sender_name'], ['Empresa solicitante', 'sender_company'], ['País', 'sender_country'], ['Email', 'email'],
          ['Teléfono', 'phone'], ['Producto', 'product_interest'], ['Volumen', 'estimated_volume'], ['Mensaje', 'message']], 'leads-contacto', format);
      case 'supplier-requests':
        return exportFile(db.all(SR_SQL.replace('/*WHERE*/', '').replace('LIMIT 500', '')), [
          ['Fecha', 'created_at'], ['Estado', 'status'], ['Nombre', 'user_name'], ['Empresa', 'company_name'], ['Email', 'email'],
          ['Teléfono', 'phone'], ['Producto', 'product'], ['Categoría', 'category_name'], ['Países de origen', 'origin_countries'],
          ['Certificaciones', 'certifications'], ['Cantidad', 'quantity'], ['Fecha objetivo', 'target_date'], ['Notas', 'notes']], 'solicitudes-proveedores', format);
      default: throw new HttpError(404, 'Exportación desconocida');
    }
  });
}
