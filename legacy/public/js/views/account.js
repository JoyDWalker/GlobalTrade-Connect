import { $, api, fmtDateTime, formValues, html, icon, loadSession, raw, setTitle, statusBadge, store, submitForm, toast, verificationBadge } from '../lib.js';
import { bindCompanyForm, companyFormHtml, readCompanyForm } from './register.js';

export async function renderLogin(root, { query }) {
  setTitle('Acceder');
  const next = query.get('next') || '';
  if (store.user) { location.hash = next ? `#${next}` : store.user.role === 'admin' ? '#/admin' : '#/cuenta'; return; }
  root.innerHTML = String(html`<div class="wrap" style="max-width:440px;padding:48px 16px">
    <div class="card card-pad"><h1 style="font-size:1.5rem">Acceder</h1>
      <p class="muted">Área para empresas registradas y administradores.</p>
      <form id="login" class="stack" novalidate>
        <div class="field"><label for="l-email">Email</label><input class="input" id="l-email" type="email" name="email" autocomplete="username" required></div>
        <div class="field"><label for="l-pass">Contraseña</label><input class="input" id="l-pass" type="password" name="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary" style="width:100%" type="submit">Entrar</button>
      </form>
      <p class="small muted" style="margin-top:16px">¿Aún no tienes cuenta? <a href="#/registrar">Registra tu empresa</a> y crea tu acceso en el mismo formulario.</p>
    </div></div>`);
  const form = $('#login', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await submitForm(form, () => api('/api/auth/login', { method: 'POST', body: formValues(form) }));
    if (!res) return;
    await loadSession();
    toast(`Hola, ${res.user.name}`);
    location.hash = next ? `#${next}` : res.user.role === 'admin' ? '#/admin' : '#/cuenta';
  });
}

const INQ_STATUS = [['new', 'Nueva'], ['read', 'Leída'], ['answered', 'Respondida'], ['archived', 'Archivada']];

export async function renderAccount(root) {
  setTitle('Mi cuenta');
  const data = await api('/api/account');
  const c = data.company;
  const statusText = {
    pending_review: 'Tu ficha está pendiente de revisión. Te avisaremos por email cuando se publique.',
    approved: 'Tu ficha está publicada en el directorio.',
    rejected: `Tu ficha no ha sido aprobada${c?.rejection_reason ? `: ${c.rejection_reason}` : ''}. Corrige los datos y guárdalos para volver a enviarla a revisión.`,
  };
  root.innerHTML = String(html`<div class="wrap" style="padding-bottom:48px">
    <div class="page-head row"><div><h1>Mi cuenta</h1><p class="muted">${data.user.name} · ${data.user.email}</p></div><span class="spacer"></span>
      ${data.user.role === 'admin' ? html`<a class="btn btn-primary" href="#/admin">Panel de administración</a>` : ''}
      <a class="btn btn-outline" href="#/favoritos">${icon('heart')} Mis favoritos (${store.favorites.size})</a></div>
    ${c ? html`
      <div class="card card-pad row" style="margin-bottom:16px">
        <div><h2 style="margin:0">${c.name}</h2><div class="row" style="gap:6px;margin-top:6px">${statusBadge(c.status)} ${verificationBadge(c.verification_status)}</div></div>
        <span class="spacer"></span>
        <a class="btn btn-outline" href="#/empresa/${c.slug}">Ver ficha</a>
        <button class="btn btn-primary" data-edit>${icon('edit')} Editar ficha</button>
      </div>
      <div class="notice ${c.status === 'approved' ? 'notice-ok' : c.status === 'rejected' ? 'notice-danger' : 'notice-warn'}" style="margin-bottom:24px">${statusText[c.status]}</div>
      <div id="edit-area"></div>
      <h2>Solicitudes recibidas (${data.inquiries.length})</h2>
      ${data.inquiries.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Remitente</th><th>Producto / volumen</th><th>Mensaje</th><th>Estado</th></tr></thead>
        <tbody>${data.inquiries.map((q) => html`<tr>
          <td>${fmtDateTime(q.created_at)}</td><td>${q.inquiry_type === 'quote' ? 'Cotización' : 'Contacto'}</td>
          <td><strong>${q.sender_name}</strong><br>${q.sender_company || ''} · ${q.sender_country}<br><a href="mailto:${q.email}">${q.email}</a>${q.phone ? html`<br>${q.phone}` : ''}</td>
          <td>${q.product_interest || '—'}<br><span class="muted">${q.estimated_volume || ''}</span></td>
          <td style="max-width:320px;white-space:pre-line">${q.message}</td>
          <td><select class="input" data-inq="${q.id}">${INQ_STATUS.map(([v, l]) => html`<option value="${v}" ${q.status === v ? raw('selected') : ''}>${l}</option>`)}</select></td></tr>`)}
        </tbody></table></div>` : html`<div class="card empty"><p>Todavía no has recibido solicitudes.</p></div>`}`
    : html`<div class="card empty"><h2>Tu cuenta no tiene ninguna empresa asociada</h2><a class="btn btn-primary" href="#/registrar">Registrar mi empresa</a></div>`}
    <p class="small muted" style="margin-top:24px">¿Quieres eliminar tu cuenta o tus datos? <a href="#/privacidad?form=1">Envía una solicitud RGPD</a>.</p>
  </div>`);

  root.addEventListener('change', async (e) => {
    if (!e.target.dataset.inq) return;
    try { await api(`/api/account/inquiries/${e.target.dataset.inq}`, { method: 'PUT', body: { status: e.target.value } }); toast('Estado actualizado'); }
    catch (err) { toast(err.message, { error: true }); }
  });
  root.querySelector('[data-edit]')?.addEventListener('click', () => {
    const area = $('#edit-area', root);
    area.innerHTML = String(html`<h2>Editar ficha</h2>${companyFormHtml(c, 'account')}`);
    const form = $('#company-form', area);
    bindCompanyForm(form);
    area.scrollIntoView({ behavior: 'smooth' });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const res = await submitForm(form, () => api('/api/account/company', { method: 'PUT', body: readCompanyForm(form) }));
      if (res) { toast('Ficha actualizada'); window.dispatchEvent(new HashChangeEvent('hashchange')); }
    });
  });
}
