import Link from 'next/link';
import type { Metadata } from 'next';
import { getSessionUser } from '@/lib/auth/session';
import { Lists } from './lists-client';

export const metadata: Metadata = { title: 'Mis listas', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="page-head"><h1>Favoritos y listas</h1><p className="muted">Guarda empresas como leads, organízalas en listas y expórtalas.</p></div>
      {user ? <Lists /> : (
        <div className="card empty"><h3>Inicia sesión para usar listas</h3><p>Tus listas se guardan en tu cuenta y solo tú puedes verlas.</p>
          <div className="row" style={{ justifyContent: 'center' }}><Link className="btn btn-primary" href="/acceder?next=/favoritos">Acceder</Link><Link className="btn btn-outline" href="/registro?next=/favoritos">Crear cuenta</Link></div></div>
      )}
    </div>
  );
}
