import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import { getMeta } from '@/lib/meta';
import { getSessionUser } from '@/lib/auth/session';
import { authConfigured } from '@/lib/env';
import { RegisterCompany } from './register-client';

export const metadata: Metadata = { title: 'Registra tu empresa' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="wrap">
      <div className="page-head form-narrow"><h1>Registra tu empresa</h1>
        <p>El alta es gratuita. Tras enviarla quedará <strong>pendiente de revisión</strong>: comprobamos los datos antes de publicarla. Puedes solicitar después la verificación de la empresa.</p></div>
      <div className="form-narrow">
        {!user ? (
          <div className="card card-pad">
            <h2>Primero, accede o crea una cuenta</h2>
            <p className="muted">La cuenta te permite editar la ficha, recibir solicitudes y pedir la verificación.</p>
            {authConfigured() ? <div className="row"><Link className="btn btn-primary" href="/registro?next=/registrar">Crear cuenta</Link><Link className="btn btn-outline" href="/acceder?next=/registrar">Ya tengo cuenta</Link></div>
              : <div className="notice notice-warn">La autenticación no está configurada en este entorno.</div>}
          </div>
        ) : <RegisterCompany meta={await getMeta(getDb())} />}
      </div>
    </div>
  );
}
