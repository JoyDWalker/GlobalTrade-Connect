// Utilidades compartidas del front: plantillas seguras, API, estado, UI.

// ───────────── Plantillas HTML con escape automático ─────────────
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);
const renderVal = (v) => (v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(renderVal).join('') : esc(v));
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += renderVal(v) + strings[i + 1]; });
  return new Safe(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Solo permite enlaces http(s) (evita javascript: en URLs guardadas por usuarios). */
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null);

// ───────────── API ─────────────
export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Requested-With': 'fetch' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method, headers, credentials: 'same-origin',
    body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Error ${res.status}`);
    e.status = res.status; e.details = data.details;
    throw e;
  }
  return data;
}

/** POST que devuelve un fichero (exportaciones) y lo descarga. */
export async function downloadPost(path, body) {
  const res = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo exportar');
  const name = decodeURIComponent((res.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || 'export');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ───────────── Estado global ─────────────
const LS_FAVS = 'gt_favorites';
const lsGet = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

export const store = {
  user: null,
  meta: null,
  favorites: new Set(lsGet(LS_FAVS, [])),
  listeners: new Set(),
  emit() { for (const fn of this.listeners) fn(); },
};

export async function loadSession() {
  const me = await api('/api/auth/me');
  store.user = me.user;
  if (store.user) {
    const local = [...store.favorites];
    store.favorites = new Set(me.favorites);
    if (local.some((id) => !store.favorites.has(id))) {
      const r = await api('/api/favorites', { method: 'POST', body: { ids: local } }).catch(() => null);
      if (r) store.favorites = new Set(r.favorites);
      lsSet(LS_FAVS, []);
    }
  }
  store.emit();
}

export async function loadMeta(force = false) {
  if (!store.meta || force) store.meta = await api('/api/meta');
  return store.meta;
}

export async function toggleFavorite(id) {
  id = Number(id);
  const on = !store.favorites.has(id);
  if (store.user) {
    if (on) await api('/api/favorites', { method: 'POST', body: { ids: [id] } });
    else await api(`/api/favorites/${id}`, { method: 'DELETE' });
  }
  on ? store.favorites.add(id) : store.favorites.delete(id);
  if (!store.user) lsSet(LS_FAVS, [...store.favorites]);
  store.emit();
  toast(on ? 'Guardada en favoritos' : 'Eliminada de favoritos');
  return on;
}

// ───────────── UI ─────────────
export function toast(msg, { error = false } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), error ? 5000 : 2800);
}

/** Abre un modal. `content` es html``; devuelve { el, close }. */
export function openModal(title, content, { onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = String(html`<div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button></div>
    <div class="modal-body">${content}</div></div>`);
  const prevFocus = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  setTimeout(() => back.querySelector('input, select, textarea, button:not([data-close])')?.focus(), 30);
  return { el: back, close };
}

export function confirmDialog(message, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal('Confirmar', html`<p>${message}</p><div class="row" style="justify-content:flex-end">
      <button class="btn btn-outline" data-no>Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${ok}</button></div>`,
    { onClose: () => !done && resolve(false) });
    m.el.querySelector('[data-no]').onclick = () => m.close();
    m.el.querySelector('[data-yes]').onclick = () => { done = true; m.close(); resolve(true); };
  });
}

export async function copyText(text, msg = 'Copiado al portapapeles') {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { window.prompt('Copia el texto:', text); }
}

// ───────────── Formularios ─────────────
/** Añade honeypot + token anti-spam a un formulario. */
export async function armSpamProtection(form) {
  form.insertAdjacentHTML('beforeend',
    '<div class="hp-field" aria-hidden="true"><label>No rellenes este campo<input type="text" name="hp_field" tabindex="-1" autocomplete="off"></label></div>');
  const { token } = await api('/api/form-token');
  form.dataset.token = token;
}

export function clearErrors(form) {
  $$('.error-msg', form).forEach((e) => e.remove());
  $$('.has-error', form).forEach((e) => e.classList.remove('has-error'));
}

export function showErrors(form, details = {}, message) {
  clearErrors(form);
  let first = null;
  for (const [key, msg] of Object.entries(details || {})) {
    let el;
    const m = /^contacts\.(\d+)\.(\w+)$/.exec(key);
    if (m) el = $$('.contact-block', form)[Number(m[1])]?.querySelector(`[name="c_${m[2]}"]`);
    else el = form.querySelector(`[data-error-for="${key}"]`) || form.elements[key];
    if (el instanceof RadioNodeList) el = el[0];
    const field = el?.closest?.('.field') || el;
    if (!field) continue;
    field.classList.add('has-error');
    field.insertAdjacentHTML('beforeend', `<span class="error-msg">${esc(msg)}</span>`);
    first ||= field;
  }
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (message) toast(message, { error: true });
}

export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined) { out[el.name] ||= []; if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.multiple) out[el.name] = [...el.selectedOptions].map((o) => o.value);
    else out[el.name] = el.value;
  }
  out.form_token = form.dataset.token;
  return out;
}

/** Envía un formulario con gestión de errores y estado del botón. */
export async function submitForm(form, fn) {
  const btn = form.querySelector('[type="submit"]');
  clearErrors(form);
  if (btn) { btn.disabled = true; btn.dataset.label ||= btn.innerHTML; btn.textContent = 'Enviando…'; }
  try { return await fn(); }
  catch (e) { showErrors(form, e.details, e.message); return null; }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }
}

// ───────────── Formato ─────────────
export const fmtNum = (n) => (n == null ? '—' : new Intl.NumberFormat('es-ES').format(n));
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtKg = (kg) => (kg == null ? '—' : kg >= 1000 ? `${fmtNum(+(kg / 1000).toFixed(1))} t` : `${fmtNum(kg)} kg`);

export const VERIFICATION = { verified: 'Verificada', pending: 'Verificación pendiente', unverified: 'No verificada' };
export const STATUS = { pending_review: 'Pendiente de revisión', approved: 'Publicada', rejected: 'Rechazada' };

export function flag(c) {
  const iso = c.country_iso || c.iso_code;
  const url = safeUrl(c.flag_url) || (c.flag_url?.startsWith('/') ? c.flag_url : null);
  const name = c.country_name || c.name;
  return url ? html`<img class="flag" src="${url}" alt="" title="${name}">` : html`<span class="flag-iso" title="${name}">${iso}</span>`;
}

export const catClass = (c) => {
  const slug = (c.categories?.[0]?.slug) || '';
  return ['cafe', 'chocolate', 'aceite'].includes(slug) ? `cat-${slug}` : '';
};

export function logo(c, size = '') {
  const initials = c.name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter((w) => w.length > 2 || /^\p{Lu}/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const url = c.logo_url?.startsWith('/uploads/') ? c.logo_url : null;
  return html`<div class="logo ${size} ${catClass(c)}" aria-hidden="true">${url ? html`<img src="${url}" alt="">` : initials}</div>`;
}

export function verificationBadge(status) {
  const ic = status === 'verified' ? icon('check') : status === 'pending' ? icon('clock') : '';
  return html`<span class="badge badge-${status}">${ic}${VERIFICATION[status]}</span>`;
}

export function statusBadge(status) {
  const cls = { approved: 'verified', pending_review: 'pending', rejected: 'rejected' }[status];
  return html`<span class="badge badge-${cls}">${STATUS[status]}</span>`;
}

// ───────────── Iconos (SVG en línea) ─────────────
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  heart: '<path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7L4 20z"/><path d="M9 9.5c.3 2 2.3 4.2 4.5 4.6l1-1.1 1.6.8c-.2 1-1 1.7-2 1.6-3-.3-5.9-3.2-6.1-6.1 0-1 .6-1.8 1.6-2l.8 1.6z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-3 3-3 15 0 18M12 3c3 3 3 15 0 18"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M4 20h16"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5v.01"/>',
  facebook: '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  quote: '<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  ship: '<path d="M3 17l2 4h14l2-4H3zM5 17V9h14v8M9 9V5h6v4"/>',
};
export function icon(name, cls = '') {
  return raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);
}

export function companyCard(c, { selectable = false, selected = false } = {}) {
  const fav = store.favorites.has(c.id);
  return html`<article class="card company-card ${selected ? 'selected' : ''}" data-id="${c.id}">
    ${selectable ? html`<label class="select-box" title="Seleccionar para exportar"><span class="sr-only">Seleccionar ${c.name}</span>
      <input type="checkbox" data-select="${c.id}" ${selected ? raw('checked') : ''}></label>` : ''}
    <div class="top">
      ${logo(c)}
      <div class="meta">
        <h3><a href="#/empresa/${c.slug}">${c.name}</a></h3>
        <div class="loc">${flag(c)} ${c.city}${c.region ? `, ${c.region}` : ''} · ${c.country_name}</div>
      </div>
    </div>
    <div class="tags">
      ${c.categories.map((k) => html`<span class="chip chip-cat cat-${k.slug}">${k.name}</span>`)}
      <span class="chip chip-outline">${c.company_type_name}</span>
    </div>
    ${c.excerpt ? html`<p class="excerpt">${c.excerpt}</p>` : ''}
    <div class="tags">
      ${verificationBadge(c.verification_status)}
      ${c.is_featured ? html`<span class="badge badge-featured">Destacada</span>` : ''}
      ${c.certifications.slice(0, 3).map((k) => html`<span class="badge">${k.name}</span>`)}
      ${c.certifications.length > 3 ? html`<span class="badge">+${c.certifications.length - 3}</span>` : ''}
      ${c.is_demo ? html`<span class="badge badge-demo" title="Datos ficticios de demostración">DEMO</span>` : ''}
    </div>
    <div class="foot">
      <a class="btn btn-primary btn-sm" href="#/empresa/${c.slug}">Ver ficha</a>
      <span class="spacer"></span>
      <button class="icon-btn ${fav ? 'is-fav' : ''}" data-fav="${c.id}" aria-pressed="${fav}" title="${fav ? 'Quitar de favoritos' : 'Guardar en favoritos'}">${icon('heart')}</button>
    </div>
  </article>`;
}

/** Delegación: botones de favorito dentro de `root`. */
export function bindFavButtons(root) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    e.preventDefault();
    try {
      const on = await toggleFavorite(b.dataset.fav);
      $$(`[data-fav="${b.dataset.fav}"]`).forEach((x) => { x.classList.toggle('is-fav', on); x.setAttribute('aria-pressed', on); });
    } catch (err) { toast(err.message, { error: true }); }
  });
}

export const loadingHtml = html`<div class="loading"><div class="spinner"></div>Cargando…</div>`;
export const setTitle = (t) => { document.title = t ? `${t} · GlobalTrade Connect` : 'GlobalTrade Connect · Proveedores B2B de café, chocolate y aceite'; };
