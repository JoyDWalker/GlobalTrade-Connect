'use client';
import { useState } from 'react';
import { dt, Loading, useAdmin } from '../hooks';

export default function Page() {
  const [action, setAction] = useState('');
  const { data, error } = useAdmin<any>(`/api/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`);
  return (
    <>
      <h1>Auditoría</h1>
      <p className="muted">Acciones sensibles: altas y cambios de empresas, verificaciones, roles, exportaciones, ajustes y derechos RGPD.</p>
      <div className="tabs">{['', 'company.', 'user.', 'export', 'privacy.', 'settings.', 'job.', 'taxonomy.'].map((a) => <button key={a} className={action === a ? 'on' : ''} onClick={() => setAction(a)}>{a || 'Todas'}</button>)}</div>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Objeto</th><th>Detalles</th></tr></thead><tbody>
          {data.items.map((r: any) => <tr key={r.id}><td className="small">{dt(r.created_at)}</td><td className="small">{r.actor_email ?? 'sistema'}</td><td>{r.action}</td><td className="small">{r.entity_type} {r.entity_id}</td><td><pre className="json">{JSON.stringify(r.details)}</pre></td></tr>)}
        </tbody></table></div>
      )}
    </>
  );
}
