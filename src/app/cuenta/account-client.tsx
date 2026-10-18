'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CompanyCard } from '@/lib/services/companies';
import { apiFetch, Field, FormError, Modal, useSubmit, useToast } from '@/components/client';
import { StatusBadge, VerificationBadge } from '@/components/ui';

const INQ = [['new', 'Nueva'], ['read', 'Leída'], ['answered', 'Respondida'], ['archived', 'Archivada']];
const TASK: Record<string, string> = { verification_request: 'Solicitud de verificación', correction_request: 'Solicitud de corrección', self_registered: 'Alta', owner_update: 'Cambios en la ficha' };

export function AccountDashboard() {
  const [data, setData] = useState<{ companies: CompanyCard[]; inquiries: any[]; tasks: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<CompanyCard | null>(null);
  const toast = useToast();
  const load = () => apiFetch('/api/account/companies').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (error) return <div className="form-error">{error}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Cargando…</div>;
  return (
    <>
      <h2>Mis empresas</h2>
      {data.companies.length === 0 ? (
        <div className="card empty"><h3>Aún no gestionas ninguna empresa</h3><p>Registra tu empresa o reclama una ficha existente desde su página.</p><Link className="btn btn-primary" href="/registrar">Registrar mi empresa</Link></div>
      ) : data.companies.map((c) => (
        <div key={c.id} className="card card-pad row" style={{ marginBottom: 12 }}>
          <div><h3 style={{ margin: 0 }}>{c.name}</h3><div className="row" style={{ gap: 6, marginTop: 6 }}><StatusBadge status={c.record_status} /> <VerificationBadge level={c.verification_level} /></div></div>
          <span className="spacer" />
          <Link className="btn btn-outline btn-sm" href={`/empresa/${c.slug}`}>Ver ficha</Link>
          <Link className="btn btn-primary btn-sm" href={`/cuenta/empresa/${c.id}`}>Editar</Link>
          <button className="btn btn-ghost btn-sm" onClick={() => setRequest(c)}>Solicitar verificación o corrección</button>
        </div>))}
      {data.tasks.length > 0 && <>
        <h3 style={{ marginTop: 20 }}>Mis solicitudes al equipo</h3>
        <ul className="source-list">{data.tasks.map((t) => <li key={t.id}>{TASK[t.kind] ?? t.kind} · {new Date(t.created_at).toLocaleDateString('es-ES')} · <strong>{{ open: 'En revisión', resolved: 'Resuelta', dismissed: 'Descartada' }[t.status as string]}</strong>{t.resolution ? ` · ${t.resolution}` : ''}</li>)}</ul>
      </>}
      <h2 style={{ marginTop: 28 }}>Solicitudes recibidas ({data.inquiries.length})</h2>
      {data.inquiries.length ? (
        <div className="table-wrap"><table className="table"><thead><tr><th>Fecha</th><th>Remitente</th><th>Producto / volumen</th><th>Mensaje</th><th>Estado</th></tr></thead><tbody>
          {data.inquiries.map((q) => (
            <tr key={q.id}><td>{new Date(q.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}<br /><span className="badge">{q.inquiry_type === 'quote' ? 'Cotización' : 'Contacto'}</span></td>
              <td><strong>{q.sender_name}</strong><br />{q.sender_company ?? ''} · {q.sender_country}<br /><a href={`mailto:${q.email}`}>{q.email}</a>{q.phone ? <><br />{q.phone}</> : null}</td>
              <td>{q.product_interest ?? '—'}<br /><span className="muted">{q.estimated_volume ?? ''}</span></td>
              <td style={{ maxWidth: 320, whiteSpace: 'pre-line' }}>{q.message}</td>
              <td><select className="input" defaultValue={q.status} aria-label="Estado" onChange={async (e) => { try { await apiFetch(`/api/account/inquiries/${q.id}`, { method: 'PUT', body: { status: e.target.value } }); toast('Estado actualizado'); } catch (err) { toast((err as Error).message, { error: true }); } }}>
                {INQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td></tr>))}
        </tbody></table></div>
      ) : <div className="card empty"><p>Todavía no has recibido solicitudes.</p></div>}
      {request && <RequestModal company={request} onClose={() => { setRequest(null); load(); }} />}
    </>
  );
}

function RequestModal({ company, onClose }: { company: CompanyCard; onClose: () => void }) {
  const { busy, errors, message, run } = useSubmit();
  const toast = useToast();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (await run(() => apiFetch(`/api/account/companies/${company.id}/requests`, { body: Object.fromEntries(f) }))) { toast('Solicitud enviada'); onClose(); }
  }
  return (
    <Modal title={`Solicitud para ${company.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <FormError message={message} />
        <Field label="Tipo"><select className="input" name="kind"><option value="verification_request">Solicitar verificación de la empresa</option><option value="correction_request">Solicitar una corrección</option></select></Field>
        <Field label="Detalle" required error={errors.message} hint="Para verificar: indica registro mercantil, número de registro o documentación que puedes aportar."><textarea className="input" name="message" maxLength={2000} /></Field>
        <Field label="Enlace de evidencia (opcional)" error={errors.evidence_url}><input className="input" type="url" name="evidence_url" placeholder="https://" /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar'}</button></div>
      </form>
    </Modal>
  );
}
