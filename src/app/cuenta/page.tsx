import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { AccountDashboard } from './account-client';

export const metadata: Metadata = { title: 'Mi cuenta', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect('/acceder?next=/cuenta');
  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="page-head row"><div><h1>Mi cuenta</h1><p className="muted">{user.full_name ? `${user.full_name} · ` : ''}{user.email} · {{ user: 'Usuario', company: 'Empresa', admin: 'Administrador' }[user.role]}</p></div>
        <span className="spacer" />
        {user.role === 'admin' && <Link className="btn btn-primary" href="/admin">Panel de administración</Link>}
        <Link className="btn btn-outline" href="/favoritos">Mis listas</Link>
        <Link className="btn btn-ghost" href="/cuenta/contrasena">Cambiar contraseña</Link>
      </div>
      <AccountDashboard />
      <p className="small muted" style={{ marginTop: 24 }}>¿Quieres acceder a tus datos o eliminar tu cuenta? <Link href="/privacidad#derechos">Envía una solicitud RGPD</Link>.</p>
    </div>
  );
}
