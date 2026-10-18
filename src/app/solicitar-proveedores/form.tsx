'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { Meta } from '@/lib/meta';
import { apiFetch, Field, FormError, Honeypot, useFormToken, useSession, useSubmit } from '@/components/client';
import { Icon } from '@/components/icons';

export function SupplierRequestForm({ meta, product }: { meta: Meta; product: string }) {
  const token = useFormToken();
  const { user } = useSession();
  const { busy, errors, message, run } = useSubmit();
  const [done, setDone] = useState(false);
  const [origins, setOrigins] = useState<string[]>([]);
  if (done) return <div className="card empty"><Icon name="check" /><h2>Solicitud enviada</h2><p>La revisaremos y te contactaremos por email.</p><Link className="btn btn-primary" href="/buscar">Mientras tanto, explora el directorio</Link></div>;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { ...Object.fromEntries(f), origin_countries: origins, certifications: f.getAll('certifications'), consent_privacy: f.get('consent_privacy') === 'on', form_token: token };
    if (await run(() => apiFetch('/api/supplier-requests', { body }))) { setDone(true); window.scrollTo(0, 0); }
  }
  const roots = meta.categories.filter((c) => !c.parent_id);
  return (
    <form className="card form-card" onSubmit={submit} noValidate>
      <Honeypot />
      <FormError message={message} />
      <h2>¿Qué buscas?</h2>
      <div className="form-grid">
        <Field label="Producto o servicio" required className="span-2" error={errors.product}><input className="input" name="product" defaultValue={product} maxLength={200} placeholder="Ej.: envases compostables para café de 250 g" /></Field>
        <Field label="Sector"><select className="input" name="category_id" defaultValue=""><option value="">Cualquiera</option>{roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Cantidad" required error={errors.quantity}><input className="input" name="quantity" maxLength={120} placeholder="Ej.: 20.000 uds/mes" /></Field>
        <Field label="Fecha objetivo" error={errors.target_date}><input className="input" type="date" name="target_date" min={new Date().toISOString().slice(0, 10)} /></Field>
        <Field label="País de origen preferido" hint="Ctrl/Cmd + clic para varios">
          <select className="input" multiple size={5} value={origins} onChange={(e) => setOrigins([...e.target.selectedOptions].map((o) => o.value))}>{meta.countries.map((c) => <option key={c.iso_code} value={c.iso_code}>{c.name}</option>)}</select></Field>
        <div className="field span-2"><span className="label">Certificaciones necesarias</span><div className="check-grid">{meta.certifications.map((c) => <label key={c.slug} className="check"><input type="checkbox" name="certifications" value={c.slug} />{c.name}</label>)}</div></div>
        <Field label="Detalles" className="span-2" error={errors.notes}><textarea className="input" name="notes" maxLength={3000} placeholder="Especificaciones, Incoterm, destino, precio objetivo…" /></Field>
      </div>
      <h2 style={{ marginTop: 24 }}>Tus datos</h2>
      <div className="form-grid">
        <Field label="Nombre" required error={errors.user_name}><input className="input" name="user_name" defaultValue={user?.full_name ?? ''} autoComplete="name" /></Field>
        <Field label="Empresa"><input className="input" name="company_name" autoComplete="organization" /></Field>
        <Field label="Email" required error={errors.email}><input className="input" type="email" name="email" defaultValue={user?.email ?? ''} autoComplete="email" /></Field>
        <Field label="Teléfono" error={errors.phone}><input className="input" type="tel" name="phone" autoComplete="tel" /></Field>
        <div className={`field span-2 ${errors.consent_privacy ? 'has-error' : ''}`}><label className="check"><input type="checkbox" name="consent_privacy" /><span>Acepto la <Link href="/privacidad" target="_blank">política de privacidad</Link> y que compartáis mi solicitud con proveedores adecuados.</span></label>{errors.consent_privacy && <span className="error-msg">{errors.consent_privacy}</span>}</div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button className="btn btn-primary btn-lg" disabled={busy || !token}>{busy ? 'Enviando…' : 'Enviar solicitud'}</button></div>
    </form>
  );
}
