'use client';
import Link from 'next/link';
import { useState } from 'react';
import { apiFetch, useToast } from '@/components/client';
import { StatusBadge, VerificationBadge } from '@/components/ui';
import { dt, Loading, useAdmin } from '../hooks';
import { CompanyQuickActions } from '../empresas/quick-actions';

const KIND: Record<string, string> = { new_detected: 'Nuevas detectadas', self_registered: 'Altas de empresas', duplicate_candidate: 'Posibles duplicados', broken_link: 'Webs caídas', stale_data: 'Datos antiguos', registry_evidence: 'Evidencias de registro', verification_request: 'Solicitudes de verificación / reclamaciones', correction_request: 'Solicitudes de corrección', data_report: 'Datos reportados', owner_update: 'Cambios de titulares' };

export default function Page() {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useAdmin<any>(`/api/admin/review-tasks?status=${status}${kind ? `&kind=${kind}` : ''}`);
  const toast = useToast();
  const resolve = async (id: number, s: string) => {
    const resolution = s === 'open' ? null : prompt('Nota de resolución (opcional)') ?? '';
    try { await apiFetch(`/api/admin/review-tasks/${id}`, { method: 'PUT', body: { status: s, resolution } }); toast('Actualizada'); reload(); } catch (e) { toast((e as Error).message, { error: true }); }
  };
  return (
    <>
      <h1>Cola de revisión</h1>
      <p className="muted">Generada por el registro de empresas, el buscador externo, el worker (duplicados, webs caídas, registros) y los reportes de usuarios.</p>
      <div className="tabs">
        {['open', 'resolved', 'dismissed'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{{ open: 'Abiertas', resolved: 'Resueltas', dismissed: 'Descartadas' }[s]}</button>)}
      </div>
      {data && status === 'open' && <div className="row" style={{ gap: 6, marginBottom: 12 }}>
        <button className={`chip ${!kind ? '' : 'chip-outline'}`} onClick={() => setKind('')}>Todas</button>
        {data.counts.map((c: any) => <button key={c.kind} className={`chip ${kind === c.kind ? '' : 'chip-outline'}`} onClick={() => setKind(c.kind)}>{KIND[c.kind] ?? c.kind} ({c.n})</button>)}
      </div>}
      {!data ? <Loading error={error} /> : data.items.length === 0 ? <div className="card empty"><p>No hay tareas.</p></div> : (
        <div className="stack">{data.items.map((t: any) => (
          <div key={t.id} className="card card-pad">
            <div className="row"><span className="badge badge-pending">{KIND[t.kind] ?? t.kind}</span><span className="small muted">prioridad {t.priority} · {dt(t.created_at)}{t.requested_by_email ? ` · solicitado por ${t.requested_by_email}` : ''}</span><span className="spacer" />
              {t.status === 'open' ? <><button className="btn btn-primary btn-sm" onClick={() => resolve(t.id, 'resolved')}>Resolver</button><button className="btn btn-ghost btn-sm" onClick={() => resolve(t.id, 'dismissed')}>Descartar</button></>
                : <button className="btn btn-ghost btn-sm" onClick={() => resolve(t.id, 'open')}>Reabrir</button>}</div>
            {t.company_id && <div className="row" style={{ marginTop: 8 }}><Link href={`/admin/empresas/${t.company_id}`}><strong>{t.company_name}</strong></Link> <StatusBadge status={t.record_status} /> <VerificationBadge level={t.verification_level} />
              <Link className="small" href={`/empresa/${t.company_slug}`} target="_blank">ficha pública</Link></div>}
            {t.details?.company_ids && <p className="small">Empresas implicadas: {t.details.company_ids.map((cid: string) => <Link key={cid} href={`/admin/empresas/${cid}`} style={{ marginRight: 8 }}>{cid.slice(0, 8)}</Link>)}</p>}
            <pre className="json">{JSON.stringify(t.details, null, 1)}</pre>
            {t.resolution && <p className="small">Resolución: {t.resolution}</p>}
            {t.company_id && t.status === 'open' && <div style={{ marginTop: 8 }}><CompanyQuickActions c={{ id: t.company_id, name: t.company_name, slug: t.company_slug, record_status: t.record_status, verification_level: t.verification_level, is_featured: false }} onDone={reload} /></div>}
          </div>))}</div>
      )}
    </>
  );
}
