'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Icon } from '@/components/icons';
import { Flag, StatusBadge, VerificationBadge } from '@/components/ui';
import { dt, Loading, useAdmin } from '../hooks';
import { CompanyQuickActions } from './quick-actions';

function List() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const qs = new URLSearchParams(sp.toString());
  if (!qs.get('pageSize')) qs.set('pageSize', '25');
  const { data, error, reload } = useAdmin<any>(`/api/admin/companies?${qs}`);
  const go = (patch: Record<string, string>) => { const u = new URLSearchParams(sp.toString()); for (const [k, v] of Object.entries(patch)) if (v) u.set(k, v); else u.delete(k); if (!('page' in patch)) u.delete('page'); router.push(`${path}?${u}`); };
  const exportQs = new URLSearchParams(sp.toString()); exportQs.delete('page');
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}><h1 style={{ margin: 0 }}>Empresas</h1><span className="spacer" />
        <a className="btn btn-outline btn-sm" href={`/api/admin/export/companies?${exportQs}&format=csv`} download><Icon name="download" /> CSV</a>
        <a className="btn btn-outline btn-sm" href={`/api/admin/export/companies?${exportQs}&format=xlsx`} download>Excel</a>
        <Link className="btn btn-primary btn-sm" href="/admin/empresas/nueva"><Icon name="plus" /> Nueva empresa</Link></div>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); go({ q: String(f.get('q') ?? ''), status: String(f.get('status') ?? ''), verification: String(f.get('verification') ?? '') }); }}>
        <input className="input" name="q" defaultValue={sp.get('q') ?? ''} placeholder="Nombre, dominio, ciudad, producto…" style={{ flex: 1, minWidth: 200 }} aria-label="Buscar" />
        <select className="input" name="status" defaultValue={sp.get('status') ?? ''} style={{ width: 'auto' }} aria-label="Estado">
          <option value="">Todos los estados</option><option value="detected">Detectadas</option><option value="pending_review">Pendientes</option><option value="published">Publicadas</option><option value="hidden">Ocultas</option><option value="rejected">Rechazadas</option></select>
        <select className="input" name="verification" defaultValue={sp.get('verification') ?? ''} style={{ width: 'auto' }} aria-label="Verificación">
          <option value="">Cualquier verificación</option><option value="verified">Verificadas</option><option value="contrasted">Contrastadas</option><option value="none">Sin verificar</option></select>
        <button className="btn btn-outline">Filtrar</button>
      </form>
      {!data ? <Loading error={error} /> : <>
        <p className="muted small">{data.total} empresas</p>
        <div className="table-wrap"><table className="table"><thead><tr><th>Empresa</th><th>País</th><th>Estado</th><th>Verificación</th><th>Fuentes</th><th>Alta</th><th>Acciones</th></tr></thead><tbody>
          {data.items.map((c: any) => (
            <tr key={c.id}>
              <td><Link href={`/admin/empresas/${c.id}`}><strong>{c.name}</strong></Link>{c.is_featured && <> <span className="badge badge-featured">Destacada</span></>}{c.is_demo && <> <span className="badge badge-demo">DEMO</span></>}
                <div className="small muted">{c.domain ?? ''} {c.type_names.join(', ')}</div></td>
              <td><Flag iso={c.country_code} url={c.flag_url} name={c.country_name} /> {c.city ?? ''}</td>
              <td><StatusBadge status={c.record_status} /></td><td><VerificationBadge level={c.verification_level} /></td>
              <td className="small">{c.sources.join(', ')}</td><td className="small">{dt(c.created_at)}</td>
              <td><CompanyQuickActions c={c} onDone={reload} /></td>
            </tr>))}
        </tbody></table></div>
        {data.pages > 1 && <nav className="pagination">{Array.from({ length: Math.min(data.pages, 30) }, (_, i) => <button key={i} className={data.page === i + 1 ? 'on' : ''} onClick={() => go({ page: String(i + 1) })}>{i + 1}</button>)}</nav>}
      </>}
    </>
  );
}

export default function Page() { return <Suspense><List /></Suspense>; }
