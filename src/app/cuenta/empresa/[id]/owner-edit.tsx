'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Meta } from '@/lib/meta';
import { CompanyForm, draftFrom, payloadFrom } from '@/components/company-form';
import { apiFetch, useSubmit, useToast } from '@/components/client';
import { Logo } from '@/components/ui';

export function LogoUploader({ companyId, name, initial }: { companyId: string; name: string; initial: string | null }) {
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function upload(file: File) {
    if (file.size > 400 * 1024) return toast('El logo no puede superar 400 KB', { error: true });
    const form = new FormData();
    form.append('logo', file);
    setBusy(true);
    try { const r = await apiFetch<{ logo_url: string }>(`/api/account/companies/${companyId}/logo`, { form }); setUrl(r.logo_url); toast('Logo actualizado'); }
    catch (e) { toast((e as Error).message, { error: true }); }
    finally { setBusy(false); }
  }
  return (
    <div className="card form-card"><h2>Logo</h2>
      <div className="logo-upload">
        <Logo name={name} url={url} large />
        <div className="stack">
          <input type="file" className="input" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Subir logo" />
          <span className="hint">PNG, JPG o WebP de hasta 400 KB. Usa solo logotipos que tengas derecho a publicar.</span>
          {url && <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { await apiFetch(`/api/account/companies/${companyId}/logo`, { method: 'DELETE' }); setUrl(null); }}>Quitar logo</button>}
        </div>
      </div>
    </div>
  );
}

export function OwnerEdit({ meta, company }: { meta: Meta; company: any }) {
  const router = useRouter();
  const toast = useToast();
  const { busy, errors, message, run } = useSubmit();
  return (
    <CompanyForm meta={meta} initial={draftFrom(company)} errors={errors} message={message} busy={busy} mode="owner" submitLabel="Guardar cambios"
      header={<LogoUploader companyId={company.id} name={company.name} initial={company.logo_url} />}
      onSubmit={async (d) => {
        const r = await run(() => apiFetch(`/api/account/companies/${company.id}`, { method: 'PUT', body: payloadFrom(d) }));
        if (r) { toast('Ficha actualizada'); router.push('/cuenta'); router.refresh(); }
      }} />
  );
}
