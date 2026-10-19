'use client';
// Panel de seguimiento comercial privado (solo administradores): estado, etiquetas, próxima acción y notas.
import { useEffect, useState } from 'react';
import { apiFetch, useToast } from './client';

export const FOLLOWUP_STATUS: Record<string, string> = {
  pendiente: 'Pendiente de contactar', contactado: 'Contactado', en_conversacion: 'En conversación', interesado: 'Interesado',
  cliente: 'Cliente', no_interesado: 'No interesado', descartado: 'Descartado',
};
const NOTE_KIND: Record<string, string> = { nota: 'Nota', llamada: 'Llamada', email: 'Email', reunion: 'Reunión' };
export const statusClass = (s: string) => (['interesado', 'cliente'].includes(s) ? 'badge-verified' : ['contactado', 'en_conversacion'].includes(s) ? 'badge-pending' : ['no_interesado', 'descartado'].includes(s) ? 'badge-rejected' : 'badge-unverified');

type Data = { followup: { status: string; tags: string[]; next_action: string | null; next_action_at: string | null; last_contact_at: string | null } | null; notes: { id: number; kind: string; body: string; created_at: string; author: string | null }[] };
const when = (d: string) => new Date(d).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

/** Enlaces para comprobar por uno mismo que la empresa existe y está activa. */
function VerifyLinks({ name, city, country }: { name: string; city?: string | null; country?: string | null }) {
  const q = [name, city, country].filter(Boolean).join(' ');
  const e = encodeURIComponent;
  const links: [string, string][] = [
    ['Google', `https://www.google.com/search?q=${e(`"${name}" ${city ?? country ?? ''}`.trim())}`],
    ['Google Maps', `https://www.google.com/maps/search/${e(q)}`],
    ['LinkedIn', `https://www.linkedin.com/search/results/companies/?keywords=${e(name)}`],
    ['Facebook', `https://www.facebook.com/search/pages/?q=${e(name)}`],
  ];
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="small muted" style={{ marginBottom: 4 }}>Comprobar que existe:</div>
      <div className="tags">{links.map(([label, href]) => <a key={label} className="chip chip-outline" href={href} target="_blank" rel="noopener noreferrer nofollow">{label}</a>)}</div>
    </div>
  );
}

export function FollowupPanel({ companyId, name, city, country }: { companyId: string; name: string; city?: string | null; country?: string | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const toast = useToast();
  const url = `/api/admin/companies/${companyId}`;
  useEffect(() => { apiFetch<Data>(`${url}/followup`).then(setData, (e) => setError(e.message)); }, [url]);
  const run = async (fn: () => Promise<Data>, ok: string) => {
    setBusy(true);
    try { setData(await fn()); setFormKey((k) => k + 1); toast(ok); } catch (e) { toast((e as Error).message, { error: true }); } finally { setBusy(false); }
  };
  if (error) return <div className="card card-pad"><h2>Seguimiento</h2><p className="form-error">{error}</p></div>;
  if (!data) return <div className="card card-pad"><h2>Seguimiento</h2><p className="muted small">Cargando…</p></div>;
  const f = data.followup;
  return (
    <div className="card card-pad followup">
      <h2>Seguimiento <span className="badge" title="Solo lo ves tú">Privado</span></h2>
      <VerifyLinks name={name} city={city} country={country} />
      <form key={`f${formKey}`} onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const body = { status: fd.get('status'), tags: String(fd.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean), next_action: fd.get('next_action'), next_action_at: fd.get('next_action_at') };
        run(() => apiFetch<Data>(`${url}/followup`, { method: 'PUT', body }), 'Seguimiento guardado');
      }}>
        <label className="field"><span className="label">Estado</span>
          <select className="input" name="status" defaultValue={f?.status ?? 'pendiente'}>{Object.entries(FOLLOWUP_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span className="label">Etiquetas <span className="muted small">(separadas por comas)</span></span>
          <input className="input" name="tags" defaultValue={(f?.tags ?? []).join(', ')} placeholder="importador, prioridad, feria-2026" /></label>
        <label className="field"><span className="label">Próxima acción</span>
          <input className="input" name="next_action" defaultValue={f?.next_action ?? ''} placeholder="Llamar para enviar catálogo" maxLength={200} /></label>
        <label className="field"><span className="label">Fecha</span><input className="input" type="date" name="next_action_at" defaultValue={f?.next_action_at ?? ''} /></label>
        {f?.last_contact_at && <p className="small muted" style={{ margin: '4px 0' }}>Último contacto: {when(f.last_contact_at)}</p>}
        <button className="btn btn-outline btn-sm" disabled={busy} style={{ width: '100%', marginTop: 6 }}>Guardar seguimiento</button>
      </form>

      <h3 style={{ fontSize: '.95rem', margin: '16px 0 6px' }}>Notas</h3>
      <form key={`n${formKey}`} onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() => apiFetch<Data>(`${url}/notes`, { body: { kind: fd.get('kind'), body: fd.get('body') } }), 'Nota añadida');
      }}>
        <select className="input" name="kind" defaultValue="llamada" aria-label="Tipo de nota" style={{ marginBottom: 6 }}>{Object.entries(NOTE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <textarea className="input" name="body" rows={3} required maxLength={5000} placeholder="Qué se habló, con quién, qué quedó pendiente…" aria-label="Nota" />
        <button className="btn btn-primary btn-sm" disabled={busy} style={{ width: '100%', marginTop: 6 }}>Añadir nota</button>
        <p className="small muted" style={{ margin: '4px 0 0' }}>Una llamada, email o reunión actualiza la fecha de último contacto.</p>
      </form>
      <ul className="notes-list">{data.notes.map((n) => (
        <li key={n.id}>
          <div className="row small muted"><strong>{NOTE_KIND[n.kind] ?? n.kind}</strong> · {when(n.created_at)}<span className="spacer" />
            <button type="button" className="link-btn small" disabled={busy} onClick={() => { if (confirm('¿Borrar esta nota?')) run(() => apiFetch<Data>(`${url}/notes/${n.id}`, { method: 'DELETE' }), 'Nota borrada'); }}>Borrar</button></div>
          <div className="note-body">{n.body}</div>
        </li>))}
        {!data.notes.length && <li className="muted small">Sin notas todavía.</li>}
      </ul>
    </div>
  );
}
