'use client';
// Seguimiento comercial: empresas a contactar con su teléfono, correo, estado, próxima acción y última nota.
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Icon } from '@/components/icons';
import { FOLLOWUP_STATUS, statusClass } from '@/components/followup';
import { dt, Loading, useAdmin } from '../hooks';

const today = () => new Date().toISOString().slice(0, 10);

function List() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const { data, error } = useAdmin<any>(`/api/admin/followups?${sp}`);
  const go = (patch: Record<string, string>) => { const u = new URLSearchParams(sp.toString()); for (const [k, v] of Object.entries(patch)) if (v) u.set(k, v); else u.delete(k); if (!('page' in patch)) u.delete('page'); router.push(`${path}?${u}`); };
  const exportQs = new URLSearchParams(sp.toString()); exportQs.delete('page');
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}><h1 style={{ margin: 0 }}>Seguimiento</h1><span className="spacer" />
        <a className="btn btn-outline btn-sm" href={`/api/admin/export/followups?${exportQs}&format=csv`} download><Icon name="download" /> CSV</a>
        <a className="btn btn-outline btn-sm" href={`/api/admin/export/followups?${exportQs}&format=xlsx`} download>Excel</a></div>
      <p className="muted small" style={{ marginTop: 0 }}>Empresas que estás contactando. Para añadir una, abre su ficha y guarda su seguimiento o añade una nota. Solo lo ves tú.</p>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); go({ q: String(f.get('q') ?? ''), status: String(f.get('status') ?? ''), tag: String(f.get('tag') ?? ''), due: f.get('due') ? '1' : '' }); }}>
        <input className="input" name="q" defaultValue={sp.get('q') ?? ''} placeholder="Nombre, dominio o ciudad" style={{ flex: 1, minWidth: 180 }} aria-label="Buscar" />
        <select className="input" name="status" defaultValue={sp.get('status') ?? ''} style={{ width: 'auto' }} aria-label="Estado">
          <option value="">Todos los estados</option>{Object.entries(FOLLOWUP_STATUS).map(([k, v]) => <option key={k} value={k}>{v}{data?.counts?.[k] ? ` (${data.counts[k]})` : ''}</option>)}</select>
        <select className="input" name="tag" defaultValue={sp.get('tag') ?? ''} style={{ width: 'auto' }} aria-label="Etiqueta">
          <option value="">Todas las etiquetas</option>{(data?.tags ?? []).map((t: string) => <option key={t} value={t}>{t}</option>)}</select>
        <label className="check"><input type="checkbox" name="due" defaultChecked={sp.get('due') === '1'} /> Acciones para hoy o vencidas</label>
        <button className="btn btn-outline">Filtrar</button>
      </form>
      {!data ? <Loading error={error} /> : <>
        <p className="muted small">{data.total} empresas</p>
        {data.items.length === 0 ? <div className="card empty"><p>No hay empresas en seguimiento con estos filtros.</p><Link className="btn btn-primary" href="/buscar">Buscar empresas</Link></div> :
        <div className="table-wrap"><table className="table"><thead><tr><th>Empresa</th><th>Contacto</th><th>Estado</th><th>Próxima acción</th><th>Última nota</th></tr></thead><tbody>
          {data.items.map((c: any) => (
            <tr key={c.id}>
              <td><Link href={`/empresa/${c.slug}`}><strong>{c.name}</strong></Link><div className="small muted">{[c.city, c.country_name].filter(Boolean).join(', ')}</div>
                {c.tags.length > 0 && <div className="tags" style={{ marginTop: 4 }}>{c.tags.map((t: string) => <button key={t} type="button" className="chip chip-outline" onClick={() => go({ tag: t })}>{t}</button>)}</div>}</td>
              <td className="small">
                {c.phone ? <div><a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a></div> : <div className="muted">Sin teléfono</div>}
                {c.email ? <div><a href={`mailto:${c.email}`}>{c.email}</a></div> : <div className="muted">Sin correo electrónico</div>}
                {c.website ? <div><a href={c.website} target="_blank" rel="noopener noreferrer nofollow">{c.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></div> : <div className="muted">Sin página web</div>}</td>
              <td><span className={`badge ${statusClass(c.status)}`}>{FOLLOWUP_STATUS[c.status] ?? c.status}</span>
                {c.last_contact_at && <div className="small muted">Último contacto {dt(c.last_contact_at)}</div>}</td>
              <td className="small">{c.next_action_at ? <div className={c.next_action_at <= today() && !['cliente', 'no_interesado', 'descartado'].includes(c.status) ? 'due' : ''}>{new Date(`${c.next_action_at}T00:00:00`).toLocaleDateString('es-ES')}</div> : null}
                {c.next_action ?? (c.next_action_at ? '' : <span className="muted">—</span>)}</td>
              <td className="small" style={{ maxWidth: 280 }}>{c.last_note ? (c.last_note.length > 140 ? `${c.last_note.slice(0, 140)}…` : c.last_note) : <span className="muted">—</span>}</td>
            </tr>))}
        </tbody></table></div>}
        {data.pages > 1 && <nav className="pagination">{Array.from({ length: Math.min(data.pages, 30) }, (_, i) => <button key={i} className={data.page === i + 1 ? 'on' : ''} onClick={() => go({ page: String(i + 1) })}>{i + 1}</button>)}</nav>}
      </>}
    </>
  );
}

export default function Page() { return <Suspense><List /></Suspense>; }
