'use client';
import { dt, Loading, useAdmin } from '../hooks';

export default function Page() {
  const { data, error } = useAdmin<any>('/api/admin/outbox');
  if (!data) return <Loading error={error} />;
  return (
    <>
      <h1>Emails</h1>
      <div className="notice notice-info" style={{ marginBottom: 16 }}>Los emails se encolan y el worker los entrega. Con <code>EMAIL_PROVIDER=log</code> no salen del servidor (estado «logged»); con <code>resend</code> se envían por Resend.</div>
      {data.items.length === 0 ? <div className="card empty"><p>Sin emails.</p></div> : data.items.map((m: any) => (
        <details key={m.id} className="card dup-group"><summary><strong>{m.subject}</strong> <span className="muted small">→ {m.to_email} · {m.status}{m.attempts > 1 ? ` (${m.attempts} intentos)` : ''} · {dt(m.created_at)}</span></summary>
          {m.last_error && <p className="small" style={{ color: 'var(--danger)' }}>{m.last_error}</p>}
          <pre className="mail">{m.body_text}</pre></details>))}
    </>
  );
}
