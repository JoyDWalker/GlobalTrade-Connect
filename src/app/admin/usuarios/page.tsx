'use client';
import Link from 'next/link';
import { useState } from 'react';
import { apiFetch, useSession, useToast } from '@/components/client';
import { dt, Loading, useAdmin } from '../hooks';

export default function Page() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { data, error, reload } = useAdmin<any>(`/api/admin/users?q=${encodeURIComponent(search)}`);
  const { user: me } = useSession();
  const toast = useToast();
  const update = async (id: string, body: Record<string, unknown>, msg: string) => {
    if (body.role === 'admin' && !confirm('¿Conceder permisos de administrador? Tendrá acceso total al panel.')) return reload();
    try { await apiFetch(`/api/admin/users/${id}`, { method: 'PUT', body }); toast(msg); reload(); } catch (e) { toast((e as Error).message, { error: true }); reload(); }
  };
  return (
    <>
      <h1>Usuarios</h1>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email o nombre" style={{ flex: 1 }} aria-label="Buscar usuario" /><button className="btn btn-outline">Buscar</button></form>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Usuario</th><th>Empresas</th><th>Alta</th><th>Rol</th><th>Estado</th></tr></thead><tbody>
          {data.items.map((u: any) => {
            const companies = typeof u.companies === 'string' ? JSON.parse(u.companies) : u.companies;
            const self = u.id === me?.id;
            return (
              <tr key={u.id}><td><strong>{u.email}</strong><br /><span className="small muted">{u.full_name ?? ''}</span></td>
                <td className="small">{companies.map((c: any) => <div key={c.id}><Link href={`/admin/empresas/${c.id}`}>{c.name}</Link></div>)}</td>
                <td className="small">{dt(u.created_at)}</td>
                <td><select className="input" defaultValue={u.role} disabled={self} aria-label="Rol" onChange={(e) => update(u.id, { role: e.target.value }, 'Rol actualizado')}>
                  <option value="user">Usuario</option><option value="company">Empresa</option><option value="admin">Administrador</option></select></td>
                <td>{self ? <span className="small muted">Tú</span> : <button className={`btn btn-sm ${u.is_blocked ? 'btn-outline' : 'btn-danger'}`} onClick={() => update(u.id, { is_blocked: !u.is_blocked }, u.is_blocked ? 'Desbloqueado' : 'Bloqueado')}>{u.is_blocked ? 'Desbloquear' : 'Bloquear'}</button>}</td></tr>);
          })}
        </tbody></table></div>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>Los cambios de rol quedan en la auditoría. No puedes modificar tu propio rol. El primer administrador se crea con <code>npm run admin:grant</code> (ver README).</p>
    </>
  );
}
