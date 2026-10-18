import { $, api, companyCard, flag, fmtNum, html, icon, setTitle, store } from '../lib.js';

export async function renderHome(main) {
  setTitle('');
  const home = await api('/api/home');
  const meta = store.meta;
  const priority = meta.countries.filter((c) => c.is_priority);
  const tops = meta.categories.filter((c) => !c.parent_id);
  const subsOf = (id) => meta.categories.filter((c) => c.parent_id === id);

  main.innerHTML = String(html`
  <section class="hero"><div class="wrap">
    <h1>Busca proveedores de café, chocolate o aceite por país o producto</h1>
    <p class="lead">Productores, exportadores, importadores y distribuidores verificados en Brasil, España, Argentina, Colombia, Bélgica y Suiza.</p>
    <form class="hero-search" id="hero-search" role="search">
      <label class="sr-only" for="hq">Producto o empresa</label>
      <input class="input" id="hq" name="q" placeholder="Ej.: café verde arábica, cobertura negra, AOVE ecológico…" autocomplete="off">
      <label class="sr-only" for="hc">País</label>
      <select class="input" id="hc" name="country">
        <option value="">Todos los países</option>
        ${meta.countries.filter((c) => c.company_count).map((c) => html`<option value="${c.iso_code}">${c.name}</option>`)}
      </select>
      <button class="btn btn-accent btn-lg" type="submit">${icon('search')} Buscar</button>
    </form>
    <div class="quick" aria-label="Búsquedas rápidas">
      <a href="#/buscar?category=cafe">☕ Café</a>
      <a href="#/buscar?category=chocolate">🍫 Chocolate</a>
      <a href="#/buscar?category=aceite">🫒 Aceite</a>
      <a href="#/buscar?type=exportador">Exportadores</a>
      <a href="#/buscar?type=importador">Importadores</a>
      <a href="#/buscar?type=distribuidor">Distribuidores</a>
    </div>
    <div class="hero-stats">
      <div><strong>${fmtNum(home.stats.companies)}</strong><span>empresas publicadas</span></div>
      <div><strong>${fmtNum(home.stats.verified)}</strong><span>verificadas</span></div>
      <div><strong>${fmtNum(home.stats.countries)}</strong><span>países</span></div>
    </div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="section-head"><div><h2>Explora por país</h2><p>Países prioritarios del directorio</p></div>
      <a href="#/buscar">Ver todos →</a></div>
    <div class="country-grid">
      ${priority.map((c) => html`<a class="country-card" href="#/buscar?country=${c.iso_code}">
        ${flag(c)}<strong>${c.name}</strong><span class="muted small">${c.company_count} empresas</span></a>`)}
    </div>
  </div></section>

  <section class="section" style="padding-top:0"><div class="wrap">
    <div class="section-head"><div><h2>Categorías</h2><p>Encuentra el subsector exacto que necesitas</p></div></div>
    <div class="cat-grid">
      ${tops.map((t) => html`<div class="cat-card cat-${t.slug}">
        <h3><a href="#/buscar?category=${t.slug}" style="color:inherit">${t.name}</a><span class="muted small">${t.company_count} empresas</span></h3>
        <div class="row">${subsOf(t.id).map((s) => html`<a class="chip chip-outline" href="#/buscar?category=${t.slug}&subcategory=${s.slug}">${s.name}</a>`)}</div>
      </div>`)}
    </div>
  </div></section>

  ${home.featured.length ? html`<section class="section" style="padding-top:0"><div class="wrap">
    <div class="section-head"><div><h2>Empresas destacadas</h2><p>Proveedores seleccionados por nuestro equipo</p></div>
      <a href="#/buscar?featured=1">Ver destacadas →</a></div>
    <div class="cards">${home.featured.map((c) => companyCard(c))}</div>
  </div></section>` : ''}

  <section class="section" style="padding-top:0"><div class="wrap">
    <div class="section-head"><div><h2>Últimas empresas añadidas</h2><p>Nuevas incorporaciones al directorio</p></div>
      <a href="#/buscar?sort=newest">Ver novedades →</a></div>
    <div class="cards">${home.latest.map((c) => companyCard(c))}</div>
  </div></section>

  <section class="section" style="padding-top:0"><div class="wrap cta-band">
    <div class="cta"><h2>Registra tu empresa</h2>
      <p>Llega a compradores profesionales de todo el mundo. El alta es gratuita y nuestro equipo revisa cada ficha antes de publicarla.</p>
      <a class="btn btn-accent" href="#/registrar">Dar de alta mi empresa</a></div>
    <div class="cta alt"><h2>Solicita proveedores</h2>
      <p>¿No encuentras lo que buscas? Cuéntanos qué producto, volumen y certificaciones necesitas y te ponemos en contacto con proveedores.</p>
      <a class="btn btn-outline" href="#/solicitar-proveedores">Enviar solicitud</a></div>
  </div></section>`);

  $('#hero-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    const q = e.target.q.value.trim();
    if (q) p.set('q', q);
    if (e.target.country.value) p.set('country', e.target.country.value);
    location.hash = `#/buscar?${p}`;
  });
}
