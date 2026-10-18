import type { Metadata } from 'next';
import { Suspense } from 'react';
import { authConfigured, env } from '@/lib/env';
import { LoginForm } from './auth-forms';

export const metadata: Metadata = { title: 'Acceder', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div className="wrap"><div className="card card-pad auth-card">
      <h1 style={{ fontSize: '1.5rem' }}>Acceder</h1>
      <p className="muted">Accede para guardar listas, gestionar tu empresa o administrar la plataforma.</p>
      <Suspense><LoginForm enabled={authConfigured()} /></Suspense>
    </div></div>
  );
}
