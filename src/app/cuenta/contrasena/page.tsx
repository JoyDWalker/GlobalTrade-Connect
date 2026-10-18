import type { Metadata } from 'next';
import { Suspense } from 'react';
import { authConfigured, env } from '@/lib/env';
import { NewPasswordForm } from '../../acceder/auth-forms';

export const metadata: Metadata = { title: 'Nueva contraseña', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div className="wrap"><div className="card card-pad auth-card">
      <h1 style={{ fontSize: '1.5rem' }}>Nueva contraseña</h1>
      <Suspense><NewPasswordForm  /></Suspense>
    </div></div>
  );
}
