// Rutas públicas, autenticación, favoritos y área de empresa registrada.
import { config } from '../config.js';
import { FileResponse } from '../http.js';
import { HttpError, Validator } from '../util.js';
import { sendMail } from '../mailer.js';
import { checkSpam, formToken, rateLimit } from '../spam.js';
import { createSession, destroySession, hashPassword, passwordProblems, requireUser, verifyPassword } from '../auth.js';
import {
  assertCompany, companyCards, companyDetail, exportColumns, exportRows, saveCompany, searchCompanies, validateCompany,
} from '../companies.js';
import { toCSV, toXLSX } from '../export.js';

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportFile(rows, columns, base, format) {
  if (format === 'xlsx') {
    return new FileResponse(toXLSX(rows, columns, base), `${base}-${stamp()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  return new FileResponse(toCSV(rows, columns), `${base}-${stamp()}.csv`, 'text/csv; charset=utf-8');
}

const primaryEmail = (db, companyId) =>
  db.get('SELECT email FROM contacts WHERE company_id = ? AND email IS NOT NULL ORDER BY is_primary DESC, id LIMIT 1', companyId)?.email;

export function registerPublicRoutes(r, db) {
  // ───────────── Catálogos para filtros y formularios ─────────────
  r.get('/api/meta', () => {
    const approved = "c.status = 'approved'";
    return {
      countries: db.all(`SELECT co.*, (SELECT COUNT(*) FROM companies c WHERE c.country_id = co.id AND ${approved}) AS company_count
                           FROM countries co ORDER BY co.is_priority DESC, co.sort_order, co.name`),
      categories: db.all(`SELECT ca.*, (SELECT COUNT(*) FROM company_categories x JOIN companies c ON c.id = x.company_id
                            WHERE x.category_id = ca.id AND ${approved}) AS company_count
                            FROM categories ca ORDER BY ca.sort_order, ca.name`),
      products: db.all('SELECT * FROM products ORDER BY name'),
      certifications: db.all('SELECT * FROM certifications ORDER BY name'),
      languages: db.all('SELECT * FROM languages ORDER BY id'),
      business_types: db.all('SELECT * FROM business_types ORDER BY id'),
      client_types: db.all('SELECT * FROM client_types ORDER BY id'),
      locations: db.all(`SELECT co.iso_code AS country, c.region, c.city, COUNT(*) AS n FROM companies c
                           JOIN countries co ON co.id = c.country_id WHERE ${approved}
                          GROUP BY co.iso_code, c.region, c.city ORDER BY c.region, c.city`),
    };
  });

  r.get('/api/home', () => {
    const ids = (sql) => db.all(sql).map((x) => x.id);
    return {
      featured: companyCards(db, ids("SELECT id FROM companies WHERE status = 'approved' AND is_featured = 1 ORDER BY verification_status = 'verified' DESC, name LIMIT 6")),
      latest: companyCards(db, ids("SELECT id FROM companies WHERE status = 'approved' ORDER BY created_at DESC LIMIT 6")),
      stats: db.get(`SELECT COUNT(*) AS companies, COUNT(DISTINCT country_id) AS countries,
                       SUM(verification_status = 'verified') AS verified FROM companies WHERE status = 'approved'`),
    };
  });

  r.get('/api/form-token', () => ({ token: formToken() }));

  // ───────────── Búsqueda y fichas ─────────────
  r.get('/api/companies', (ctx) => {
    const format = ctx.query.get('format');
    if (format === 'csv' || format === 'xlsx') {
      const res = searchCompanies(db, ctx.query, { all: true });
      const ids = res.items.slice(0, 1000).map((c) => c.id);
      return exportFile(exportRows(db, ids), exportColumns(false), 'empresas', format);
    }
    // ?ids=1,2,3 → tarjetas concretas (favoritos de visitantes guardados en el navegador)
    const ids = ctx.query.get('ids')?.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
    return searchCompanies(db, ctx.query, { ids: ids?.length ? ids : null });
  });

  r.post('/api/companies/export', (ctx) => {
    const v = new Validator(ctx.body);
    const ids = v.ids('ids', { required: true, max: 1000 });
    v.done();
    const allowed = db.all(`SELECT id FROM companies WHERE status = 'approved' AND id IN (${ids.map(() => '?').join(',')})`, ...ids).map((x) => x.id);
    return exportFile(exportRows(db, allowed), exportColumns(false), 'empresas-seleccionadas', ctx.body.format);
  });

  r.get('/api/companies/:slug', (ctx) => {
    const c = companyDetail(db, { slug: ctx.params.slug }, { privateView: false });
    const owner = ctx.user && (ctx.user.role === 'admin' || ctx.user.company_id === c?.id);
    if (!c || (c.status !== 'approved' && !owner)) throw new HttpError(404, 'Empresa no encontrada');
    const related = db.all(
      `SELECT DISTINCT c.id FROM companies c JOIN company_categories x ON x.company_id = c.id
        WHERE c.status = 'approved' AND c.id != ? AND x.category_id IN (SELECT category_id FROM company_categories WHERE company_id = ?)
        ORDER BY c.country_id = ? DESC, c.verification_status = 'verified' DESC LIMIT 3`, c.id, c.id, c.country_id).map((x) => x.id);
    return { company: c, related: companyCards(db, related) };
  });

  // ───────────── Contacto con empresa / cotización ─────────────
  r.post('/api/companies/:slug/inquiries', (ctx) => {
    rateLimit(ctx.ip, 'inquiry', 6);
    checkSpam(ctx.body);
    const company = assertCompany(db, ctx.params.slug);
    const v = new Validator(ctx.body);
    const d = {
      inquiry_type: v.oneOf('inquiry_type', ['contact', 'quote'], { def: 'contact' }),
      sender_name: v.str('sender_name', { required: true, max: 120, label: 'Tu nombre' }),
      sender_company: v.str('sender_company', { max: 150 }),
      sender_country: v.str('sender_country', { required: true, max: 80, label: 'El país' }),
      email: v.email('email', { required: true, label: 'El email' }),
      phone: v.phone('phone'),
      product_interest: v.str('product_interest', { max: 200 }),
      estimated_volume: v.str('estimated_volume', { max: 120 }),
      message: v.str('message', { required: true, min: 20, max: 3000, label: 'El mensaje' }),
    };
    v.mustAccept('consent_privacy');
    v.done();
    const id = db.run(
      `INSERT INTO inquiries (company_id, inquiry_type, sender_name, sender_company, sender_country, email, phone,
       product_interest, estimated_volume, message, consent_privacy) VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
      company.id, d.inquiry_type, d.sender_name, d.sender_company, d.sender_country, d.email, d.phone,
      d.product_interest, d.estimated_volume, d.message).lastInsertRowid;

    const kind = d.inquiry_type === 'quote' ? 'Solicitud de cotización' : 'Nuevo mensaje';
    sendMail(db, {
      to: primaryEmail(db, company.id), relatedType: 'inquiry', relatedId: id,
      subject: `${kind} desde GlobalTrade Connect: ${d.product_interest || company.name}`,
      body: `${kind} para ${company.name}\n\nDe: ${d.sender_name}${d.sender_company ? ` (${d.sender_company})` : ''} · ${d.sender_country}\n`
        + `Email: ${d.email}${d.phone ? `\nTeléfono: ${d.phone}` : ''}\nProducto: ${d.product_interest || '-'}\n`
        + `Volumen estimado: ${d.estimated_volume || '-'}\n\n${d.message}\n\n— Responde directamente a ${d.email}.`,
    });
    sendMail(db, {
      to: d.email, relatedType: 'inquiry', relatedId: id,
      subject: `Hemos enviado tu solicitud a ${company.name}`,
      body: `Hola ${d.sender_name},\n\nTu mensaje se ha enviado a ${company.name}. La empresa te responderá directamente.\n\nGlobalTrade Connect`,
    });
    return { ok: true, id };
  });

  r.post('/api/companies/:slug/reports', (ctx) => {
    rateLimit(ctx.ip, 'report', 5);
    checkSpam(ctx.body);
    const company = assertCompany(db, ctx.params.slug);
    const v = new Validator(ctx.body);
    const d = {
      field: v.str('field', { max: 80 }),
      reporter_email: v.email('reporter_email'),
      message: v.str('message', { required: true, min: 10, max: 2000, label: 'La descripción' }),
    };
    v.done();
    const id = db.run('INSERT INTO data_reports (company_id, reporter_email, field, message) VALUES (?,?,?,?)',
      company.id, d.reporter_email, d.field, d.message).lastInsertRowid;
    sendMail(db, { to: config.adminNotifyEmail, relatedType: 'report', relatedId: id,
      subject: `Datos incorrectos reportados: ${company.name}`, body: `Campo: ${d.field || '-'}\n\n${d.message}` });
    return { ok: true };
  });

  // ───────────── Solicitar proveedores ─────────────
  r.post('/api/supplier-requests', (ctx) => {
    rateLimit(ctx.ip, 'supplier', 5);
    checkSpam(ctx.body);
    const v = new Validator(ctx.body);
    const iso = (Array.isArray(ctx.body.origin_countries) ? ctx.body.origin_countries : []).filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 30);
    const certs = (Array.isArray(ctx.body.certifications) ? ctx.body.certifications : []).filter((x) => /^[a-z0-9-]{1,40}$/.test(x)).slice(0, 20);
    const d = {
      user_name: v.str('user_name', { required: true, max: 120, label: 'Tu nombre' }),
      email: v.email('email', { required: true, label: 'El email' }),
      company_name: v.str('company_name', { max: 150 }),
      phone: v.phone('phone'),
      product: v.str('product', { required: true, max: 200, label: 'El producto' }),
      category_id: v.int('category_id', { min: 1 }),
      quantity: v.str('quantity', { required: true, max: 120, label: 'La cantidad' }),
      target_date: v.str('target_date', { max: 10 }),
      notes: v.str('notes', { max: 3000 }),
    };
    if (d.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(d.target_date)) v.fail('target_date', 'Fecha no válida');
    v.mustAccept('consent_privacy');
    v.done();
    const id = db.run(
      `INSERT INTO supplier_requests (user_name, email, company_name, phone, product, category_id, origin_countries, certifications,
       quantity, target_date, notes, consent_privacy) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
      d.user_name, d.email, d.company_name, d.phone, d.product, d.category_id, iso.join(','), certs.join(','),
      d.quantity, d.target_date, d.notes).lastInsertRowid;
    sendMail(db, { to: config.adminNotifyEmail, relatedType: 'supplier_request', relatedId: id,
      subject: `Nueva solicitud de proveedores: ${d.product}`,
      body: `${d.user_name} (${d.email}${d.company_name ? `, ${d.company_name}` : ''}) busca: ${d.product}\nOrigen: ${iso.join(', ') || 'indiferente'}\n`
        + `Certificaciones: ${certs.join(', ') || '-'}\nCantidad: ${d.quantity}\nFecha objetivo: ${d.target_date || '-'}\n\n${d.notes || ''}` });
    return { ok: true, id };
  });

  // ───────────── Registro de empresa ─────────────
  r.post('/api/register', (ctx) => {
    rateLimit(ctx.ip, 'register', 4, 60 * 60 * 1000);
    checkSpam(ctx.body);
    const d = validateCompany(db, ctx.body);
    const v = new Validator(ctx.body);
    v.mustAccept('consent_privacy');
    v.mustAccept('consent_terms', 'Debes confirmar que tienes autorización para publicar estos datos');
    let account = null;
    if (!ctx.user && ctx.body.create_account) {
      account = { email: v.email('account_email', { required: true }), password: ctx.body.account_password };
      const p = passwordProblems(account.password);
      if (p) v.fail('account_password', p);
      if (account.email && db.get('SELECT 1 FROM users WHERE email = ?', account.email)) v.fail('account_email', 'Ya existe una cuenta con este email. Inicia sesión.');
    }
    v.done();
    if (ctx.user?.company_id) throw new HttpError(409, 'Tu cuenta ya tiene una empresa asociada');

    const id = db.tx(() => {
      const cid = saveCompany(db, d, null, { status: 'pending_review', verification_status: 'pending' });
      if (account) {
        const uid = db.run("INSERT INTO users (name, email, password_hash, role, company_id) VALUES (?,?,?,'company',?)",
          d.contacts[0].full_name, account.email, hashPassword(account.password), cid).lastInsertRowid;
        createSession(db, ctx.res, uid);
      } else if (ctx.user && ctx.user.role === 'company') {
        db.run('UPDATE users SET company_id = ? WHERE id = ?', cid, ctx.user.id);
      }
      return cid;
    });
    sendMail(db, { to: config.adminNotifyEmail, relatedType: 'company', relatedId: id,
      subject: `Nueva empresa pendiente de revisión: ${d.name}`, body: `Revisa la solicitud en ${config.baseUrl}/#/admin/empresas/${id}` });
    sendMail(db, { to: d.contacts[0].email, relatedType: 'company', relatedId: id,
      subject: 'Hemos recibido el alta de tu empresa',
      body: `Hola ${d.contacts[0].full_name},\n\nHemos recibido la solicitud de alta de ${d.name}. Nuestro equipo la revisará y te avisaremos cuando esté publicada.\n\nGlobalTrade Connect` });
    return { ok: true, id, account: Boolean(account) };
  });

  // ───────────── RGPD ─────────────
  r.post('/api/privacy-requests', (ctx) => {
    rateLimit(ctx.ip, 'privacy', 3);
    checkSpam(ctx.body);
    const v = new Validator(ctx.body);
    const d = {
      name: v.str('name', { required: true, max: 120, label: 'El nombre' }),
      email: v.email('email', { required: true, label: 'El email' }),
      request_type: v.oneOf('request_type', ['deletion', 'access', 'rectification'], { required: true }),
      details: v.str('details', { max: 2000 }),
    };
    v.done();
    const id = db.run('INSERT INTO privacy_requests (name, email, request_type, details) VALUES (?,?,?,?)',
      d.name, d.email, d.request_type, d.details).lastInsertRowid;
    sendMail(db, { to: config.adminNotifyEmail, relatedType: 'privacy', relatedId: id,
      subject: `Solicitud RGPD (${d.request_type}) de ${d.email}`, body: d.details || '(sin detalles)' });
    sendMail(db, { to: d.email, relatedType: 'privacy', relatedId: id, subject: 'Hemos recibido tu solicitud de privacidad',
      body: `Hola ${d.name},\n\nAtenderemos tu solicitud en un plazo máximo de un mes, según el RGPD.\n\nGlobalTrade Connect` });
    return { ok: true };
  });

  // ───────────── Autenticación ─────────────
  r.post('/api/auth/login', (ctx) => {
    rateLimit(ctx.ip, 'login', 10, 15 * 60 * 1000);
    const v = new Validator(ctx.body);
    const email = v.email('email', { required: true });
    const password = String(ctx.body.password || '');
    v.done();
    const u = db.get('SELECT * FROM users WHERE email = ?', email);
    if (!u || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'Email o contraseña incorrectos');
    createSession(db, ctx.res, u.id);
    return { user: { id: u.id, name: u.name, email: u.email, role: u.role, company_id: u.company_id } };
  });

  r.post('/api/auth/logout', (ctx) => { destroySession(db, ctx.req, ctx.res); return { ok: true }; });

  r.get('/api/auth/me', (ctx) => ({
    user: ctx.user,
    favorites: ctx.user ? db.all('SELECT company_id FROM favorites WHERE user_id = ?', ctx.user.id).map((f) => f.company_id) : [],
  }));

  // ───────────── Favoritos / leads guardados ─────────────
  r.get('/api/favorites', requireUser, (ctx) => {
    const ids = db.all(`SELECT f.company_id FROM favorites f JOIN companies c ON c.id = f.company_id
                         WHERE f.user_id = ? AND c.status = 'approved' ORDER BY f.created_at DESC`, ctx.user.id).map((f) => f.company_id);
    return { items: companyCards(db, ids) };
  });
  r.post('/api/favorites', requireUser, (ctx) => {
    const v = new Validator(ctx.body);
    const ids = v.ids('ids', { required: true, max: 500 });
    v.done();
    for (const id of ids) {
      if (db.get("SELECT 1 FROM companies WHERE id = ? AND status = 'approved'", id)) {
        db.run('INSERT OR IGNORE INTO favorites (user_id, company_id) VALUES (?,?)', ctx.user.id, id);
      }
    }
    return { favorites: db.all('SELECT company_id FROM favorites WHERE user_id = ?', ctx.user.id).map((f) => f.company_id) };
  });
  r.delete('/api/favorites/:id', requireUser, (ctx) => {
    db.run('DELETE FROM favorites WHERE user_id = ? AND company_id = ?', ctx.user.id, Number(ctx.params.id));
    return { ok: true };
  });

  // ───────────── Área de empresa registrada ─────────────
  r.get('/api/account', requireUser, (ctx) => {
    const cid = ctx.user.company_id;
    return {
      user: ctx.user,
      company: cid ? companyDetail(db, { id: cid }, { privateView: true }) : null,
      inquiries: cid ? db.all('SELECT * FROM inquiries WHERE company_id = ? ORDER BY created_at DESC LIMIT 200', cid) : [],
    };
  });

  r.put('/api/account/company', requireUser, (ctx) => {
    const cid = ctx.user.company_id;
    if (!cid) throw new HttpError(404, 'Tu cuenta no tiene empresa asociada');
    const d = validateCompany(db, ctx.body);
    const prev = db.get('SELECT status, name FROM companies WHERE id = ?', cid);
    saveCompany(db, d, cid, prev.status === 'rejected' ? { status: 'pending_review' } : {});
    sendMail(db, { to: config.adminNotifyEmail, relatedType: 'company', relatedId: cid,
      subject: `Empresa actualizada por su titular: ${d.name}`, body: `Revisa los cambios en ${config.baseUrl}/#/admin/empresas/${cid}` });
    return { company: companyDetail(db, { id: cid }, { privateView: true }) };
  });

  r.put('/api/account/inquiries/:id', requireUser, (ctx) => {
    const v = new Validator(ctx.body);
    const status = v.oneOf('status', ['new', 'read', 'answered', 'archived'], { required: true });
    v.done();
    const r2 = db.run('UPDATE inquiries SET status = ? WHERE id = ? AND company_id = ?', status, Number(ctx.params.id), ctx.user.company_id);
    if (!r2.changes) throw new HttpError(404, 'Solicitud no encontrada');
    return { ok: true };
  });
}
