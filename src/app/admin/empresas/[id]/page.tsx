'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { CompanyForm, draftFrom, payloadFrom } from '@/components/company-form';
import { apiFetch, useSubmit, useToast } from '@/components/client';
import { Icon } from '@/components/icons';
import { StatusBadge, VerificationBadge } from '@/components/ui';
import type { Meta } from '@/lib/meta';
import { dt, Loading, useAdmin } from '../../hooks';
import { CompanyQuickActions } from '../quick-actions';
import { FollowupPanel } from '@/components/followup';

const TASK: Record<string, string> = { new_detected: 'Nueva detectada', self_registered: 'Alta propia', duplicate_candidate: 'Posible duplicado', broken_link: 'Web caída', stale_data: 'Datos antiguos', registry_evidence: 'Evidencia de registro', verification_request: 'Solicitud de verificación', correction_request: 'Solicitud de corrección', data_report: 'Datos reportados', owner_update: 'Cambios del titular' };

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'nueva';
  const router = useRouter();
  const toast = useToast();
  const meta = useAdmin<Meta>('/api/meta');
  const detail = useAdmin<any>(isNew ? null : `/api/admin/companies/${id}`);
  const { busy, errors, message, run } = useSubmit();
  if (!meta.data || (!isNew && !detail.data)) return <Loading error={meta.error ?? detail.error} />;
  const c = detail.data?.company;

  async function remove() {
    if (!confirm(`¿Eliminar «${c.name}»? Se ocultará y conservará su historial y leads (borrado lógico).`)) return;
    await apiFetch(`/api/admin/companies/${id}`, { method: 'DELETE' });
    toast('Empresa eliminada'); router.push('/admin/empresas');
  }

  return (
    <>
      <p><Link href="/admin/empresas">← Empresas</Link></p>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{isNew ? 'Nueva empresa' : c.name}</h1><span className="spacer" />
        {!isNew && <><StatusBadge status={c.record_status} /><VerificationBadge level={c.verification_level} /><Link className="btn btn-outline btn-sm" href={`/empresa/${c.slug}`} target="_blank">Ver ficha</Link></>}
      </div>
      {!isNew && <>
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <CompanyQuickActions c={c} onDone={detail.reload} />
          <p className="small muted" style={{ margin: '10px 0 0' }}>Origen: {c.origin} · Alta {dt(c.created_at)} · Actualizada {dt(c.updated_at)} · Última comprobación {dt(c.last_checked_at)} · Web: {c.website_status}
            {c.verification_method && <> · Método de verificación: {c.verification_method}</>}{c.rejection_reason && <> · Motivo de rechazo: {c.rejection_reason}</>}</p>
          {detail.data.members.length > 0 && <p className="small" style={{ margin: '6px 0 0' }}>Titulares: {detail.data.members.map((m: any) => `${m.email} (${m.role})`).join(', ')}</p>}
          <p className="small" style={{ margin: '6px 0 0' }}>Solicitudes recibidas: {detail.data.inquiries}</p>
        </div>
        <div style={{ marginBottom: 16 }}><FollowupPanel companyId={c.id} name={c.name} city={c.city} country={c.country_name} /></div>
        {detail.data.tasks.length > 0 && <div className="card card-pad" style={{ marginBottom: 16 }}><h3>Revisiones</h3>
          <ul className="source-list">{detail.data.tasks.map((t: any) => <li key={t.id}><strong>{TASK[t.kind] ?? t.kind}</strong> · {t.status} · {dt(t.created_at)}{t.resolution ? ` · ${t.resolution}` : ''}<pre className="json">{JSON.stringify(t.details, null, 1)}</pre></li>)}</ul></div>}
        <details className="card card-pad" style={{ marginBottom: 16 }}><summary><strong>Procedencia ({c.sources.length} fuentes, {c.provenance.length} datos)</strong></summary>
          <ul className="source-list" style={{ marginTop: 10 }}>{c.sources.map((s: any, i: number) => <li key={i}><strong>{s.name}</strong> · {s.source_url} · visto {dt(s.first_seen_at)} – {dt(s.last_seen_at)}{s.snippet && <div className="small muted">{s.snippet}</div>}</li>)}</ul>
          {c.provenance.length > 0 && <div className="table-wrap" style={{ marginTop: 10 }}><table className="table"><thead><tr><th>Campo</th><th>Valor</th><th>Fuente</th><th>Estado</th><th>Fecha</th></tr></thead>
            <tbody>{c.provenance.map((p: any, i: number) => <tr key={i}><td>{p.field}</td><td style={{ maxWidth: 280, wordBreak: 'break-word' }}>{p.value}</td><td>{p.source_name}</td><td>{p.status}</td><td>{dt(p.collected_at)}</td></tr>)}</tbody></table></div>}
          {c.verifications.length > 0 && <><h4>Comprobaciones</h4><ul className="source-list">{c.verifications.map((v: any, i: number) => <li key={i}>{v.kind}: <strong>{v.result}</strong> · {dt(v.created_at)}<pre className="json">{JSON.stringify(v.details, null, 1)}</pre></li>)}</ul></>}
        </details>
        <details className="card card-pad" style={{ marginBottom: 16 }}><summary><strong>Historial de cambios ({c.changes.length})</strong></summary>
          <ul className="source-list" style={{ marginTop: 10 }}>{c.changes.map((h: any, i: number) => <li key={i}>{dt(h.created_at)} · {h.change_source}{h.actor_email ? ` · ${h.actor_email}` : ''}<pre className="json">{JSON.stringify(h.changes, null, 1)}</pre></li>)}</ul>
        </details>
      </>}
      <CompanyForm key={c?.updated_at ?? 'new'} meta={meta.data} initial={draftFrom(c)} errors={errors} message={message} busy={busy} mode="admin" submitLabel={isNew ? 'Crear empresa' : 'Guardar cambios'}
        footerExtra={!isNew ? <button type="button" className="btn btn-danger" onClick={remove}><Icon name="trash" /> Eliminar</button> : undefined}
        onSubmit={async (d) => {
          const r = await run(() => apiFetch<any>(isNew ? '/api/admin/companies' : `/api/admin/companies/${id}`, { method: isNew ? 'POST' : 'PUT', body: payloadFrom(d) }));
          if (!r) return;
          toast('Empresa guardada');
          if (isNew) router.push(`/admin/empresas/${r.id}`); else detail.reload();
        }} />
    </>
  );
}
