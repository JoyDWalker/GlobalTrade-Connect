'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { apiFetch, download, useToast } from '@/components/client';
import { Icon } from '@/components/icons';
import { dt, Loading, useAdmin } from '../hooks';

const TABS: [string, string][] = [['inquiries', 'Contacto y cotizaciones'], ['supplier-requests', 'Solicitudes de proveedores'], ['reports', 'Datos reportados'], ['privacy', 'Peticiones RGPD']];
const ST: Record<string, string> = { new: 'Nueva', read: 'Leída', answered: 'Respondida', archived: 'Archivada', in_progress: 'En curso', closed: 'Cerrada', resolved: 'Resuelto', dismissed: 'Descartado', completed: 'Completada', rejected: 'Rechazada' };
const RGPD: Record<string, string> = { deletion: 'Supresión', access: 'Acceso', rectification: 'Rectificación', objection: 'Oposición' };

function Leads() {
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') ?? 'inquiries');
  const [status, setStatus] = useState('');
  const { data, error, reload } = useAdmin<any>(`/api/admin/leads/${tab}${status ? `?status=${status}` : ''}`);
  const toast = useToast();
  const setSt = async (id: number, s: string) => { try { await apiFetch(`/api/admin/leads/${tab}/${id}`, { method: 'PUT', body: { status: s } }); toast('Estado actualizado'); } catch (e) { toast((e as Error).message, { error: true }); } };
  const statusSel = (r: any) => <select className="input" defaultValue={r.status} aria-label="Estado" onChange={(e) => setSt(r.id, e.target.value)}>{data.statuses.map((s: string) => <option key={s} value={s}>{ST[s] ?? s}</option>)}</select>;
  const privacy = async (r: any, action: 'export' | 'execute_erasure') => {
    if (action === 'execute_erasure' && !confirm(`Se anonimizarán o eliminarán los datos asociados a ${r.email}. No se puede deshacer. ¿Continuar?`)) return;
    try {
      if (action === 'export') await download(`/api/admin/privacy/${r.id}`, { action });
      else { const x = await apiFetch<any>(`/api/admin/privacy/${r.id}`, { body: { action } }); toast(`Hecho${x.authPending ? '. Atención: borra también el usuario en Supabase Auth' : ''}`); reload(); }
    } catch (e) { toast((e as Error).message, { error: true }); }
  };
  return (
    <>
      <div className="row"><h1 style={{ margin: 0 }}>Solicitudes</h1><span className="spacer" />
        {tab !== 'privacy' && <><a className="btn btn-outline btn-sm" href={`/api/admin/export/${tab}?format=csv`} download><Icon name="download" /> CSV</a><a className="btn btn-outline btn-sm" href={`/api/admin/export/${tab}?format=xlsx`} download>Excel</a></>}</div>
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setStatus(''); }}>{l}</button>)}</div>
      {!data ? <Loading error={error} /> : <>
        <div className="row" style={{ gap: 6, marginBottom: 12 }}><button className={`chip ${status ? 'chip-outline' : ''}`} onClick={() => setStatus('')}>Todas</button>
          {data.statuses.map((s: string) => <button key={s} className={`chip ${status === s ? '' : 'chip-outline'}`} onClick={() => setStatus(s)}>{ST[s] ?? s}</button>)}</div>
        {data.items.length === 0 ? <div className="card empty"><p>No hay solicitudes.</p></div> : (
          <div className="table-wrap"><table className="table">
            {tab === 'inquiries' && <><thead><tr><th>Fecha</th><th>Empresa</th><th>Remitente</th><th>Producto</th><th>Mensaje</th><th>Estado</th></tr></thead><tbody>
              {data.items.map((r: any) => <tr key={r.id}><td>{dt(r.created_at)}<br /><span className="badge">{r.inquiry_type === 'quote' ? 'Cotización' : 'Contacto'}</span></td><td><Link href={`/empresa/${r.company_slug}`}>{r.company_name}</Link></td>
                <td><strong>{r.sender_name}</strong><br />{r.sender_company ?? ''} · {r.sender_country}<br /><a href={`mailto:${r.email}`}>{r.email}</a> {r.phone ?? ''}</td><td>{r.product_interest ?? '—'}<br /><span className="muted small">{r.estimated_volume ?? ''}</span></td>
                <td style={{ maxWidth: 300, whiteSpace: 'pre-line' }}>{r.message}</td><td>{statusSel(r)}</td></tr>)}</tbody></>}
            {tab === 'supplier-requests' && <><thead><tr><th>Fecha</th><th>Solicitante</th><th>Necesidad</th><th>Candidatos (worker)</th><th>Estado</th></tr></thead><tbody>
              {data.items.map((r: any) => <tr key={r.id}><td>{dt(r.created_at)}</td><td><strong>{r.user_name}</strong><br />{r.company_name ?? ''}<br /><a href={`mailto:${r.email}`}>{r.email}</a> {r.phone ?? ''}</td>
                <td><strong>{r.product}</strong> {r.category_name && <span className="muted small">· {r.category_name}</span>}<br />Cantidad: {r.quantity}{r.target_date && <> · para {new Date(r.target_date).toLocaleDateString('es-ES')}</>}<br />
                  <span className="small muted">Origen: {r.origin_countries?.join(', ') || 'indiferente'} · Certif.: {r.certifications?.join(', ') || '—'}</span>{r.notes && <div className="small" style={{ whiteSpace: 'pre-line' }}>{r.notes}</div>}
                  <Link className="small" href={`/buscar?q=${encodeURIComponent(r.product)}${r.origin_countries?.length ? `&country=${r.origin_countries.join(',')}` : ''}`} target="_blank">Buscar candidatos →</Link></td>
                <td className="small">{(typeof r.suggestions === 'string' ? JSON.parse(r.suggestions) : r.suggestions).map((s: any) => <div key={s.id}><Link href={`/empresa/${s.slug}`} target="_blank">{s.name}</Link></div>)}</td><td>{statusSel(r)}</td></tr>)}</tbody></>}
            {tab === 'reports' && <><thead><tr><th>Fecha</th><th>Empresa</th><th>Campo</th><th>Mensaje</th><th>Email</th><th>Estado</th></tr></thead><tbody>
              {data.items.map((r: any) => <tr key={r.id}><td>{dt(r.created_at)}</td><td><Link href={`/admin/empresas/${r.company_id}`}>{r.company_name}</Link></td><td>{r.field ?? '—'}</td><td style={{ maxWidth: 320 }}>{r.message}</td><td>{r.reporter_email ?? 'Anónimo'}</td><td>{statusSel(r)}</td></tr>)}</tbody></>}
            {tab === 'privacy' && <><thead><tr><th>Fecha</th><th>Tipo</th><th>Solicitante</th><th>Detalles</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
              {data.items.map((r: any) => <tr key={r.id}><td>{dt(r.created_at)}</td><td>{RGPD[r.request_type]}</td><td>{r.name}<br />{r.email}</td><td style={{ maxWidth: 260 }}>{r.details ?? '—'}</td><td>{statusSel(r)}</td>
                <td><div className="actions"><button className="btn btn-outline btn-sm" onClick={() => privacy(r, 'export')}>Exportar datos</button>
                  {r.request_type === 'deletion' && r.status === 'new' && <button className="btn btn-danger btn-sm" onClick={() => privacy(r, 'execute_erasure')}>Ejecutar supresión</button>}</div></td></tr>)}</tbody></>}
          </table></div>
        )}
        {tab === 'privacy' && <p className="small muted" style={{ marginTop: 12 }}>Plazo legal de respuesta: un mes. Verifica la identidad del solicitante antes de exportar o suprimir datos.</p>}
      </>}
    </>
  );
}

export default function Page() { return <Suspense><Leads /></Suspense>; }
