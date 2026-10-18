import { $, api, armSpamProtection, companyCard, downloadPost, flag, formValues, html, icon, setTitle, store, submitForm, toast } from '../lib.js';

// ───────────── Solicitar proveedores ─────────────
export async function renderSupplierRequest(root) {
  setTitle('Solicitar proveedores');
  const m = store.meta;
  const tops = m.categories.filter((c) => !c.parent_id);
  root.innerHTML = String(html`<div class="wrap">
    <div class="page-head form-narrow"><h1>Solicita proveedores</h1>
      <p>Indícanos qué necesitas y nuestro equipo te pondrá en contacto con los proveedores que mejor encajen. Sin coste ni compromiso.</p></div>
    <div class="form-narrow" id="sr-wrap"><form class="card form-card" id="sr" novalidate>
      <h2>¿Qué estás buscando?</h2>
      <div class="form-grid">
        <div class="field"><label for="s-cat">Categoría</label><select class="input" id="s-cat" name="category_id">
          <option value="">Cualquiera</option>${tops.map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select></div>
        <div class="field"><label class="req" for="s-prod">Producto</label><input class="input" id="s-prod" name="product" maxlength="200" placeholder="Ej.: cacao en grano fino de aroma"></div>
        <div class="field"><label class="req" for="s-qty">Cantidad</label><input class="input" id="s-qty" name="quantity" maxlength="120" placeholder="Ej.: 20 t/año, 1 contenedor al mes"></div>
        <div class="field"><label for="s-date">Fecha objetivo</label><input class="input" id="s-date" type="date" name="target_date" min="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field span-2"><span class="label">País de origen preferido</span><div class="check-grid">
          ${m.countries.filter((c) => c.is_priority).map((c) => html`<label class="check"><input type="checkbox" data-multi name="origin_countries" value="${c.iso_code}">${flag(c)} ${c.name}</label>`)}</div></div>
        <div class="field span-2"><span class="label">Certificaciones necesarias</span><div class="check-grid">
          ${m.certifications.map((c) => html`<label class="check"><input type="checkbox" data-multi name="certifications" value="${c.slug}">${c.name}</label>`)}</div></div>
        <div class="field span-2"><label for="s-notes">Detalles adicionales</label><textarea class="input" id="s-notes" name="notes" maxlength="3000" placeholder="Especificaciones, formato, Incoterm, destino, precio objetivo…"></textarea></div>
      </div>
      <h2 style="margin-top:24px">Tus datos</h2>
      <div class="form-grid">
        <div class="field"><label class="req" for="s-name">Nombre</label><input class="input" id="s-name" name="user_name" autocomplete="name"></div>
        <div class="field"><label for="s-comp">Empresa</label><input class="input" id="s-comp" name="company_name" autocomplete="organization"></div>
        <div class="field"><label class="req" for="s-email">Email</label><input class="input" id="s-email" type="email" name="email" autocomplete="email"></div>
        <div class="field"><label for="s-phone">Teléfono</label><input class="input" id="s-phone" type="tel" name="phone" autocomplete="tel"></div>
        <label class="check field span-2"><input type="checkbox" name="consent_privacy">
          <span>Acepto la <a href="#/privacidad" target="_blank">política de privacidad</a> y que GlobalTrade Connect comparta mi solicitud con proveedores adecuados.</span></label>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn btn-primary btn-lg" type="submit">Enviar solicitud</button></div>
    </form></div></div>`);
  const form = $('#sr', root);
  armSpamProtection(form);
  if (store.user) { form.user_name.value = store.user.name; form.email.value = store.user.email; }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await submitForm(form, () => api('/api/supplier-requests', { method: 'POST', body: formValues(form) }));
    if (ok) {
      $('#sr-wrap', root).innerHTML = String(html`<div class="card empty">${icon('check')}<h2>Solicitud enviada</h2>
        <p>Nuestro equipo revisará tu solicitud y te contactará en un plazo de 48 horas laborables.</p>
        <a class="btn btn-primary" href="#/buscar">Mientras tanto, explora el directorio</a></div>`);
      window.scrollTo(0, 0);
    }
  });
}

// ───────────── Favoritos ─────────────
export async function renderFavorites(root) {
  setTitle('Favoritos');
  const ids = [...store.favorites];
  const items = store.user
    ? (await api('/api/favorites')).items
    : ids.length ? (await api(`/api/companies?ids=${ids.join(',')}&pageSize=48`)).items : [];
  root.innerHTML = String(html`<div class="wrap" style="padding-bottom:48px">
    <div class="page-head row"><div><h1>Empresas guardadas</h1>
      <p class="muted">${store.user ? 'Tus leads guardados en tu cuenta.' : 'Guardadas en este navegador. Inicia sesión para conservarlas en tu cuenta.'}</p></div>
      <span class="spacer"></span>
      ${items.length ? html`<button class="btn btn-outline" data-export="csv">${icon('download')} Exportar CSV</button>
        <button class="btn btn-outline" data-export="xlsx">Excel</button>` : ''}</div>
    ${items.length ? html`<div class="cards">${items.map((c) => companyCard(c))}</div>`
      : html`<div class="card empty">${icon('heart')}<h3>Aún no has guardado empresas</h3><p>Pulsa el corazón en cualquier ficha para guardarla como lead.</p>
          <a class="btn btn-primary" href="#/buscar">Buscar empresas</a></div>`}</div>`);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-export]');
    if (b) {
      try { await downloadPost('/api/companies/export', { ids: items.map((c) => c.id), format: b.dataset.export }); }
      catch (err) { toast(err.message, { error: true }); }
    }
  });
}

// ───────────── Privacidad / RGPD ─────────────
export async function renderPrivacy(root, { query }) {
  setTitle('Política de privacidad');
  root.innerHTML = String(html`<div class="wrap" style="padding-bottom:48px"><div class="page-head"><h1>Política de privacidad</h1>
    <p class="muted">Última actualización: ${new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })} · Texto orientativo de demostración: revísalo con tu asesor legal.</p></div>
    <div class="profile-layout" style="margin-top:0"><article class="card card-pad prose">
      <h2>1. Responsable del tratamiento</h2>
      <p>GlobalTrade Connect (datos del titular a completar: razón social, NIF, domicilio y email de contacto del delegado de protección de datos si procede).</p>
      <h2>2. Qué datos tratamos y para qué</h2>
      <ul>
        <li><strong>Empresas registradas:</strong> datos comerciales y de las personas de contacto, para publicar la ficha en el directorio. Los datos de contacto personales (email, teléfono, WhatsApp) solo se muestran públicamente si la empresa lo autoriza expresamente.</li>
        <li><strong>Solicitudes de contacto y cotización:</strong> nombre, empresa, país, email, teléfono y mensaje, para hacerlos llegar a la empresa destinataria.</li>
        <li><strong>Solicitudes de proveedores:</strong> para buscar y ponerte en contacto con proveedores adecuados.</li>
        <li><strong>Cuentas de usuario:</strong> email y contraseña cifrada (hash), para el acceso al área privada.</li>
      </ul>
      <h2>3. Base jurídica</h2>
      <p>Tu consentimiento (art. 6.1.a RGPD), recogido mediante casillas no premarcadas, y la ejecución de la relación solicitada (art. 6.1.b). Puedes retirar el consentimiento en cualquier momento.</p>
      <h2>4. Destinatarios</h2>
      <p>Las solicitudes de contacto se comunican únicamente a la empresa a la que te diriges. No vendemos datos a terceros. Los proveedores tecnológicos (alojamiento, envío de email) actúan como encargados del tratamiento.</p>
      <h2>5. Conservación</h2>
      <p>Mientras la ficha o la cuenta estén activas y, después, durante los plazos legales aplicables. Las solicitudes de contacto se conservan un máximo de 24 meses.</p>
      <h2>6. Tus derechos</h2>
      <p>Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad mediante el formulario de esta página. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es) o la autoridad de tu país.</p>
      <h2>7. Cookies y almacenamiento local</h2>
      <p>Solo usamos una cookie técnica de sesión (<code>gt_session</code>) cuando inicias sesión y almacenamiento local del navegador para recordar tus favoritos. No usamos cookies de analítica ni publicidad.</p>
    </article>
    <aside><div class="card card-pad" id="rgpd">
      <h2>Ejercer mis derechos</h2>
      <p class="small muted">Solicita el acceso, la rectificación o la eliminación de tus datos personales.</p>
      <form id="pr" novalidate class="stack">
        <div class="field"><label class="req" for="p-type">Tipo de solicitud</label><select class="input" id="p-type" name="request_type">
          <option value="deletion">Eliminación de mis datos</option><option value="access">Acceso a mis datos</option><option value="rectification">Rectificación</option></select></div>
        <div class="field"><label class="req" for="p-name">Nombre</label><input class="input" id="p-name" name="name" autocomplete="name"></div>
        <div class="field"><label class="req" for="p-email">Email asociado a tus datos</label><input class="input" id="p-email" type="email" name="email" autocomplete="email"></div>
        <div class="field"><label for="p-det">Detalles</label><textarea class="input" id="p-det" name="details" maxlength="2000"></textarea></div>
        <button class="btn btn-primary" type="submit">Enviar solicitud</button>
      </form></div></aside></div></div>`);
  const form = $('#pr', root);
  armSpamProtection(form);
  if (query.get('form')) setTimeout(() => $('#rgpd', root).scrollIntoView({ behavior: 'smooth' }), 50);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await submitForm(form, () => api('/api/privacy-requests', { method: 'POST', body: formValues(form) }));
    if (ok) { form.reset(); toast('Solicitud registrada. Te responderemos en un plazo máximo de un mes.'); }
  });
}
