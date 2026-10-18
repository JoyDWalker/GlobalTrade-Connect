import { $, api, bindFavButtons, html, icon, loadMeta, loadSession, loadingHtml, store, toast } from './lib.js';
import { renderHome } from './views/home.js';
import { renderSearch } from './views/search.js';
import { renderCompany } from './views/company.js';
import { renderRegister } from './views/register.js';
import { renderSupplierRequest, renderPrivacy, renderFavorites } from './views/pages.js';
import { renderLogin, renderAccount } from './views/account.js';
import { renderAdmin } from './views/admin.js';

// Rutas hash: #/ruta?param=valor
const ROUTES = [
  [/^\/?$/, renderHome],
  [/^\/buscar$/, renderSearch],
  [/^\/empresa\/([^/]+)$/, renderCompany],
  [/^\/registrar$/, renderRegister],
  [/^\/solicitar-proveedores$/, renderSupplierRequest],
  [/^\/favoritos$/, renderFavorites],
  [/^\/privacidad$/, renderPrivacy],
  [/^\/login$/, renderLogin],
  [/^\/cuenta$/, renderAccount],
  [/^\/admin(?:\/([\w-]+))?(?:\/([\w-]+))?$/, renderAdmin],
];

export function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path, query: new URLSearchParams(qs) };
}

let renderSeq = 0;
async function route() {
  const { path, query } = parseHash();
  const main = $('#main');
  const seq = ++renderSeq;
  renderHeader();
  for (const [re, view] of ROUTES) {
    const m = re.exec(path);
    if (!m) continue;
    // Cada vista recibe un contenedor nuevo: sus listeners desaparecen con él al cambiar de ruta
    const root = document.createElement('div');
    root.innerHTML = String(loadingHtml);
    main.replaceChildren(root);
    try {
      await view(root, { params: m.slice(1).map((p) => p && decodeURIComponent(p)), query, isCurrent: () => seq === renderSeq });
    } catch (e) {
      if (seq !== renderSeq) return;
      if (e.status === 401) { location.hash = `#/login?next=${encodeURIComponent(location.hash.slice(1))}`; return; }
      main.innerHTML = String(html`<div class="wrap empty"><h2>${e.status === 404 ? 'Página no encontrada' : 'Algo ha fallado'}</h2>
        <p>${e.message}</p><a class="btn btn-primary" href="#/">Volver al inicio</a></div>`);
    }
    if (!query.has('keepScroll')) window.scrollTo(0, 0);
    return;
  }
  main.innerHTML = String(html`<div class="wrap empty"><h2>Página no encontrada</h2><a class="btn btn-primary" href="#/">Volver al inicio</a></div>`);
}

function renderHeader() {
  const { path } = parseHash();
  const u = store.user;
  const active = (p) => (path.startsWith(p) ? 'active' : '');
  $('#site-header').innerHTML = String(html`<div class="wrap">
    <a class="brand" href="#/"><img src="/img/favicon.svg" alt=""><span>GlobalTrade Connect<small>Directorio B2B gourmet</small></span></a>
    <button class="menu-toggle" aria-label="Abrir menú" aria-expanded="false" data-menu>${icon('menu')}</button>
    <nav class="main-nav" id="main-nav">
      <a class="${active('/buscar')}" href="#/buscar">Buscar empresas</a>
      <a class="${active('/solicitar-proveedores')}" href="#/solicitar-proveedores">Solicitar proveedores</a>
      <a class="${active('/registrar')}" href="#/registrar">Registra tu empresa</a>
      <div class="nav-right">
        <a class="${active('/favoritos')}" href="#/favoritos">Favoritos${store.favorites.size ? html`<span class="fav-count">${store.favorites.size}</span>` : ''}</a>
        ${u ? html`<div class="user-menu" id="user-menu">
            <button class="navlink" data-user-menu aria-haspopup="true">${icon('user', 'sr-only')}${u.name.split(' ')[0]} ▾</button>
            <div class="dropdown">
              ${u.role === 'admin' ? html`<a href="#/admin">Panel de administración</a>` : ''}
              <a href="#/cuenta">Mi cuenta</a>
              <a href="#/favoritos">Mis favoritos</a>
              <button data-logout>Cerrar sesión</button>
            </div></div>`
          : html`<a class="${active('/login')}" href="#/login">Acceder</a>`}
      </div>
    </nav></div>`);
}

function renderFooter() {
  $('#site-footer').innerHTML = String(html`<div class="wrap">
    <div class="footer-grid">
      <div><h4>GlobalTrade Connect</h4><p>Directorio B2B para encontrar productores, exportadores, importadores y distribuidores de café, chocolate y aceite.</p></div>
      <div><h4>Directorio</h4><ul>
        <li><a href="#/buscar?category=cafe">Café</a></li><li><a href="#/buscar?category=chocolate">Chocolate</a></li><li><a href="#/buscar?category=aceite">Aceite</a></li></ul></div>
      <div><h4>Empresas</h4><ul>
        <li><a href="#/registrar">Registra tu empresa</a></li><li><a href="#/solicitar-proveedores">Solicita proveedores</a></li><li><a href="#/login">Acceso empresas</a></li></ul></div>
      <div><h4>Legal</h4><ul>
        <li><a href="#/privacidad">Política de privacidad</a></li><li><a href="#/privacidad?form=1">Ejercer derechos RGPD</a></li></ul></div>
    </div>
    <div class="footer-bottom">© ${new Date().getFullYear()} GlobalTrade Connect · Proyecto de demostración. Los datos de empresas son ficticios.</div></div>`);
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-menu]')) {
    const nav = $('#main-nav');
    nav.classList.toggle('open');
    e.target.closest('[data-menu]').setAttribute('aria-expanded', nav.classList.contains('open'));
    return;
  }
  if (e.target.closest('[data-user-menu]')) { $('#user-menu').classList.toggle('open'); return; }
  if (e.target.closest('[data-logout]')) {
    await api('/api/auth/logout', { method: 'POST' });
    store.user = null; store.favorites = new Set();
    toast('Sesión cerrada');
    location.hash = '#/';
    store.emit();
    return;
  }
  if (!e.target.closest('#user-menu')) $('#user-menu')?.classList.remove('open');
  if (e.target.closest('#main-nav a')) $('#main-nav')?.classList.remove('open');
});

store.listeners.add(renderHeader);
window.addEventListener('hashchange', route);
bindFavButtons($('#main'));

(async () => {
  renderFooter();
  try { await Promise.all([loadSession(), loadMeta()]); }
  catch { toast('No se pudo conectar con el servidor', { error: true }); }
  route();
})();
