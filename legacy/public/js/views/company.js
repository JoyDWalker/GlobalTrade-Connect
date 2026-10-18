import {
  $, api, armSpamProtection, companyCard, copyText, flag, fmtKg, fmtNum, formValues, html, icon, logo, openModal, raw, safeUrl,
  setTitle, statusBadge, store, submitForm, toast, toggleFavorite, verificationBadge,
} from '../lib.js';

const langName = (code) => store.meta.languages.find((l) => l.code === code)?.name || code;
const waLink = (n) => `https://wa.me/${String(n).replace(/\D/g, '')}`;

export async function renderCompany(root, { params }) {
  const { company: c, related } = await api(`/api/companies/${encodeURIComponent(params[0])}`);
  setTitle(c.name);
  const tops = c.categories.filter((k) => !k.parent_id);
  const subs = c.categories.filter((k) => k.parent_id);
  const primary = c.contacts.find((k) => k.is_primary) || c.contacts[0];
  const publicEmail = c.contacts.find((k) => k.email)?.email;
  const fav = () => store.favorites.has(c.id);
  const site = safeUrl(c.website);
  const socials = [['linkedin_url', 'linkedin', 'LinkedIn'], ['instagram_url', 'instagram', 'Instagram'], ['facebook_url', 'facebook', 'Facebook'], ['other_social_url', 'link', 'Otra red']]
    .filter(([k]) => safeUrl(c[k]));

  const section = (title, body) => (body ? html`<section class="card"><h2>${title}</h2>${body}</section>` : '');
  const markets = (list) => html`<div class="markets">${list.map((m) => html`<span class="chip chip-outline">${flag(m)} ${m.name}</span>`)}</div>`;

  root.innerHTML = String(html`<div class="wrap">
    <nav class="breadcrumb" aria-label="Ruta"><a href="#/">Inicio</a> › <a href="#/buscar">Empresas</a> ›
      <a href="#/buscar?country=${c.country_iso}">${c.country_name}</a> › <span>${c.name}</span></nav>

    ${c.status !== 'approved' ? html`<div class="notice notice-warn" style="margin-top:12px">Esta ficha no es pública: ${statusBadge(c.status)}
      Solo tú (o el administrador) puedes verla.</div>` : ''}
    ${c.is_demo ? html`<div class="notice notice-info" style="margin-top:12px"><strong>Empresa ficticia de demostración.</strong>
      Sus datos de contacto usan dominios <code>.example</code> y teléfonos no asignables.</div>` : ''}

    <div class="card profile-head">
      ${logo(c, 'logo-lg')}
      <div class="info">
        <div class="row" style="gap:6px;margin-bottom:6px">${verificationBadge(c.verification_status)}
          ${c.is_featured ? html`<span class="badge badge-featured">Destacada</span>` : ''}
          ${c.is_demo ? html`<span class="badge badge-demo">DEMO</span>` : ''}</div>
        <h1>${c.name}</h1>
        <div class="meta-line">
          <span>${flag(c)} ${c.city}${c.region ? `, ${c.region}` : ''} · ${c.country_name}</span>
          <span>${icon('building')} ${c.business_types.map((b) => b.name).join(' · ') || c.company_type_name}</span>
          ${c.year_founded ? html`<span>${icon('calendar')} Fundada en ${c.year_founded}</span>` : ''}
        </div>
        <div class="row" style="gap:6px;margin-top:10px">${tops.map((k) => html`<a class="chip chip-cat cat-${k.slug}" href="#/buscar?category=${k.slug}">${k.name}</a>`)}</div>
        <div class="profile-actions">
          <button class="btn btn-primary" data-contact="contact">${icon('mail')} Contactar empresa</button>
          <button class="btn btn-accent" data-contact="quote">${icon('quote')} Solicitar cotización</button>
          <button class="btn btn-outline ${fav() ? 'is-fav' : ''}" data-fav-main>${icon('heart')} <span>${fav() ? 'Guardada' : 'Guardar en favoritos'}</span></button>
          ${publicEmail ? html`<button class="btn btn-outline" data-copy-email>${icon('copy')} Copiar email</button>` : ''}
          <button class="btn btn-outline" data-share>${icon('share')} Compartir ficha</button>
        </div>
      </div>
    </div>

    <div class="profile-layout">
      <div>
        ${section('Sobre la empresa', c.description ? html`<p style="white-space:pre-line">${c.description}</p>` : html`<p class="muted">Sin descripción.</p>`)}
        ${section('Categorías y productos', html`
          ${subs.length ? html`<div class="row" style="gap:6px;margin-bottom:14px">${subs.map((k) => html`<a class="chip chip-outline" href="#/buscar?subcategory=${k.slug}">${k.name}</a>`)}</div>` : ''}
          ${c.products.length ? html`<ul class="product-list">${c.products.map((p) => html`<li><span>${p.name}</span>${p.hs_code ? html`<span class="hs" title="Código arancelario SA">SA ${p.hs_code}</span>` : ''}</li>`)}</ul>` : ''}`)}
        ${section('Certificaciones', c.certifications.length
          ? html`<div class="row" style="gap:6px">${c.certifications.map((k) => html`<a class="badge badge-verified" href="#/buscar?cert=${k.slug}">${icon('check')}${k.name}</a>`)}</div>`
          : html`<p class="muted">La empresa no ha declarado certificaciones.</p>`)}
        ${c.export_markets.length || c.import_markets.length ? section('Mercados', html`
          ${c.export_markets.length ? html`<h3>Exporta a</h3>${markets(c.export_markets)}` : ''}
          ${c.import_markets.length ? html`<h3 style="margin-top:16px">Importa desde</h3>${markets(c.import_markets)}` : ''}`) : ''}
        ${section('Capacidad y condiciones comerciales', html`<dl class="kv">
          <dt>Capacidad de exportación</dt><dd>${c.export_capacity != null ? `${fmtNum(c.export_capacity)} t/año` : 'No indicada'}</dd>
          <dt>Capacidad de producción</dt><dd>${c.production_capacity || 'No indicada'}</dd>
          <dt>Pedido mínimo</dt><dd>${c.minimum_order != null ? fmtKg(c.minimum_order) : 'No indicado'}${c.minimum_order_notes ? html` <span class="muted">· ${c.minimum_order_notes}</span>` : ''}</dd>
          <dt>Condiciones</dt><dd>${c.commercial_terms || 'A consultar'}</dd>
          <dt>Clientes atendidos</dt><dd>${c.client_types.map((t) => t.name).join(', ') || '—'}</dd>
          <dt>Idiomas de atención</dt><dd>${c.languages.map((l) => l.name).join(', ') || '—'}</dd>
        </dl>`)}
      </div>

      <aside>
        <div class="card card-pad">
          <h2>Contacto</h2>
          ${primary ? html`<div style="margin-bottom:8px"><strong>${primary.full_name}</strong><div class="muted small">${primary.job_title || ''}</div>
            ${primary.languages ? html`<div class="small muted">Atiende en: ${primary.languages.split(',').map(langName).join(', ')}</div>` : ''}</div>` : ''}
          ${c.contacts.map((k) => html`
            ${k !== primary ? html`<div style="margin-top:10px"><strong>${k.full_name}</strong> <span class="muted small">${k.job_title || ''}</span></div>` : ''}
            ${k.email ? html`<div class="contact-line">${icon('mail')}<a class="grow" href="mailto:${k.email}">${k.email}</a>
              <button class="icon-btn" data-copy="${k.email}" aria-label="Copiar email">${icon('copy')}</button></div>` : ''}
            ${k.phone ? html`<div class="contact-line">${icon('phone')}<a class="grow" href="tel:${k.phone.replace(/\s/g, '')}">${k.phone}</a></div>` : ''}
            ${k.whatsapp ? html`<div class="contact-line">${icon('whatsapp')}<a class="grow" href="${waLink(k.whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp ${k.whatsapp}</a></div>` : ''}`)}
          ${!publicEmail ? html`<div class="notice small" style="margin:8px 0">Esta empresa prefiere recibir los contactos a través del formulario.</div>` : ''}
          ${site ? html`<div class="contact-line">${icon('globe')}<a class="grow" href="${site}" target="_blank" rel="noopener noreferrer nofollow">${site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></div>` : ''}
          ${socials.length ? html`<div class="row" style="gap:6px;margin-top:10px">${socials.map(([k, ic, label]) => html`<a class="btn btn-outline btn-sm" href="${c[k]}" target="_blank" rel="noopener noreferrer nofollow">${icon(ic)} ${label}</a>`)}</div>` : ''}
          <button class="btn btn-primary" style="width:100%;margin-top:14px" data-contact="contact">Enviar mensaje</button>
        </div>
        <div class="card card-pad">
          <h3>Ubicación y cobertura</h3>
          <div class="contact-line">${icon('pin')}<span class="grow">${c.address || c.city}<br><span class="muted small">${c.city}${c.region ? `, ${c.region}` : ''} · ${c.country_name}</span></span></div>
          ${c.coverage_area ? html`<div class="contact-line">${icon('ship')}<span class="grow">${c.coverage_area}</span></div>` : ''}
        </div>
        <p class="small muted" style="margin-top:12px">Ficha actualizada el ${new Date(c.updated_at).toLocaleDateString('es-ES')} ·
          <a href="#" data-report>${icon('flag', 'sr-only')}Reportar datos incorrectos</a></p>
      </aside>
    </div>

    ${related.length ? html`<section style="margin-bottom:48px"><h2>Empresas similares</h2><div class="cards">${related.map((r) => companyCard(r))}</div></section>` : ''}
  </div>`);

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a[data-report]');
    if (!t) return;
    if (t.dataset.contact) contactModal(c, t.dataset.contact);
    else if (t.matches('[data-fav-main]')) {
      try {
        const on = await toggleFavorite(c.id);
        t.classList.toggle('is-fav', on);
        t.querySelector('span').textContent = on ? 'Guardada' : 'Guardar en favoritos';
      } catch (err) { toast(err.message, { error: true }); }
    } else if (t.matches('[data-copy-email]')) copyText(publicEmail, 'Email copiado');
    else if (t.dataset.copy) copyText(t.dataset.copy, 'Email copiado');
    else if (t.matches('[data-share]')) {
      const url = location.href;
      if (navigator.share) navigator.share({ title: c.name, text: `${c.name} en GlobalTrade Connect`, url }).catch(() => {});
      else copyText(url, 'Enlace de la ficha copiado');
    } else if (t.matches('[data-report]')) { e.preventDefault(); reportModal(c); }
  });
}

function contactModal(c, type) {
  const quote = type === 'quote';
  const countries = store.meta.countries;
  const m = openModal(quote ? `Solicitar cotización a ${c.name}` : `Contactar con ${c.name}`, html`
    <form id="inq" novalidate class="stack">
      <div class="form-grid">
        <div class="field"><label class="req" for="i-name">Tu nombre</label><input class="input" id="i-name" name="sender_name" autocomplete="name" required maxlength="120"></div>
        <div class="field"><label for="i-comp">Tu empresa</label><input class="input" id="i-comp" name="sender_company" autocomplete="organization" maxlength="150"></div>
        <div class="field"><label class="req" for="i-country">País</label><select class="input" id="i-country" name="sender_country" required>
          <option value="">Selecciona…</option>${countries.map((k) => html`<option>${k.name}</option>`)}<option>Otro</option></select></div>
        <div class="field"><label class="req" for="i-email">Email</label><input class="input" id="i-email" type="email" name="email" autocomplete="email" required></div>
        <div class="field"><label for="i-phone">Teléfono</label><input class="input" id="i-phone" type="tel" name="phone" autocomplete="tel"></div>
        <div class="field"><label for="i-prod">Producto de interés</label><input class="input" id="i-prod" name="product_interest" list="i-prods" maxlength="200">
          <datalist id="i-prods">${c.products.map((p) => html`<option value="${p.name}">`)}</datalist></div>
        <div class="field span-2"><label for="i-vol">Volumen estimado</label>
          <input class="input" id="i-vol" name="estimated_volume" placeholder="Ej.: 2 contenedores de 20' al año, 500 kg/mes…" maxlength="120"></div>
        <div class="field span-2"><label class="req" for="i-msg">Mensaje</label>
          <textarea class="input" id="i-msg" name="message" required minlength="20" maxlength="3000" placeholder="${quote ? 'Indica especificaciones, formato, Incoterm y puerto/destino deseado…' : 'Cuéntale a la empresa qué necesitas…'}"></textarea></div>
      </div>
      <label class="check field"><input type="checkbox" name="consent_privacy" required>
        <span>He leído la <a href="#/privacidad" target="_blank">política de privacidad</a> y acepto que mis datos se compartan con ${c.name} para responder a esta solicitud.</span></label>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn btn-outline" data-cancel>Cancelar</button>
        <button class="btn btn-primary" type="submit">${quote ? 'Enviar solicitud de cotización' : 'Enviar mensaje'}</button></div>
    </form>`);
  const form = $('#inq', m.el);
  armSpamProtection(form);
  if (store.user) { form.sender_name.value = store.user.name; form.email.value = store.user.email; }
  $('[data-cancel]', m.el).onclick = () => m.close();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { ...formValues(form), inquiry_type: type };
    const ok = await submitForm(form, () => api(`/api/companies/${c.slug}/inquiries`, { method: 'POST', body }));
    if (ok) {
      $('.modal-body', m.el).innerHTML = String(html`<div class="empty" style="padding:24px">${icon('check')}
        <h3>¡Solicitud enviada!</h3><p>Hemos enviado tu mensaje a ${c.name}. Te responderán directamente a <strong>${body.email}</strong>.</p>
        <button class="btn btn-primary" data-close-ok>Cerrar</button></div>`);
      $('[data-close-ok]', m.el).onclick = () => m.close();
    }
  });
}

function reportModal(c) {
  const m = openModal('Reportar datos incorrectos', html`
    <form id="rep" novalidate class="stack">
      <p class="muted">Ayúdanos a mantener el directorio al día. Revisaremos la ficha de <strong>${c.name}</strong>.</p>
      <div class="field"><label for="r-field">¿Qué dato es incorrecto?</label><select class="input" id="r-field" name="field">
        ${['Datos de contacto', 'Teléfono', 'Email', 'Dirección', 'Productos', 'Certificaciones', 'La empresa ya no existe', 'Otro'].map((o) => html`<option>${o}</option>`)}</select></div>
      <div class="field"><label class="req" for="r-msg">Descripción</label><textarea class="input" id="r-msg" name="message" required minlength="10"></textarea></div>
      <div class="field"><label for="r-email">Tu email (opcional, por si necesitamos más información)</label><input class="input" id="r-email" type="email" name="reporter_email"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Enviar reporte</button></div>
    </form>`);
  const form = $('#rep', m.el);
  armSpamProtection(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await submitForm(form, () => api(`/api/companies/${c.slug}/reports`, { method: 'POST', body: formValues(form) }));
    if (ok) { m.close(); toast('Gracias. Revisaremos la información.'); }
  });
}
