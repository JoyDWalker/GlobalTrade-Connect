import { $, $$, api, companyCard, downloadPost, flag, fmtNum, html, icon, raw, setTitle, store, toast } from '../lib.js';

const MULTI = ['subcategory', 'country', 'type', 'cert', 'lang', 'client', 'verification'];
const SINGLE = ['q', 'category', 'region', 'city', 'minCapacity', 'maxMinOrder', 'sort', 'page', 'featured'];
const VER_OPTS = [['verified', 'Verificada'], ['pending', 'Pendiente'], ['unverified', 'No verificada']];
const SORTS = [['relevance', 'Relevancia'], ['verified', 'Verificadas primero'], ['name', 'Nombre (A-Z)'], ['country', 'País'], ['newest', 'Fecha de alta (recientes)']];

const selection = new Set();     // empresas marcadas para exportar (se mantiene entre páginas)
const openGroups = new Set(['category', 'country']);

function stateFrom(query) {
  const s = {};
  for (const k of SINGLE) s[k] = query.get(k) || '';
  for (const k of MULTI) s[k] = (query.get(k) || '').split(',').filter(Boolean);
  return s;
}
function toParams(s) {
  const p = new URLSearchParams();
  for (const k of SINGLE) if (s[k] && !(k === 'page' && s[k] === '1') && !(k === 'sort' && s[k] === 'relevance')) p.set(k, s[k]);
  for (const k of MULTI) if (s[k].length) p.set(k, s[k].join(','));
  return p;
}

export async function renderSearch(main, { query, isCurrent }) {
  setTitle('Buscar empresas');
  const meta = store.meta;
  const s = stateFrom(query);
  const by = (list, key) => Object.fromEntries(list.map((x) => [x[key], x]));
  const cats = by(meta.categories, 'slug');
  const countries = by(meta.countries, 'iso_code');
  let last = null;

  main.innerHTML = String(html`<div class="wrap search-layout">
    <aside class="filters" id="filters" aria-label="Filtros"></aside>
    <section>
      <div class="results-bar">
        <div class="search-input">${icon('search')}<label class="sr-only" for="sq">Buscar</label>
          <input class="input" id="sq" type="search" placeholder="Producto, empresa, ciudad, certificación…" value="${s.q}"></div>
        <button class="btn btn-outline filter-toggle" id="open-filters">${icon('filter')} Filtros <span id="filter-n"></span></button>
        <label class="sr-only" for="sort">Ordenar por</label>
        <select class="input" id="sort">${SORTS.map(([v, l]) => html`<option value="${v}" ${(s.sort || 'relevance') === v ? raw('selected') : ''}>${l}</option>`)}</select>
      </div>
      <div class="active-filters" id="active"></div>
      <div id="selection"></div>
      <div id="results">${raw('<div class="loading"><div class="spinner"></div></div>')}</div>
    </section></div>`);

  const update = (patch, { resetPage = true } = {}) => {
    Object.assign(s, patch);
    if (resetPage) s.page = '';
    history.replaceState(null, '', `#/buscar?${toParams(s)}`);
    renderFilters();
    load();
  };

  // ───────── Filtros ─────────
  function group(key, title, body, n = 0) {
    return html`<details class="filter-group" data-group="${key}" ${openGroups.has(key) || n ? raw('open') : ''}>
      <summary>${title}${n ? html` <span class="chip" style="padding:0 8px;margin-left:6px">${n}</span>` : ''}</summary><div class="body">${body}</div></details>`;
  }
  const checks = (key, options) => options.map(([value, label, extra]) => html`<label class="check">
    <input type="checkbox" data-key="${key}" value="${value}" ${s[key].includes(String(value)) ? raw('checked') : ''}>
    ${extra || ''}<span>${label}</span></label>`);

  function renderFilters() {
    const tops = meta.categories.filter((c) => !c.parent_id);
    const top = cats[s.category];
    const subs = meta.categories.filter((c) => c.parent_id && (!top || c.parent_id === top.id));
    const prioCountries = meta.countries.filter((c) => c.company_count > 0);
    const regions = [...new Set(meta.locations.filter((l) => !s.country.length || s.country.includes(l.country)).map((l) => l.region).filter(Boolean))].sort();
    const cities = [...new Set(meta.locations.filter((l) => (!s.country.length || s.country.includes(l.country)) && (!s.region || l.region === s.region)).map((l) => l.city))].sort();

    $('#filters', main).innerHTML = String(html`
      <div class="filters-head"><h2>Filtros</h2>
        <div class="row" style="gap:4px"><button class="btn btn-ghost btn-sm" data-clear>Limpiar</button>
        <button class="icon-btn filter-toggle" data-close-filters aria-label="Cerrar filtros">${icon('x')}</button></div></div>
      <div class="filters-body">
      ${group('category', 'Producto / categoría', html`<div class="seg">
          <button data-cat="" class="${!s.category ? 'on' : ''}">Todas</button>
          ${tops.map((t) => html`<button data-cat="${t.slug}" class="${s.category === t.slug ? 'on' : ''}">${t.name}</button>`)}</div>`, s.category ? 1 : 0)}
      ${group('subcategory', 'Subcategoría', checks('subcategory', subs.map((c) => [c.slug, c.name, null]))
        , s.subcategory.length)}
      ${group('country', 'País', checks('country', prioCountries.map((c) => [c.iso_code, html`${c.name} <span class="count">${c.company_count}</span>`, flag(c)])), s.country.length)}
      ${group('location', 'Región y ciudad', html`
        <label class="sr-only" for="f-region">Región</label>
        <select class="input" id="f-region" data-single="region"><option value="">Todas las regiones</option>
          ${regions.map((r) => html`<option ${s.region === r ? raw('selected') : ''}>${r}</option>`)}</select>
        <label class="sr-only" for="f-city">Ciudad</label>
        <input class="input" id="f-city" data-single="city" list="city-list" placeholder="Ciudad" value="${s.city}">
        <datalist id="city-list">${cities.map((c) => html`<option value="${c}">`)}</datalist>`, (s.region ? 1 : 0) + (s.city ? 1 : 0))}
      ${group('type', 'Tipo de empresa', checks('type', meta.business_types.map((b) => [b.slug, b.name])), s.type.length)}
      ${group('cert', 'Certificaciones', checks('cert', meta.certifications.map((c) => [c.slug, c.name])), s.cert.length)}
      ${group('lang', 'Idiomas de atención', checks('lang', meta.languages.map((l) => [l.code, l.name])), s.lang.length)}
      ${group('capacity', 'Capacidad y pedido mínimo', html`
        <div class="field"><label for="f-cap">Capacidad de exportación mínima (t/año)</label>
          <input class="input" id="f-cap" type="number" min="0" step="10" data-single="minCapacity" value="${s.minCapacity}" placeholder="Ej.: 500"></div>
        <div class="field"><label for="f-mo">Pedido mínimo de hasta (kg)</label>
          <input class="input" id="f-mo" type="number" min="0" step="10" data-single="maxMinOrder" value="${s.maxMinOrder}" placeholder="Ej.: 1000">
          <span class="hint">Muestra empresas cuyo pedido mínimo no supera esta cantidad.</span></div>`, (s.minCapacity ? 1 : 0) + (s.maxMinOrder ? 1 : 0))}
      ${group('client', 'Tipo de cliente atendido', checks('client', meta.client_types.map((c) => [c.slug, c.name])), s.client.length)}
      ${group('verification', 'Estado de verificación', checks('verification', VER_OPTS), s.verification.length)}
      </div>
      <div class="filters-foot"><button class="btn btn-outline" data-clear>Limpiar</button><button class="btn btn-primary" data-close-filters>Ver resultados</button></div>`);
  }

  // ───────── Resultados ─────────
  function activeChips() {
    const chips = [];
    const label = {
      category: (v) => cats[v]?.name, subcategory: (v) => cats[v]?.name, country: (v) => countries[v]?.name,
      type: (v) => meta.business_types.find((b) => b.slug === v)?.name, cert: (v) => meta.certifications.find((c) => c.slug === v)?.name,
      lang: (v) => meta.languages.find((l) => l.code === v)?.name, client: (v) => meta.client_types.find((c) => c.slug === v)?.name,
      verification: (v) => VER_OPTS.find(([k]) => k === v)?.[1], region: (v) => v, city: (v) => `Ciudad: ${v}`, q: (v) => `“${v}”`,
      minCapacity: (v) => `≥ ${fmtNum(v)} t/año`, maxMinOrder: (v) => `Pedido mín. ≤ ${fmtNum(v)} kg`, featured: () => 'Destacadas',
    };
    for (const k of [...SINGLE, ...MULTI]) {
      if (k === 'sort' || k === 'page') continue;
      for (const v of MULTI.includes(k) ? s[k] : s[k] ? [s[k]] : []) chips.push(html`<span class="chip">${label[k]?.(v) || v}
        <button data-remove="${k}" data-value="${v}" aria-label="Quitar filtro">${icon('x')}</button></span>`);
    }
    return chips;
  }

  function renderSelection() {
    $('#selection', main).innerHTML = selection.size ? String(html`<div class="selection-bar">
      <strong>${selection.size} seleccionada${selection.size > 1 ? 's' : ''}</strong>
      <button class="btn btn-primary btn-sm" data-export-sel="csv">${icon('download')} Exportar CSV</button>
      <button class="btn btn-outline btn-sm" data-export-sel="xlsx">Excel</button>
      <button class="btn btn-ghost btn-sm" data-sel-none>Quitar selección</button></div>`) : '';
  }

  async function load() {
    const n = activeChips().length;
    $('#filter-n', main).textContent = n ? `(${n})` : '';
    const chips = activeChips();
    $('#active', main).innerHTML = String(html`${chips}${chips.length ? html`<button class="btn btn-ghost btn-sm" data-clear>Limpiar todo</button>` : ''}`);
    renderSelection();
    const params = toParams(s);
    const res = await api(`/api/companies?${params}`);
    if (!isCurrent()) return;
    last = res;
    const pageIds = res.items.map((c) => c.id);
    const allSel = pageIds.length && pageIds.every((id) => selection.has(id));
    $('#results', main).innerHTML = String(html`
      <div class="row" style="margin-bottom:12px">
        <span class="result-count" aria-live="polite">${fmtNum(res.total)} empresa${res.total === 1 ? '' : 's'} encontrada${res.total === 1 ? '' : 's'}</span>
        <span class="spacer"></span>
        ${res.total ? html`<label class="check small"><input type="checkbox" data-sel-page ${allSel ? raw('checked') : ''}> Seleccionar página</label>
          <a class="btn btn-outline btn-sm" href="/api/companies?${params}&format=csv" download>${icon('download')} Exportar todo (CSV)</a>` : ''}
      </div>
      ${res.items.length ? html`<div class="cards">${res.items.map((c) => companyCard(c, { selectable: true, selected: selection.has(c.id) }))}</div>`
        : html`<div class="card empty">${icon('search')}<h3>Sin resultados</h3><p>Prueba a quitar algún filtro o a buscar un término más general.</p>
            <a class="btn btn-primary" href="#/solicitar-proveedores">Solicitar proveedores a nuestro equipo</a></div>`}
      ${pagination(res)}`);
  }

  function pagination({ page, pages }) {
    if (pages <= 1) return '';
    const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
    const out = [];
    nums.forEach((p, i) => { if (i && p - nums[i - 1] > 1) out.push(html`<button disabled>…</button>`); out.push(html`<button data-page="${p}" class="${p === page ? 'on' : ''}" aria-current="${p === page ? 'page' : 'false'}">${p}</button>`); });
    return html`<nav class="pagination" aria-label="Paginación">
      <button data-page="${page - 1}" ${page <= 1 ? raw('disabled') : ''}>‹ Anterior</button>${out}
      <button data-page="${page + 1}" ${page >= pages ? raw('disabled') : ''}>Siguiente ›</button></nav>`;
  }

  // ───────── Eventos ─────────
  let t;
  $('#sq', main).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => update({ q: e.target.value.trim() }), 300); });
  $('#sort', main).addEventListener('change', (e) => update({ sort: e.target.value }));
  $('#open-filters', main).addEventListener('click', () => $('#filters', main).classList.add('open'));

  main.addEventListener('toggle', (e) => {
    const g = e.target.closest?.('[data-group]');
    if (g) g.open ? openGroups.add(g.dataset.group) : openGroups.delete(g.dataset.group);
  }, true);

  main.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.key) {
      const k = el.dataset.key;
      const set = new Set(s[k]);
      el.checked ? set.add(el.value) : set.delete(el.value);
      const patch = { [k]: [...set] };
      if (k === 'country') patch.region = '';
      update(patch);
    } else if (el.dataset.single) {
      update({ [el.dataset.single]: el.value.trim() });
    } else if (el.dataset.select) {
      const id = Number(el.dataset.select);
      el.checked ? selection.add(id) : selection.delete(id);
      el.closest('.company-card').classList.toggle('selected', el.checked);
      renderSelection();
    } else if (el.matches('[data-sel-page]')) {
      for (const c of last.items) el.checked ? selection.add(c.id) : selection.delete(c.id);
      $$('[data-select]', main).forEach((x) => { x.checked = el.checked; x.closest('.company-card').classList.toggle('selected', el.checked); });
      renderSelection();
    }
  });

  main.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cat !== undefined) {
      const top = cats[b.dataset.cat];
      update({ category: b.dataset.cat, subcategory: s.subcategory.filter((x) => !top || cats[x]?.parent_id === top.id) });
    } else if (b.dataset.remove) {
      const k = b.dataset.remove;
      update({ [k]: MULTI.includes(k) ? s[k].filter((v) => v !== b.dataset.value) : '' });
      if (k === 'q') $('#sq', main).value = '';
    } else if (b.matches('[data-clear]')) {
      for (const k of SINGLE) if (k !== 'sort') s[k] = '';
      for (const k of MULTI) s[k] = [];
      $('#sq', main).value = '';
      update({});
    } else if (b.matches('[data-close-filters]')) {
      $('#filters', main).classList.remove('open');
    } else if (b.dataset.page) {
      update({ page: b.dataset.page }, { resetPage: false });
      main.scrollIntoView({ behavior: 'smooth' });
    } else if (b.dataset.exportSel) {
      try { await downloadPost('/api/companies/export', { ids: [...selection], format: b.dataset.exportSel }); }
      catch (err) { toast(err.message, { error: true }); }
    } else if (b.matches('[data-sel-none]')) {
      selection.clear();
      $$('[data-select]', main).forEach((x) => { x.checked = false; x.closest('.company-card').classList.remove('selected'); });
      const pageBox = $('[data-sel-page]', main); if (pageBox) pageBox.checked = false;
      renderSelection();
    }
  });

  renderFilters();
  await load();
}
