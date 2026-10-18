import type { Metadata } from 'next';
import { Suspense } from 'react';
import { authConfigured, env } from '@/lib/env';
import { ResetRequestForm } from '../acceder/auth-forms';

export const metadata: Metadata = { title: 'Recuperar contraseña', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div className="wrap"><div className="card card-pad auth-card">
      <h1 style={{ fontSize: '1.5rem' }}>Recuperar contraseña</h1>
      <Suspense><ResetRequestForm enabled={authConfigured()} siteUrl={env().NEXT_PUBLIC_SITE_URL} /></Suspense>
    </div></div>
  );
}
