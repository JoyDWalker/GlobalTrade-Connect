'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { Meta } from '@/lib/meta';
import { CompanyForm, draftFrom, payloadFrom } from '@/components/company-form';
import { apiFetch, ApiError, useFormToken, useSession, useSubmit } from '@/components/client';
import { Icon } from '@/components/icons';

export function RegisterCompany({ meta }: { meta: Meta }) {
  const token = useFormToken();
  const { refresh } = useSession();
  const { busy, errors, message, run } = useSubmit();
  const [done, setDone] = useState<string | null>(null);
  const [dup, setDup] = useState<{ slug: string; name: string } | null>(null);
  if (done) return (
    <div className="card empty"><Icon name="check" /><h2>¡Solicitud recibida!</h2>
      <p>Hemos recibido el alta de <strong>{done}</strong>. Te avisaremos por email cuando esté publicada.</p>
      <div className="row" style={{ justifyContent: 'center' }}><Link className="btn btn-primary" href="/cuenta">Ir a mi cuenta</Link></div></div>
  );
  return (
    <>
      {dup && <div className="notice notice-warn" style={{ marginBottom: 12 }}>Ya existe la ficha <Link href={`/empresa/${dup.slug}`}>{dup.name}</Link>. Si es tu empresa, ábrela y pulsa «Reclamar ficha» en lugar de crear otra.</div>}
      <CompanyForm meta={meta} initial={draftFrom()} errors={errors} message={message} busy={busy || !token} mode="register" submitLabel="Enviar solicitud de alta"
        onSubmit={async (d, form) => {
          const f = new FormData(form);
          setDup(null);
          const r = await run(async () => {
            try {
              return await apiFetch('/api/account/companies', { body: { company: payloadFrom(d), consent_privacy: f.get('consent_privacy') === 'on', consent_authority: f.get('consent_authority') === 'on', form_token: token, hp_field: f.get('hp_field') } });
            } catch (e) {
              if (e instanceof ApiError && e.status === 409 && e.extra?.existing) setDup(e.extra.existing);
              throw e;
            }
          });
          if (r) { await refresh(); setDone(d.name); window.scrollTo(0, 0); }
        }} />
    </>
  );
}
