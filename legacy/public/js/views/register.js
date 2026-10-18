// Formulario de empresa (alta pública, edición por la propia empresa y edición en admin)
import { $, $$, api, armSpamProtection, formValues, html, icon, logo, raw, setTitle, store, submitForm, toast } from '../lib.js';

const sel = (cond) => (cond ? raw('selected') : '');
const chk = (cond) => (cond ? raw('checked') : '');

function checkGroup(name, options, selected, errorKey = name) {
  const s = new Set((selected || []).map(Number));
  return html`<div class="check-grid" data-error-for="${errorKey}">${options.map((o) => html`<label class="check">
    <input type="checkbox" data-multi name="${name}" value="${o.id}" ${chk(s.has(o.id))}><span>${o.name}</span></label>`)}</div>`;
}

function contactBlock(k = {}, i = 0, langs) {
  const kl = new Set((k.languages || '').split(',').filter(Boolean));
  return html`<div class="contact-block">
    ${i > 0 ? html`<button type="button" class="btn btn-ghost btn-sm" style="position:absolute;top:8px;right:8px" data-remove-contact>${icon('trash')} Quitar</button>` : ''}
    <div class="form-grid">
      <div class="field"><label class="req">Nombre y apellidos</label><input class="input" name="c_full_name" value="${k.full_name || ''}" maxlength="120" autocomplete="name"></div>
      <div class="field"><label>Cargo</label><input class="input" name="c_job_title" value="${k.job_title || ''}" maxlength="120" autocomplete="organization-title"></div>
      <div class="field"><label class="req">Email</label><input class="input" type="email" name="c_email" value="${k.email || ''}" autocomplete="email"></div>
      <div class="field"><label>Teléfono</label><input class="input" type="tel" name="c_phone" value="${k.phone || ''}" autocomplete="tel"></div>
      <div class="field"><label>WhatsApp</label><input class="input" type="tel" name="c_whatsapp" value="${k.whatsapp || ''}" placeholder="+34 600 000 000"></div>
      <div class="field"><span class="label">Idiomas que habla</span><div class="row" style="gap:10px">
        ${langs.map((l) => html`<label class="check"><input type="checkbox" name="c_lang" value="${l.code}" ${chk(kl.has(l.code))}>${l.code.toUpperCase()}</label>`)}</div></div>
      <label class="check span-2"><input type="radio" name="c_primary" ${chk(k.is_primary || (i === 0 && k.is_primary === undefined))}> Contacto principal (recibe las solicitudes)</label>
      <label class="check span-2"><input type="checkbox" name="c_consent_public" ${chk(k.consent_public)}>
        <span>Autorizo mostrar públicamente el email, teléfono y WhatsApp de este contacto. Si no lo marcas, solo se mostrará el formulario de contacto.</span></label>
    </div></div>`;
}

/** mode: 'register' | 'account' | 'admin' */
export function companyFormHtml(c = {}, mode = 'register') {
  const m = store.meta;
  const ids = (list) => (list || []).map((x) => x.id);
  const tops = m.categories.filter((x) => !x.parent_id);
  const selCats = new Set(ids(c.categories));
  const selProducts = new Set(ids(c.products));
  const exp = ids(c.export_markets);
  const imp = ids(c.import_markets);
  const contacts = c.contacts?.length ? c.contacts : [{}];
  let n = 0;
  const num = () => ++n;

  return html`<form id="company-form" novalidate>
    ${mode === 'admin' ? html`<div class="card form-card"><h2>Estado y publicación</h2><div class="form-grid">
      <div class="field"><label>Estado</label><select class="input" name="status">
        ${[['pending_review', 'Pendiente de revisión'], ['approved', 'Aprobada (publicada)'], ['rejected', 'Rechazada']].map(([v, l]) => html`<option value="${v}" ${sel((c.status || 'approved') === v)}>${l}</option>`)}</select></div>
      <div class="field"><label>Verificación</label><select class="input" name="verification_status">
        ${[['verified', 'Verificada'], ['pending', 'Pendiente'], ['unverified', 'No verificada']].map(([v, l]) => html`<option value="${v}" ${sel((c.verification_status || 'pending') === v)}>${l}</option>`)}</select></div>
      <label class="check"><input type="checkbox" name="is_featured" ${chk(c.is_featured)}> Empresa destacada en portada</label>
      <div class="field span-2"><label>Motivo de rechazo (se envía a la empresa)</label><input class="input" name="rejection_reason" value="${c.rejection_reason || ''}"></div>
    </div></div>` : ''}

    <div class="card form-card"><h2><span class="num">${num()}</span> Datos de la empresa</h2><div class="form-grid">
      <div class="field span-2"><label class="req" for="f-name">Nombre comercial</label><input class="input" id="f-name" name="name" value="${c.name || ''}" maxlength="150" autocomplete="organization"></div>
      <div class="field span-2"><span class="label">Logo</span><div class="logo-upload">
        <div id="logo-preview">${c.name ? logo(c, 'logo-lg') : html`<div class="logo logo-lg">${icon('building')}</div>`}</div>
        <div class="stack"><input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp" class="input" data-error-for="logo">
          <span class="hint">PNG, JPG o WebP. Se redimensiona a 256 px.</span>
          ${c.logo_url ? html`<label class="check"><input type="checkbox" name="remove_logo"> Eliminar logo actual</label>` : ''}</div></div></div>
      <div class="field span-2"><label for="f-desc">Descripción</label><textarea class="input" id="f-desc" name="description" maxlength="3000" placeholder="Qué producís o comercializáis, origen, diferenciación, volúmenes…">${c.description || ''}</textarea></div>
      <div class="field"><label for="f-year">Año de fundación</label><input class="input" id="f-year" type="number" name="year_founded" min="1800" max="${new Date().getFullYear()}" value="${c.year_founded ?? ''}"></div>
      <div class="field"><label for="f-tax">Identificación fiscal (NIF, CNPJ, CUIT, NIT…)</label><input class="input" id="f-tax" name="tax_id" value="${c.tax_id || ''}" maxlength="40">
        <span class="hint">No se publica. Sirve para verificar la empresa y evitar duplicados.</span></div>
      <div class="field span-2"><label for="f-web">Sitio web</label><input class="input" id="f-web" type="url" name="website" value="${c.website || ''}" placeholder="https://"></div>
    </div></div>

    <div class="card form-card"><h2><span class="num">${num()}</span> Ubicación</h2><div class="form-grid">
      <div class="field"><label class="req" for="f-country">País</label><select class="input" id="f-country" name="country_id">
        <option value="">Selecciona…</option>${m.countries.map((k) => html`<option value="${k.id}" ${sel(c.country_id === k.id)}>${k.name}</option>`)}</select></div>
      <div class="field"><label for="f-region">Región / provincia / estado</label><input class="input" id="f-region" name="region" value="${c.region || ''}" maxlength="100"></div>
      <div class="field"><label class="req" for="f-city">Ciudad</label><input class="input" id="f-city" name="city" value="${c.city || ''}" maxlength="100"></div>
      <div class="field"><label for="f-addr">Dirección aproximada</label><input class="input" id="f-addr" name="address" value="${c.address || ''}" maxlength="200" placeholder="Barrio, polígono o zona"></div>
      <div class="field span-2"><label for="f-cov">Zona de cobertura</label><input class="input" id="f-cov" name="coverage_area" value="${c.coverage_area || ''}" maxlength="300" placeholder="Ej.: España y Portugal; exportación a la UE"></div>
    </div></div>

    <div class="card form-card"><h2><span class="num">${num()}</span> Actividad</h2><div class="stack">
      <div class="form-grid"><div class="field"><label class="req" for="f-type">Tipo de empresa principal</label><select class="input" id="f-type" name="company_type">
        <option value="">Selecciona…</option>${m.business_types.map((b) => html`<option value="${b.slug}" ${sel(c.company_type === b.slug)}>${b.name}</option>`)}</select></div></div>
      <div class="field"><span class="label">Otras actividades</span>${checkGroup('business_types', m.business_types, ids(c.business_types))}</div>
      <div class="field"><span class="label req">Categorías y subcategorías</span>
        <div class="stack" data-error-for="categories">${tops.map((t) => html`<div class="cat-block cat-${t.slug}"><strong>${t.name}</strong>
          <div class="check-grid">${m.categories.filter((s) => s.parent_id === t.id).map((s) => html`<label class="check">
            <input type="checkbox" data-multi name="categories" value="${s.id}" ${chk(selCats.has(s.id))}><span>${s.name}</span></label>`)}</div></div>`)}</div></div>
      <div class="field"><span class="label">Productos</span><span class="hint">Se muestran los productos de las subcategorías elegidas.</span>
        <div class="check-grid" id="products-box">${m.products.map((p) => html`<label class="check" data-cat="${p.category_id}">
          <input type="checkbox" data-multi name="products" value="${p.id}" ${chk(selProducts.has(p.id))}><span>${p.name}${p.hs_code ? html` <span class="muted small">(${p.hs_code})</span>` : ''}</span></label>`)}</div></div>
      <div class="field"><span class="label">Certificaciones</span>${checkGroup('certifications', m.certifications, ids(c.certifications))}</div>
      <div class="field"><span class="label">Idiomas de atención</span>${checkGroup('languages', m.languages, ids(c.languages))}</div>
      <div class="field"><span class="label">Tipo de cliente atendido</span>${checkGroup('client_types', m.client_types, ids(c.client_types))}</div>
    </div></div>

    <div class="card form-card"><h2><span class="num">${num()}</span> Mercados</h2><div class="form-grid">
      <div class="field"><label for="f-exp">Exporta a</label><select class="input" id="f-exp" name="export_markets" multiple size="8">
        ${m.countries.map((k) => html`<option value="${k.id}" ${sel(exp.includes(k.id))}>${k.name}</option>`)}</select>
        <span class="hint">Ctrl/Cmd + clic para elegir varios.</span></div>
      <div class="field"><label for="f-imp">Importa desde</label><select class="input" id="f-imp" name="import_markets" multiple size="8">
        ${m.countries.map((k) => html`<option value="${k.id}" ${sel(imp.includes(k.id))}>${k.name}</option>`)}</select></div>
    </div></div>

    <div class="card form-card"><h2><span class="num">${num()}</span> Capacidad y condiciones comerciales</h2><div class="form-grid">
      <div class="field"><label for="f-cap">Capacidad de exportación (t/año)</label><input class="input" id="f-cap" type="number" min="0" name="export_capacity" value="${c.export_capacity ?? ''}"></div>
      <div class="field"><label for="f-prod">Capacidad de producción</label><input class="input" id="f-prod" name="production_capacity" value="${c.production_capacity || ''}" maxlength="200" placeholder="Ej.: 2 líneas de envasado, 5.000 l/h"></div>
      <div class="field"><label for="f-mo">Pedido mínimo (kg)</label><input class="input" id="f-mo" type="number" min="0" step="any" name="minimum_order" value="${c.minimum_order ?? ''}"></div>
      <div class="field"><label for="f-mon">Pedido mínimo (descripción)</label><input class="input" id="f-mon" name="minimum_order_notes" value="${c.minimum_order_notes || ''}" maxlength="200" placeholder="Ej.: 1 palé, 1 contenedor 20'"></div>
      <div class="field span-2"><label for="f-terms">Condiciones comerciales</label><textarea class="input" id="f-terms" name="commercial_terms" maxlength="1500" placeholder="Incoterms, forma de pago, plazos de entrega, muestras…">${c.commercial_terms || ''}</textarea></div>
    </div></div>

    <div class="card form-card"><h2><span class="num">${num()}</span> Redes sociales</h2><div class="form-grid">
      <div class="field"><label for="f-li">LinkedIn</label><input class="input" id="f-li" type="url" name="linkedin_url" value="${c.linkedin_url || ''}"></div>
      <div class="field"><label for="f-ig">Instagram</label><input class="input" id="f-ig" type="url" name="instagram_url" value="${c.instagram_url || ''}"></div>
      <div class="field"><label for="f-fb">Facebook</label><input class="input" id="f-fb" type="url" name="facebook_url" value="${c.facebook_url || ''}"></div>
      <div class="field"><label for="f-ot">Otra red o catálogo</label><input class="input" id="f-ot" type="url" name="other_social_url" value="${c.other_social_url || ''}"></div>
    </div></div>

    <div class="card form-card"><h2><span class="num">${num()}</span> Personas de contacto</h2>
      <div id="contacts">${contacts.map((k, i) => contactBlock(k, i, m.languages))}</div>
      <button type="button" class="btn btn-outline btn-sm" style="margin-top:12px" data-add-contact>${icon('plus')} Añadir otro contacto</button>
    </div>

    ${mode === 'register' && !store.user ? html`<div class="card form-card"><h2><span class="num">${num()}</span> Cuenta de acceso (opcional)</h2>
      <p class="muted">Crea una cuenta para editar tu ficha, ver las solicitudes que recibas y guardar favoritos.</p>
      <label class="check" style="margin-bottom:12px"><input type="checkbox" name="create_account" id="create-account" checked> Crear una cuenta de empresa</label>
      <div class="form-grid" id="account-fields">
        <div class="field"><label class="req" for="f-aemail">Email de acceso</label><input class="input" id="f-aemail" type="email" name="account_email" autocomplete="username"></div>
        <div class="field"><label class="req" for="f-apass">Contraseña</label><input class="input" id="f-apass" type="password" name="account_password" autocomplete="new-password" minlength="10">
          <span class="hint">Mínimo 10 caracteres, con letras y números.</span></div>
      </div></div>` : ''}

    ${mode === 'register' ? html`<div class="card form-card"><h2>Consentimientos</h2><div class="stack">
      <label class="check field"><input type="checkbox" name="consent_terms">
        <span>Confirmo que represento a esta empresa y tengo autorización para publicar estos datos y los de las personas de contacto indicadas.</span></label>
      <label class="check field"><input type="checkbox" name="consent_privacy">
        <span>He leído y acepto la <a href="#/privacidad" target="_blank">política de privacidad</a>. Podré solicitar la modificación o eliminación de mis datos en cualquier momento.</span></label>
    </div></div>` : ''}

    <div class="sticky-actions">
      ${mode === 'admin' && c.id ? html`<button type="button" class="btn btn-danger" data-delete>${icon('trash')} Eliminar</button><span class="spacer"></span>` : ''}
      <button class="btn btn-primary btn-lg" type="submit">${mode === 'register' ? 'Enviar solicitud de alta' : 'Guardar cambios'}</button>
    </div>
  </form>`;
}

export function bindCompanyForm(form) {
  const langs = store.meta.languages;
  const filterProducts = () => {
    const cats = new Set($$('input[name="categories"]:checked', form).map((x) => x.value));
    $$('#products-box [data-cat]', form).forEach((l) => {
      const show = cats.has(l.dataset.cat) || l.querySelector('input').checked;
      l.classList.toggle('hidden', !show);
    });
  };
  filterProducts();
  form.addEventListener('change', (e) => {
    if (e.target.name === 'categories') filterProducts();
    if (e.target.id === 'create-account') $('#account-fields', form).classList.toggle('hidden', !e.target.checked);
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-add-contact]')) {
      const box = $('#contacts', form);
      if ($$('.contact-block', box).length >= 5) return toast('Máximo 5 contactos', { error: true });
      box.insertAdjacentHTML('beforeend', String(contactBlock({ is_primary: false }, 1, langs)));
    }
    const rm = e.target.closest('[data-remove-contact]');
    if (rm) rm.closest('.contact-block').remove();
  });
  // Logo: redimensionado en el navegador y enviado como data URL
  $('#logo-file', form).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) { delete form.dataset.logo; return; }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Formato no admitido', { error: true }); e.target.value = ''; return; }
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 256 / Math.max(img.width, img.height));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    form.dataset.logo = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
    $('#logo-preview', form).innerHTML = `<div class="logo logo-lg"><img src="${form.dataset.logo}" alt=""></div>`;
  });
}

export function readCompanyForm(form) {
  const v = formValues(form);
  const num = (arr) => (arr || []).map(Number);
  const contacts = $$('.contact-block', form).map((b) => ({
    full_name: $('[name="c_full_name"]', b).value, job_title: $('[name="c_job_title"]', b).value,
    email: $('[name="c_email"]', b).value, phone: $('[name="c_phone"]', b).value, whatsapp: $('[name="c_whatsapp"]', b).value,
    languages: $$('[name="c_lang"]:checked', b).map((x) => x.value).join(','),
    is_primary: $('[name="c_primary"]', b).checked, consent_public: $('[name="c_consent_public"]', b).checked,
  }));
  for (const k of Object.keys(v)) if (k.startsWith('c_')) delete v[k];
  return {
    ...v, contacts, logo_data: form.dataset.logo || undefined,
    business_types: num(v.business_types), categories: num(v.categories), products: num(v.products),
    certifications: num(v.certifications), languages: num(v.languages), client_types: num(v.client_types),
    export_markets: num(v.export_markets), import_markets: num(v.import_markets),
  };
}

export async function renderRegister(root) {
  setTitle('Registra tu empresa');
  if (store.user?.company_id) {
    root.innerHTML = String(html`<div class="wrap empty"><h2>Tu cuenta ya tiene una empresa</h2><p>Puedes editar su ficha desde tu área privada.</p>
      <a class="btn btn-primary" href="#/cuenta">Ir a mi cuenta</a></div>`);
    return;
  }
  root.innerHTML = String(html`<div class="wrap">
    <div class="page-head form-narrow"><h1>Registra tu empresa</h1>
      <p>Da de alta tu empresa gratis en el directorio. Tras enviarla, quedará <strong>pendiente de revisión</strong>: nuestro equipo comprobará los datos antes de publicarla.</p></div>
    <div class="form-narrow" id="form-wrap">${companyFormHtml({}, 'register')}</div></div>`);
  const form = $('#company-form', root);
  bindCompanyForm(form);
  armSpamProtection(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = readCompanyForm(form);
    const res = await submitForm(form, () => api('/api/register', { method: 'POST', body }));
    if (!res) return;
    if (res.account) await import('../lib.js').then((l) => l.loadSession());
    $('#form-wrap', root).innerHTML = String(html`<div class="card empty">${icon('check')}<h2>¡Solicitud recibida!</h2>
      <p>Hemos recibido el alta de <strong>${body.name}</strong>. Te avisaremos por email cuando esté publicada.</p>
      <div class="row" style="justify-content:center">${res.account ? html`<a class="btn btn-primary" href="#/cuenta">Ir a mi cuenta</a>` : ''}
      <a class="btn btn-outline" href="#/">Volver al inicio</a></div></div>`);
    window.scrollTo(0, 0);
  });
}
