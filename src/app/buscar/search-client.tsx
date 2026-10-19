'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { Meta } from '@/lib/meta';
import type { CompanyCard as Card } from '@/lib/services/companies';
import { Icon } from '@/components/icons';
import { apiFetch, download, useSelection, useToast } from '@/components/client';
import { CompanyCard } from '@/components/ui';

const LIST_KEYS = ['country', 'type', 'cert', 'lang', 'client', 'verification', 'source'];

function useParamsState() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const get = (k: string) => sp.get(k) ?? '';
  const list = (k: string) => get(k).split(',').filter(Boolean);
  const push = (patch: Record<string, string | string[] | null>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      const val = Array.isArray(v) ? v.join(',') : v;
      if (!val) u.delete(k); else u.set(k, val);
    }
    u.delete('page');
    router.push(`${path}?${u}`, { scroll: false });
  };
  return { sp, get, list, push };
}

export function SearchBar({ initialQ, sort }: { initialQ: string; sort: string }) {
  const { push } = useParamsState();
  const [q, setQ] = useState(initialQ);
  useEffect(() => setQ(initialQ), [initialQ]);
  return (
    <form className="results-bar" role="search" onSubmit={(e) => { e.preventDefault(); push({ q: q.trim() }); }}>
      <div className="search-input"><Icon name="search" /><label className="sr-only" htmlFor="sq">Buscar</label>
        <input className="input" id="sq" type="search" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Producto, servicio, sector, empresa o necesidad…" /></div>
      <button className="btn btn-primary" type="submit">Buscar</button>
      <button type="button" className="btn btn-outline filter-toggle" onClick={() => document.getElementById('filters')?.classList.add('open')}><Icon name="filter" /> Filtros</button>
      <label className="sr-only" htmlFor="sort">Ordenar</label>
      <select className="input" id="sort" value={sort} onChange={(e) => push({ sort: e.target.value === 'relevance' ? null : e.target.value })}>
        <option value="relevance">Relevancia</option><option value="verified">Verificadas primero</option><option value="name">Nombre (A-Z)</option>
        <option value="country">País</option><option value="newest">Más recientes</option>
      </select>
    </form>
  );
}

export function Filters({ meta }: { meta: Meta }) {
  const { get, list, push } = useParamsState();
  const [countryInput, setCountryInput] = useState('');
  const byIso = useMemo(() => new Map(meta.countries.map((c) => [c.iso_code, c])), [meta]);
  const byName = useMemo(() => new Map(meta.countries.map((c) => [c.name.toLowerCase(), c.iso_code])), [meta]);
  const roots = meta.categories.filter((c) => !c.parent_id);
  const children = (id: number) => meta.categories.filter((c) => c.parent_id === id);
  const toggle = (k: string, v: string, on: boolean) => { const s = new Set(list(k)); if (on) s.add(v); else s.delete(v); push({ [k]: [...s] }); };
  const checks = (k: string, options: { value: string; label: string }[]) => options.map((o) => (
    <label key={o.value} className="check"><input type="checkbox" checked={list(k).includes(o.value)} onChange={(e) => toggle(k, o.value, e.target.checked)} /><span>{o.label}</span></label>));
  const n = (k: string) => list(k).length;
  const active = [...LIST_KEYS.map(n), get('category') ? 1 : 0, get('city') ? 1 : 0, get('region') ? 1 : 0, get('minCapacity') ? 1 : 0, get('maxMinOrder') ? 1 : 0].reduce((a, b) => a + b, 0);

  const catOptions: React.ReactNode[] = [];
  for (const r of roots) {
    catOptions.push(<option key={r.id} value={r.slug}>{r.name} ({r.company_count})</option>);
    for (const c of children(r.id)) {
      catOptions.push(<option key={c.id} value={c.slug}>   {c.name} ({c.company_count})</option>);
      for (const g of children(c.id)) catOptions.push(<option key={g.id} value={g.slug}>      {g.name} ({g.company_count})</option>);
    }
  }
  const close = () => document.getElementById('filters')?.classList.remove('open');
  const addCountry = () => {
    const v = countryInput.trim();
    const iso = byName.get(v.toLowerCase()) ?? (byIso.has(v.toUpperCase()) ? v.toUpperCase() : null);
    if (iso) { toggle('country', iso, true); setCountryInput(''); }
  };

  return (
    <aside className="filters" id="filters" aria-label="Filtros">
      <div className="filters-head"><h2>Filtros{active ? ` (${active})` : ''}</h2>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => push(Object.fromEntries([...LIST_KEYS, 'category', 'city', 'region', 'minCapacity', 'maxMinOrder', 'featured', 'detected'].map((k) => [k, null])))}>Limpiar</button>
          <button className="icon-btn filter-toggle" onClick={close} aria-label="Cerrar filtros"><Icon name="x" /></button>
        </div>
      </div>
      <div className="filters-body">
        <details className="filter-group" open><summary>Sector / categoría</summary><div className="body">
          <label className="sr-only" htmlFor="f-cat">Sector</label>
          <select id="f-cat" className="input" value={get('category')} onChange={(e) => push({ category: e.target.value })}>
            <option value="">Todos los sectores</option>{catOptions}
          </select>
        </div></details>
        <details className="filter-group" open><summary>País{n('country') ? ` (${n('country')})` : ''}</summary><div className="body">
          <div className="row" style={{ gap: 6 }}>
            {list('country').map((iso) => <span key={iso} className="chip">{byIso.get(iso)?.name ?? iso}<button aria-label="Quitar" onClick={() => toggle('country', iso, false)}><Icon name="x" /></button></span>)}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <input className="input" list="country-list" value={countryInput} onChange={(e) => setCountryInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCountry(); } }} placeholder="Añadir país…" aria-label="Añadir país" />
            <button className="btn btn-outline btn-sm" onClick={addCountry}>Añadir</button>
          </div>
          <datalist id="country-list">{meta.countries.map((c) => <option key={c.iso_code} value={c.name} />)}</datalist>
          {meta.countries.filter((c) => c.is_priority || c.company_count > 0).slice(0, 8).map((c) => (
            <label key={c.iso_code} className="check"><input type="checkbox" checked={list('country').includes(c.iso_code)} onChange={(e) => toggle('country', c.iso_code, e.target.checked)} /><span>{c.name} <span className="count">{c.company_count}</span></span></label>))}
        </div></details>
        <details className="filter-group" open={Boolean(get('region') || get('city'))}><summary>Región y ciudad</summary><div className="body">
          <input className="input" defaultValue={get('region')} placeholder="Región / provincia" aria-label="Región" onBlur={(e) => e.target.value !== get('region') && push({ region: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && push({ region: (e.target as HTMLInputElement).value.trim() })} />
          <input className="input" defaultValue={get('city')} placeholder="Ciudad" aria-label="Ciudad" onBlur={(e) => e.target.value !== get('city') && push({ city: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && push({ city: (e.target as HTMLInputElement).value.trim() })} />
        </div></details>
        <details className="filter-group" open={n('type') > 0}><summary>Tipo de empresa{n('type') ? ` (${n('type')})` : ''}</summary><div className="body">{checks('type', meta.business_types.map((b) => ({ value: b.slug, label: b.name })))}</div></details>
        <details className="filter-group" open={n('verification') > 0}><summary>Verificación</summary><div className="body">
          {checks('verification', [{ value: 'verified', label: 'Verificada' }, { value: 'contrasted', label: 'Información contrastada' }, { value: 'none', label: 'Sin verificar' }])}
          <label className="check"><input type="checkbox" checked={get('detected') !== '0'} onChange={(e) => push({ detected: e.target.checked ? null : '0' })} /><span>Incluir empresas detectadas sin revisar</span></label>
        </div></details>
        <details className="filter-group" open={n('cert') > 0}><summary>Certificaciones{n('cert') ? ` (${n('cert')})` : ''}</summary><div className="body">{checks('cert', meta.certifications.map((c) => ({ value: c.slug, label: c.name })))}</div></details>
        <details className="filter-group" open={n('lang') > 0}><summary>Idiomas de atención</summary><div className="body">{checks('lang', meta.languages.map((l) => ({ value: l.code, label: l.name })))}</div></details>
        <details className="filter-group" open={n('client') > 0}><summary>Tipo de cliente</summary><div className="body">{checks('client', meta.client_types.map((c) => ({ value: c.slug, label: c.name })))}</div></details>
        <details className="filter-group" open={Boolean(get('minCapacity') || get('maxMinOrder'))}><summary>Capacidad y pedido mínimo</summary><div className="body">
          <label className="small" htmlFor="f-cap">Capacidad de exportación mínima (t/año)</label>
          <input id="f-cap" className="input" type="number" min={0} defaultValue={get('minCapacity')} onBlur={(e) => e.target.value !== get('minCapacity') && push({ minCapacity: e.target.value })} />
          <label className="small" htmlFor="f-mo">Pedido mínimo de hasta (kg)</label>
          <input id="f-mo" className="input" type="number" min={0} defaultValue={get('maxMinOrder')} onBlur={(e) => e.target.value !== get('maxMinOrder') && push({ maxMinOrder: e.target.value })} />
        </div></details>
        <details className="filter-group" open={n('source') > 0}><summary>Fuente de información</summary><div className="body">{checks('source', meta.sources.map((s) => ({ value: s.key, label: s.name })))}</div></details>
      </div>
      <div className="filters-foot"><button className="btn btn-primary" onClick={close}>Ver resultados</button></div>
    </aside>
  );
}

export function ExportBar({ total, exportQuery, pageIds }: { total: number; exportQuery: string; pageIds: string[] }) {
  const sel = useSelection()!;
  const toast = useToast();
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => sel.selected.has(id));
  const exportSel = async (format: string) => { try { await download('/api/companies', { ids: [...sel.selected], format }); } catch (e) { toast((e as Error).message, { error: true }); } };
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="result-count" aria-live="polite">{total.toLocaleString('es-ES')} empresa{total === 1 ? '' : 's'}</span>
        <span className="spacer" />
        {total > 0 && <>
          <label className="check small"><input type="checkbox" checked={allOnPage} onChange={(e) => sel.setMany(pageIds, e.target.checked)} /> Seleccionar página</label>
          <a className="btn btn-outline btn-sm" href={`/api/companies?${exportQuery}&format=csv`} download><Icon name="download" /> CSV</a>
          <a className="btn btn-outline btn-sm" href={`/api/companies?${exportQuery}&format=xlsx`} download>Excel</a>
        </>}
      </div>
      {sel.selected.size > 0 && (
        <div className="selection-bar">
          <strong>{sel.selected.size} seleccionada{sel.selected.size > 1 ? 's' : ''}</strong>
          <button className="btn btn-primary btn-sm" onClick={() => exportSel('csv')}><Icon name="download" /> Exportar CSV</button>
          <button className="btn btn-outline btn-sm" onClick={() => exportSel('xlsx')}>Excel</button>
          <button className="btn btn-ghost btn-sm" onClick={sel.clear}>Quitar selección</button>
        </div>
      )}
    </>
  );
}

interface External { status: string; reason?: string; newCompanies: number; items: Card[]; expansion?: { origin: 'ai' | 'catalog'; sector: string | null; relatedTerms: string[]; queries: string[] } | null; sources: { key: string; name: string; status: string; results: number; message?: string }[] }
const SOURCE_STATUS: Record<string, string> = { ok: 'consultada', cached: 'desde caché', error: 'error', timeout: 'sin respuesta', quota_exceeded: 'cuota agotada', rate_limited: 'límite de peticiones', disabled: 'desactivada', not_configured: 'sin configurar', budget_exceeded: 'presupuesto agotado' };

/** Para administradores: buscar en Internet aunque ya haya bastantes empresas guardadas. */
export function ExternalOnDemand(props: { q: string; country: string | null; searchId: number | null }) {
  const [on, setOn] = useState(false);
  if (on) return <ExternalResults {...props} />;
  return (
    <div className="card card-pad ext-panel row" style={{ marginTop: 16 }}>
      <span className="small muted" style={{ flex: 1, minWidth: 200 }}>¿Quieres más empresas? Busca «{props.q}» en Internet (consume de tu presupuesto de APIs).</span>
      <button className="btn btn-primary btn-sm" onClick={() => setOn(true)}><Icon name="search" /> Buscar más en Internet</button>
    </div>
  );
}

/** Búsqueda en fuentes externas en segundo plano: no bloquea los resultados ya mostrados. */
export function ExternalResults({ q, country, searchId }: { q: string; country: string | null; searchId: number | null }) {
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [data, setData] = useState<External | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setState('loading');
    apiFetch<External>('/api/search/external', { body: { q, country, searchId } })
      .then((r) => { if (alive) { setData(r); setState('done'); } })
      .catch((e) => { if (alive) { setErr(e.message); setState('error'); } });
    return () => { alive = false; };
  }, [q, country, searchId]);
  return (
    <section className="ext-panel card card-pad" aria-live="polite">
      <h2 style={{ fontSize: '1.05rem' }}>Resultados de fuentes externas</h2>
      {state === 'loading' && <p className="muted"><span className="spinner" style={{ display: 'inline-block', width: 16, height: 16, verticalAlign: -3, marginRight: 8 }} />Consultando fuentes externas autorizadas… Los resultados guardados ya se muestran arriba.</p>}
      {state === 'error' && <p className="muted">No se pudieron consultar las fuentes externas ({err}). Los datos almacenados siguen disponibles.</p>}
      {state === 'done' && data && <>
        <div className="ext-status">{data.sources.map((s) => (
          <span key={s.key} className="badge" title={s.message}><span className={`status-dot ${s.status === 'ok' || s.status === 'cached' ? 'ok' : ['disabled', 'not_configured'].includes(s.status) ? '' : 'err'}`} />{s.name}: {SOURCE_STATUS[s.status] ?? s.status}{s.results ? ` · ${s.results}` : ''}</span>))}</div>
        {data.expansion && <div className="notice small expansion" style={{ marginBottom: 12 }}>
          <div><strong>Búsqueda ampliada{data.expansion.origin === 'ai' ? ' con IA' : ''}</strong>{data.expansion.sector ? <> · Sector: {data.expansion.sector}</> : null}</div>
          {data.expansion.relatedTerms.length > 0 && <div className="tags" style={{ marginTop: 6 }}>{data.expansion.relatedTerms.map((t) => <span key={t} className="chip chip-outline">{t}</span>)}</div>}
          <details style={{ marginTop: 6 }}><summary>Consultas enviadas a los buscadores ({data.expansion.queries.length})</summary><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{data.expansion.queries.map((x) => <li key={x}>{x}</li>)}</ul></details>
        </div>}
        {data.reason && <p className="muted small">{data.reason}</p>}
        {data.items.length > 0 && <>
          <div className="notice notice-info small" style={{ marginBottom: 12 }}>Estas empresas se han <strong>detectado automáticamente</strong> a partir de resultados públicos. Sus datos no están revisados: comprueba la información antes de hacer negocios.</div>
          <div className="cards">{data.items.map((c) => <CompanyCard key={c.id} c={c} />)}</div>
        </>}
        {data.items.length === 0 && !data.reason && <p className="muted small">Las fuentes externas no han devuelto empresas nuevas para esta búsqueda.</p>}
      </>}
    </section>
  );
}
