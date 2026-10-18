import type { Metadata } from 'next';
import { Suspense } from 'react';
import { authConfigured, env } from '@/lib/env';
import { SignupForm } from '../acceder/auth-forms';

export const metadata: Metadata = { title: 'Crear cuenta', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div className="wrap"><div className="card card-pad auth-card">
      <h1 style={{ fontSize: '1.5rem' }}>Crear cuenta</h1>
      <p className="muted">Con una cuenta puedes guardar empresas en listas, solicitar información y registrar tu empresa.</p>
      <Suspense><SignupForm enabled={authConfigured()} siteUrl={env().NEXT_PUBLIC_SITE_URL} /></Suspense>
    </div></div>
  );
}
