import {
  $, $$, api, confirmDialog, flag, fmtDate, fmtDateTime, fmtNum, html, icon, loadMeta, logo, openModal, raw, setTitle,
  statusBadge, store, submitForm, toast, verificationBadge,
} from '../lib.js';
import { bindCompanyForm, companyFormHtml, readCompanyForm } from './register.js';

const TABS = [
  ['resumen', 'Resumen'], ['empresas', 'Empresas', 'pending_review'], ['duplicados', 'Duplicados'],
  ['contactos', 'Solicitudes de contacto', 'inquiries_new'], ['proveedores', 'Solicitudes de proveedores', 'supplier_requests_new'],
  ['reportes', 'Datos reportados', 'reports_new'], ['rgpd', 'Peticiones RGPD', 'privacy_new'], ['taxonomias', 'Catálogos'], ['emails', 'Emails enviados'],
];

export async function renderAdmin(root, { params, query }) {
  setTitle('Administración');
  if (!store.user) { const e = new Error('Inicia sesión'); e.status = 401; throw e; }
  if (store.user.role !== 'admin') {
    root.innerHTML = String(html`<div class="wrap empty"><h2>Acceso restringido</h2><p>Esta sección es solo para administradores.</p></div>`);
    return;
  }
  const [tab = 'resumen', id] = params;
  const stats = await api('/api/admin/stats');
  root.innerHTML = String(html`<div class="wrap admin-layout">
    <nav class="admin-nav" aria-label="Administración">${TABS.map(([k, l, countKey]) => html`<a href="#/admin/${k}" class="${tab === k ? 'active' : ''}">
      <span>${l}</span>${countKey && stats.totals[countKey] ? html`<span class="count">${stats.totals[countKey]}</span>` : ''}</a>`)}</nav>
    <section id="admin-body"></section></div>`);
  const body = $('#admin-body', root);
  const views = { resumen: viewStats, empresas: id ? viewCompanyEdit : viewCompanies, duplicados: viewDuplicates, contactos: viewInquiries,
    proveedores: viewSupplierRequests, reportes: viewReports, rgpd: viewPrivacy, taxonomias: viewTaxonomies, emails: viewOutbox };
  await (views[tab] || viewStats)(body, { stats, id, query });
}

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const exportLinks = (entity, extra = '') => html`<a class="btn btn-outline btn-sm" href="/api/admin/export/${entity}?format=csv${extra}" download>${icon('download')} CSV</a>
  <a class="btn btn-outline btn-sm" href="/api/admin/export/${entity}?format=xlsx${extra}" download>${icon('download')} Excel</a>`;

// ───────────── Resumen ─────────────
function bars(rows, { label = (r) => r.name, value = (r) => r.n, prefix } = {}) {
  const max = Math.max(1, ...rows.map(value));
  return html`<ul class="bars">${rows.map((r) => html`<li title="${label(r)}: ${value(r)}">
    <span class="name">${prefix ? prefix(r) : ''}${label(r)}</span>
    <span class="track"><span class="fill" style="width:${(value(r) / max) * 100}%"></span></span>
    <span class="val">${fmtNum(value(r))}</span></li>`)}</ul>`;
}

async function viewStats(body, { stats }) {
  const t = stats.totals;
  const kpi = (label, value, sub) => html`<div class="kpi"><div class="label">${label}</div><div class="value">${fmtNum(value)}</div>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>`;
  const months = [...stats.inquiries_by_month].reverse();
  body.innerHTML = String(html`<h1>Resumen</h1>
    <div class="kpis">
      ${kpi('Empresas publicadas', t.approved, `${fmtNum(t.companies)} en total`)}
      ${kpi('Verificadas', t.verified, t.companies ? `${Math.round((t.verified / t.companies) * 100)} % del total` : '')}
      ${kpi('Pendientes de revisión', t.pending_review, html`<a href="#/admin/empresas?status=pending_review">Revisar →</a>`)}
      ${kpi('Solicitudes de contacto', t.inquiries, `${fmtNum(t.inquiries_new)} nuevas`)}
      ${kpi('Solicitudes de proveedores', t.supplier_requests, `${fmtNum(t.supplier_requests_new)} nuevas`)}
    </div>
    <div class="chart-grid">
      <div class="card card-pad"><h3>Empresas publicadas por país</h3>${bars(stats.by_country, { prefix: (r) => flag(r) })}</div>
      <div class="card card-pad"><h3>Empresas por categoría</h3>${bars(stats.by_category.filter((c) => !c.parent_id))}
        <h3 style="margin-top:20px">Top subcategorías</h3>${bars(stats.by_category.filter((c) => c.parent_id && c.n).slice(0, 8))}</div>
      <div class="card card-pad"><h3>Empresas por tipo principal</h3>${bars(stats.by_type.filter((r) => r.n))}</div>
      <div class="card card-pad"><h3>Solicitudes de contacto por mes</h3>${months.length ? bars(months, { label: (r) => r.month }) : html`<p class="muted">Sin datos.</p>`}</div>
    </div>`);
}

// ───────────── Empresas ─────────────
async function viewCompanies(body, { query }) {
  const q = new URLSearchParams(query);
  q.set('pageSize', '25');
  const res = await api(`/api/admin/companies?${q}`);
  const opt = (v, cur) => (v === cur ? raw('selected') : '');
  body.innerHTML = String(html`<div class="row" style="margin-bottom:12px"><h1 style="margin:0">Empresas</h1><span class="spacer"></span>
      ${exportLinks('companies')}<a class="btn btn-primary btn-sm" href="#/admin/empresas/nueva">${icon('plus')} Nueva empresa</a></div>
    <form class="row" id="cf" style="margin-bottom:12px">
      <input class="input" name="q" placeholder="Buscar por nombre, ciudad, producto…" value="${query.get('q') || ''}" style="flex:1;min-width:200px">
      <select class="input" name="status" style="width:auto"><option value="">Todos los estados</option>
        ${[['pending_review', 'Pendientes de revisión'], ['approved', 'Publicadas'], ['rejected', 'Rechazadas']].map(([v, l]) => html`<option value="${v}" ${opt(v, query.get('status'))}>${l}</option>`)}</select>
      <select class="input" name="verification" style="width:auto"><option value="">Cualquier verificación</option>
        ${[['verified', 'Verificadas'], ['pending', 'Pendientes'], ['unverified', 'No verificadas']].map(([v, l]) => html`<option value="${v}" ${opt(v, query.get('verification'))}>${l}</option>`)}</select>
      <button class="btn btn-outline">Filtrar</button></form>
    <p class="muted small">${fmtNum(res.total)} empresas</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Empresa</th><th>País</th><th>Tipo</th><th>Estado</th><th>Verificación</th><th>Alta</th><th>Acciones</th></tr></thead>
      <tbody>${res.items.map((c) => html`<tr data-id="${c.id}">
        <td><div class="row" style="gap:10px;flex-wrap:nowrap">${logo(c)}<div><a href="#/admin/empresas/${c.id}"><strong>${c.name}</strong></a>
          ${c.is_featured ? html` <span class="badge badge-featured">Destacada</span>` : ''}<div class="small muted">${c.categories.map((k) => k.name).join(', ')}</div></div></div></td>
        <td>${flag(c)} ${c.city}</td><td>${c.company_type_name}</td><td>${statusBadge(c.status)}</td><td>${verificationBadge(c.verification_status)}</td>
        <td>${fmtDate(c.created_at)}</td>
        <td><div class="actions">
          ${c.status !== 'approved' ? html`<button class="btn btn-primary btn-sm" data-act="approve">Aprobar</button>` : ''}
          ${c.status !== 'rejected' ? html`<button class="btn btn-danger btn-sm" data-act="reject">Rechazar</button>` : ''}
          ${c.verification_status !== 'verified' ? html`<button class="btn btn-outline btn-sm" data-act="verify">${icon('check')} Verificar</button>` : html`<button class="btn btn-ghost btn-sm" data-act="unverify">Quitar verificación</button>`}
          <button class="btn btn-ghost btn-sm" data-act="feature">${c.is_featured ? 'No destacar' : 'Destacar'}</button>
          <a class="btn btn-ghost btn-sm" href="#/empresa/${c.slug}" target="_blank">Ver</a>
          <a class="btn btn-ghost btn-sm" href="#/admin/empresas/${c.id}">${icon('edit')}</a>
        </div></td></tr>`)}</tbody></table></div>
    ${res.pages > 1 ? html`<nav class="pagination">${Array.from({ length: res.pages }, (_, i) => html`<button data-page="${i + 1}" class="${res.page === i + 1 ? 'on' : ''}">${i + 1}</button>`)}</nav>` : ''}`);

  const go = (patch) => {
    const p = new URLSearchParams(query);
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
    location.hash = `#/admin/empresas?${p}`;
  };
  $('#cf', body).addEventListener('submit', (e) => {
    e.preventDefault();
    go({ q: e.target.q.value.trim(), status: e.target.status.value, verification: e.target.verification.value, page: '' });
  });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.page) return go({ page: b.dataset.page });
    const act = b.dataset.act;
    if (!act) return;
    const id = b.closest('tr').dataset.id;
    const c = res.items.find((x) => String(x.id) === id);
    let payload;
    if (act === 'approve') payload = { status: 'approved' };
    if (act === 'verify') payload = { verification_status: 'verified' };
    if (act === 'unverify') payload = { verification_status: 'unverified' };
    if (act === 'feature') payload = { is_featured: !c.is_featured };
    if (act === 'reject') {
      const reason = await askReason(c.name);
      if (reason === null) return;
      payload = { status: 'rejected', rejection_reason: reason };
    }
    try { await api(`/api/admin/companies/${id}/status`, { method: 'POST', body: payload }); toast('Empresa actualizada'); rerender(); }
    catch (err) { toast(err.message, { error: true }); }
  });
}

function askReason(name) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal('Rechazar empresa', html`<form class="stack" id="rj"><p>Vas a rechazar <strong>${name}</strong>. Se notificará por email al contacto principal.</p>
      <div class="field"><label for="rj-r">Motivo</label><textarea class="input" id="rj-r" name="r" placeholder="Ej.: no hemos podido verificar la identificación fiscal"></textarea></div>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-danger" type="submit">Rechazar</button></div></form>`,
    { onClose: () => !done && resolve(null) });
    $('#rj', m.el).addEventListener('submit', (e) => { e.preventDefault(); done = true; const r = e.target.r.value.trim(); m.close(); resolve(r); });
  });
}

async function viewCompanyEdit(body, { id }) {
  const isNew = id === 'nueva';
  const c = isNew ? { status: 'approved', verification_status: 'pending', contacts: [] } : (await api(`/api/admin/companies/${id}`)).company;
  body.innerHTML = String(html`<p><a href="#/admin/empresas">← Volver a empresas</a></p>
    <div class="row" style="margin-bottom:12px"><h1 style="margin:0">${isNew ? 'Nueva empresa' : c.name}</h1><span class="spacer"></span>
      ${!isNew ? html`${statusBadge(c.status)} ${verificationBadge(c.verification_status)} <a class="btn btn-outline btn-sm" href="#/empresa/${c.slug}" target="_blank">Ver ficha</a>` : ''}</div>
    ${!isNew ? html`<p class="small muted">Alta: ${fmtDateTime(c.created_at)} · Última actualización: ${fmtDateTime(c.updated_at)}
      ${c.users?.length ? html` · Cuentas vinculadas: ${c.users.map((u) => u.email).join(', ')}` : ''}${c.is_demo ? ' · Datos demo' : ''}</p>` : ''}
    ${companyFormHtml(c, 'admin')}`);
  const form = $('#company-form', body);
  bindCompanyForm(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = readCompanyForm(form);
    const res = await submitForm(form, () => api(isNew ? '/api/admin/companies' : `/api/admin/companies/${id}`, { method: isNew ? 'POST' : 'PUT', body: payload }));
    if (!res) return;
    toast('Empresa guardada');
    loadMeta(true);
    if (isNew) location.hash = `#/admin/empresas/${res.id}`; else rerender();
  });
  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!await confirmDialog(`¿Eliminar definitivamente «${c.name}» y todas sus solicitudes asociadas?`, { ok: 'Eliminar', danger: true })) return;
    await api(`/api/admin/companies/${id}`, { method: 'DELETE' });
    toast('Empresa eliminada');
    loadMeta(true);
    location.hash = '#/admin/empresas';
  });
}

// ───────────── Duplicados ─────────────
async function viewDuplicates(body) {
  const { groups } = await api('/api/admin/duplicates');
  body.innerHTML = String(html`<h1>Posibles duplicados</h1>
    <p class="muted">Coincidencias por nombre normalizado (sin tildes ni formas jurídicas), email de contacto, dominio web o identificación fiscal.</p>
    ${groups.length ? groups.map((g) => html`<div class="card dup-group"><div class="row"><span class="badge badge-pending">${g.reason}</span><code class="small">${g.key}</code></div>
      <ul>${g.companies.map((c) => html`<li><a href="#/admin/empresas/${c.id}">${c.name}</a> · ${c.country_name} · ${statusBadge(c.status)} ${c.tax_id ? html`<span class="muted small">${c.tax_id}</span>` : ''}</li>`)}</ul></div>`)
      : html`<div class="card empty">${icon('check')}<p>No se han detectado duplicados.</p></div>`}`);
}

// ───────────── Listados de leads ─────────────
function statusFilter(tab, statuses, current) {
  return html`<div class="tabs"><button data-st="" class="${!current ? 'on' : ''}">Todas</button>${statuses.map(([v, l]) => html`<button data-st="${v}" class="${current === v ? 'on' : ''}">${l}</button>`)}</div>`;
}
function bindStatusTable(body, tab, endpoint) {
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (b) location.hash = `#/admin/${tab}${b.dataset.st ? `?status=${b.dataset.st}` : ''}`;
  });
  body.addEventListener('change', async (e) => {
    if (!e.target.dataset.status) return;
    try { await api(`${endpoint}/${e.target.dataset.status}`, { method: 'PUT', body: { status: e.target.value } }); toast('Estado actualizado'); }
    catch (err) { toast(err.message, { error: true }); }
  });
}
const statusSelect = (id, statuses, cur) => html`<select class="input" data-status="${id}">${statuses.map(([v, l]) => html`<option value="${v}" ${v === cur ? raw('selected') : ''}>${l}</option>`)}</select>`;

async function viewInquiries(body, { query }) {
  const S = [['new', 'Nuevas'], ['read', 'Leídas'], ['answered', 'Respondidas'], ['archived', 'Archivadas']];
  const st = query.get('status') || '';
  const { items } = await api(`/api/admin/inquiries${st ? `?status=${st}` : ''}`);
  body.innerHTML = String(html`<div class="row"><h1 style="margin:0">Solicitudes de contacto</h1><span class="spacer"></span>${exportLinks('inquiries')}</div>
    ${statusFilter('contactos', S, st)}
    ${items.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Empresa destinataria</th><th>Remitente</th><th>Producto</th><th>Mensaje</th><th>Estado</th></tr></thead>
      <tbody>${items.map((q) => html`<tr><td>${fmtDateTime(q.created_at)}<br><span class="badge">${q.inquiry_type === 'quote' ? 'Cotización' : 'Contacto'}</span></td>
        <td><a href="#/empresa/${q.company_slug}">${q.company_name}</a></td>
        <td><strong>${q.sender_name}</strong><br>${q.sender_company || ''} · ${q.sender_country}<br><a href="mailto:${q.email}">${q.email}</a> ${q.phone || ''}</td>
        <td>${q.product_interest || '—'}<br><span class="muted small">${q.estimated_volume || ''}</span></td>
        <td style="max-width:300px;white-space:pre-line">${q.message}</td><td>${statusSelect(q.id, S, q.status)}</td></tr>`)}</tbody></table></div>`
    : html`<div class="card empty"><p>No hay solicitudes.</p></div>`}`);
  bindStatusTable(body, 'contactos', '/api/admin/inquiries');
}

async function viewSupplierRequests(body, { query }) {
  const S = [['new', 'Nuevas'], ['in_progress', 'En curso'], ['closed', 'Cerradas']];
  const st = query.get('status') || '';
  const { items } = await api(`/api/admin/supplier-requests${st ? `?status=${st}` : ''}`);
  const cname = (iso) => store.meta.countries.find((c) => c.iso_code === iso)?.name || iso;
  const certName = (s) => store.meta.certifications.find((c) => c.slug === s)?.name || s;
  body.innerHTML = String(html`<div class="row"><h1 style="margin:0">Solicitudes de proveedores</h1><span class="spacer"></span>${exportLinks('supplier-requests')}</div>
    ${statusFilter('proveedores', S, st)}
    ${items.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Solicitante</th><th>Producto</th><th>Origen / certificaciones</th><th>Cantidad / fecha</th><th>Estado</th></tr></thead>
      <tbody>${items.map((r) => html`<tr><td>${fmtDateTime(r.created_at)}</td>
        <td><strong>${r.user_name}</strong><br>${r.company_name || ''}<br><a href="mailto:${r.email}">${r.email}</a> ${r.phone || ''}</td>
        <td><strong>${r.product}</strong><br><span class="muted small">${r.category_name || ''}</span>${r.notes ? html`<br><span class="small" style="white-space:pre-line">${r.notes}</span>` : ''}
          <br><a class="small" href="#/buscar?${new URLSearchParams({ q: r.product.split(' ').slice(0, 2).join(' '), ...(r.origin_countries ? { country: r.origin_countries } : {}) })}">Buscar candidatos →</a></td>
        <td>${(r.origin_countries || '').split(',').filter(Boolean).map(cname).join(', ') || 'Indiferente'}<br><span class="muted small">${(r.certifications || '').split(',').filter(Boolean).map(certName).join(', ')}</span></td>
        <td>${r.quantity}<br><span class="muted small">${r.target_date ? fmtDate(r.target_date) : ''}</span></td>
        <td>${statusSelect(r.id, S, r.status)}</td></tr>`)}</tbody></table></div>`
    : html`<div class="card empty"><p>No hay solicitudes.</p></div>`}`);
  bindStatusTable(body, 'proveedores', '/api/admin/supplier-requests');
}

async function viewReports(body, { query }) {
  const S = [['new', 'Nuevos'], ['resolved', 'Resueltos'], ['dismissed', 'Descartados']];
  const st = query.get('status') || '';
  const { items } = await api(`/api/admin/reports${st ? `?status=${st}` : ''}`);
  body.innerHTML = String(html`<h1>Datos reportados como incorrectos</h1>${statusFilter('reportes', S, st)}
    ${items.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Empresa</th><th>Campo</th><th>Descripción</th><th>Reportado por</th><th>Estado</th></tr></thead>
      <tbody>${items.map((r) => html`<tr><td>${fmtDateTime(r.created_at)}</td><td><a href="#/admin/empresas/${r.company_id}">${r.company_name}</a></td>
        <td>${r.field || '—'}</td><td style="max-width:320px">${r.message}</td><td>${r.reporter_email || 'Anónimo'}</td><td>${statusSelect(r.id, S, r.status)}</td></tr>`)}</tbody></table></div>`
    : html`<div class="card empty"><p>No hay reportes.</p></div>`}`);
  bindStatusTable(body, 'reportes', '/api/admin/reports');
}

async function viewPrivacy(body, { query }) {
  const S = [['new', 'Nuevas'], ['completed', 'Completadas'], ['rejected', 'Rechazadas']];
  const T = { deletion: 'Supresión', access: 'Acceso', rectification: 'Rectificación' };
  const st = query.get('status') || '';
  const { items } = await api(`/api/admin/privacy-requests${st ? `?status=${st}` : ''}`);
  body.innerHTML = String(html`<h1>Peticiones RGPD</h1>
    <p class="muted">Plazo legal de respuesta: 1 mes. «Ejecutar supresión» anonimiza las solicitudes enviadas con ese email y elimina contactos y cuentas asociados.</p>
    ${statusFilter('rgpd', S, st)}
    ${items.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Solicitante</th><th>Detalles</th><th>Estado</th><th></th></tr></thead>
      <tbody>${items.map((r) => html`<tr><td>${fmtDateTime(r.created_at)}</td><td>${T[r.request_type]}</td><td>${r.name}<br>${r.email}</td>
        <td style="max-width:280px">${r.details || '—'}</td><td>${statusSelect(r.id, S, r.status)}</td>
        <td>${r.request_type === 'deletion' && r.status === 'new' ? html`<button class="btn btn-danger btn-sm" data-exec="${r.id}" data-email="${r.email}">Ejecutar supresión</button>` : ''}</td></tr>`)}</tbody></table></div>`
    : html`<div class="card empty"><p>No hay peticiones.</p></div>`}`);
  bindStatusTable(body, 'rgpd', '/api/admin/privacy-requests');
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-exec]');
    if (!b) return;
    if (!await confirmDialog(`Se anonimizarán o eliminarán todos los datos asociados a ${b.dataset.email}. Esta acción no se puede deshacer.`, { ok: 'Ejecutar', danger: true })) return;
    try {
      const r = await api(`/api/admin/privacy-requests/${b.dataset.exec}/execute`, { method: 'POST' });
      toast(`Hecho: ${Object.entries(r.affected).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
      rerender();
    } catch (err) { toast(err.message, { error: true }); }
  });
}

// ───────────── Catálogos (taxonomías) ─────────────
const TAX = {
  categories: { label: 'Categorías', fields: [['name', 'Nombre'], ['slug', 'Slug'], ['parent_id', 'Categoría padre', 'parent'], ['sort_order', 'Orden', 'number']] },
  products: { label: 'Productos', fields: [['name', 'Nombre'], ['category_id', 'Subcategoría', 'subcat'], ['hs_code', 'Código SA']] },
  countries: { label: 'Países', fields: [['name', 'Nombre'], ['iso_code', 'ISO'], ['flag_url', 'URL bandera'], ['is_priority', 'Prioritario', 'bool'], ['sort_order', 'Orden', 'number']] },
  certifications: { label: 'Certificaciones', fields: [['name', 'Nombre'], ['slug', 'Slug']] },
  languages: { label: 'Idiomas', fields: [['code', 'Código'], ['name', 'Nombre']] },
  'business-types': { label: 'Tipos de empresa', fields: [['name', 'Nombre'], ['slug', 'Slug']] },
  'client-types': { label: 'Tipos de cliente', fields: [['name', 'Nombre'], ['slug', 'Slug']] },
};

async function viewTaxonomies(body, { query }) {
  const type = TAX[query.get('t')] ? query.get('t') : 'categories';
  const def = TAX[type];
  const { items } = await api(`/api/admin/taxonomy/${type}`);
  const cats = store.meta.categories;
  const input = (f, v = '') => {
    const [name, , kind] = f;
    if (kind === 'parent') return html`<select class="input" name="${name}"><option value="">— Principal —</option>${cats.filter((c) => !c.parent_id).map((c) => html`<option value="${c.id}" ${c.id === v ? raw('selected') : ''}>${c.name}</option>`)}</select>`;
    if (kind === 'subcat') return html`<select class="input" name="${name}">${cats.filter((c) => c.parent_id).map((c) => html`<option value="${c.id}" ${c.id === v ? raw('selected') : ''}>${c.name}</option>`)}</select>`;
    if (kind === 'bool') return html`<input type="checkbox" name="${name}" ${v ? raw('checked') : ''}>`;
    return html`<input class="input" name="${name}" ${kind === 'number' ? raw('type="number"') : ''} value="${v ?? ''}">`;
  };
  body.innerHTML = String(html`<h1>Catálogos</h1>
    <p class="muted">Añade países, categorías, productos o certificaciones sin tocar el código. Los cambios se reflejan en filtros y formularios al momento.</p>
    <div class="tabs">${Object.entries(TAX).map(([k, d]) => html`<button data-t="${k}" class="${k === type ? 'on' : ''}">${d.label}</button>`)}</div>
    <div class="table-wrap"><table class="table"><thead><tr>${def.fields.map(([, l]) => html`<th>${l}</th>`)}<th></th></tr></thead><tbody>
      <tr data-new>${def.fields.map((f) => html`<td>${input(f, f[2] === 'number' ? 100 : '')}</td>`)}<td><button class="btn btn-primary btn-sm" data-save>${icon('plus')} Añadir</button></td></tr>
      ${items.map((it) => html`<tr data-row="${it.id}">${def.fields.map((f) => html`<td>${input(f, it[f[0]])}</td>`)}
        <td><div class="actions"><button class="btn btn-outline btn-sm" data-save>Guardar</button><button class="btn btn-danger btn-sm" data-del aria-label="Eliminar">${icon('trash')}</button></div></td></tr>`)}
    </tbody></table></div>`);
  const rowValues = (tr) => Object.fromEntries($$('[name]', tr).map((el) => [el.name, el.type === 'checkbox' ? el.checked : el.value]));
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.t) { location.hash = `#/admin/taxonomias?t=${b.dataset.t}`; return; }
    const tr = b.closest('tr');
    try {
      if (b.matches('[data-save]')) {
        if (tr.dataset.new !== undefined) await api(`/api/admin/taxonomy/${type}`, { method: 'POST', body: rowValues(tr) });
        else await api(`/api/admin/taxonomy/${type}/${tr.dataset.row}`, { method: 'PUT', body: rowValues(tr) });
        toast('Guardado');
      } else if (b.matches('[data-del]')) {
        if (!await confirmDialog('¿Eliminar este elemento? Se quitará de todas las empresas que lo usen.', { ok: 'Eliminar', danger: true })) return;
        await api(`/api/admin/taxonomy/${type}/${tr.dataset.row}`, { method: 'DELETE' });
        toast('Eliminado');
      } else return;
      await loadMeta(true);
      rerender();
    } catch (err) {
      toast(err.details ? Object.values(err.details).join(' · ') : err.message, { error: true });
    }
  });
}

// ───────────── Emails ─────────────
async function viewOutbox(body) {
  const { items } = await api('/api/admin/outbox');
  body.innerHTML = String(html`<h1>Emails enviados</h1>
    <div class="notice notice-info" style="margin-bottom:16px">En desarrollo los emails no salen del servidor: se registran aquí. Configura un proveedor SMTP/API en <code>server/mailer.js</code> para producción.</div>
    ${items.length ? items.map((m) => html`<details class="card dup-group"><summary><strong>${m.subject}</strong> <span class="muted small">→ ${m.to_email} · ${fmtDateTime(m.created_at)}</span></summary>
      <pre class="mail">${m.body}</pre></details>`) : html`<div class="card empty"><p>Sin emails.</p></div>`}`);
}

