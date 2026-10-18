import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { AdminNav } from './nav';

export const metadata: Metadata = { title: 'Administración', robots: { index: false } };
export const dynamic = 'force-dynamic';

// Primera barrera (la autorización real se comprueba en cada ruta /api/admin con requireAdmin)
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/acceder?next=/admin');
  if (user.role !== 'admin') {
    return <div className="wrap empty"><h1>Acceso restringido</h1><p>Esta sección es solo para administradores.</p><Link className="btn btn-primary" href="/">Inicio</Link></div>;
  }
  return <div className="wrap admin-layout"><AdminNav /><section style={{ minWidth: 0 }}>{children}</section></div>;
}
