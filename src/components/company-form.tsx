'use client';
// Formulario de empresa con sectores abiertos (árbol + palabras clave), productos/servicios libres y contactos.
import Link from 'next/link';
import { useState } from 'react';
import type { Meta } from '@/lib/meta';
import { Icon } from './icons';
import { Field, FormError, Honeypot } from './client';

export interface ContactDraft { full_name: string; job_title: string; email: string; phone: string; whatsapp: string; languages: string[]; is_primary: boolean; is_personal: boolean; consent_public: boolean }
export interface CompanyDraft {
  name: string; legal_name: string; description: string; main_activity: string; country_code: string; region: string; city: string; address: string; postal_code: string;
  coverage_area: string; website: string; email: string; phone: string; company_types: string[]; keywords: string[]; year_founded: string; employees_range: string;
  export_capacity_tons: string; production_capacity: string; minimum_order_kg: string; minimum_order_notes: string; commercial_terms: string;
  social: { linkedin: string; instagram: string; facebook: string; other: string }; tax_id: string; lei: string;
  categories: number[]; offerings: { kind: 'product' | 'service'; name: string; hs_code: string }[]; certifications: string[]; languages: string[];
  client_types: string[]; export_markets: string[]; import_markets: string[]; contacts: ContactDraft[];
}

const emptyContact = (primary = false): ContactDraft => ({ full_name: '', job_title: '', email: '', phone: '', whatsapp: '', languages: [], is_primary: primary, is_personal: true, consent_public: false });

export function draftFrom(c: any = {}): CompanyDraft {
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    name: s(c.name), legal_name: s(c.legal_name), description: s(c.description), main_activity: s(c.main_activity), country_code: s(c.country_code).trim(),
    region: s(c.region), city: s(c.city), address: s(c.address), postal_code: s(c.postal_code), coverage_area: s(c.coverage_area), website: s(c.website),
    email: s(c.email), phone: s(c.phone), company_types: c.company_types ?? [], keywords: c.keywords ?? [], year_founded: s(c.year_founded), employees_range: s(c.employees_range),
    export_capacity_tons: s(c.export_capacity_tons), production_capacity: s(c.production_capacity), minimum_order_kg: s(c.minimum_order_kg),
    minimum_order_notes: s(c.minimum_order_notes), commercial_terms: s(c.commercial_terms),
    social: { linkedin: s(c.social?.linkedin), instagram: s(c.social?.instagram), facebook: s(c.social?.facebook), other: s(c.social?.other) },
    tax_id: s(c.tax_id), lei: s(c.lei),
    categories: (c.categories ?? []).filter((k: any) => !(c.categories ?? []).some((x: any) => x.parent_id === k.id)).map((k: any) => Number(k.id)),
    offerings: (c.offerings ?? []).map((o: any) => ({ kind: o.kind, name: o.name, hs_code: s(o.hs_code) })),
    certifications: (c.certifications ?? []).map((x: any) => x.slug), languages: (c.languages ?? []).map((x: any) => x.code),
    client_types: (c.client_types ?? []).map((x: any) => x.slug), export_markets: (c.export_markets ?? []).map((x: any) => x.iso_code), import_markets: (c.import_markets ?? []).map((x: any) => x.iso_code),
    contacts: (c.contacts ?? []).length ? c.contacts.map((k: any) => ({ full_name: s(k.full_name), job_title: s(k.job_title), email: s(k.email), phone: s(k.phone), whatsapp: s(k.whatsapp),
      languages: k.languages ?? [], is_primary: Boolean(k.is_primary), is_personal: k.is_personal !== false, consent_public: Boolean(k.consent_public) })) : [emptyContact(true)],
  };
}

/** Cuerpo para la API (los vacíos se envían como null). */
export function payloadFrom(d: CompanyDraft) {
  return { ...d, offerings: d.offerings.filter((o) => o.name.trim()), contacts: d.contacts.filter((k) => k.full_name || k.email || k.phone) };
}

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState('');
  const add = () => { const t = text.trim().replace(/,$/, ''); if (t && !value.includes(t) && value.length < 40) onChange([...value, t.slice(0, 60)]); setText(''); };
  return (
    <div className="tag-input">
      {value.map((t) => <span key={t} className="chip">{t}<button type="button" aria-label={`Quitar ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}><Icon name="x" /></button></span>)}
      <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={add}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }} />
    </div>
  );
}

const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

export function CompanyForm({ meta, initial, errors, message, busy, submitLabel, onSubmit, mode, header, footerExtra }: {
  meta: Meta; initial: CompanyDraft; errors: Record<string, string>; message: string | null; busy: boolean; submitLabel: string;
  onSubmit: (d: CompanyDraft, form: HTMLFormElement) => void; mode: 'register' | 'owner' | 'admin'; header?: React.ReactNode; footerExtra?: React.ReactNode;
}) {
  const [d, setD] = useState<CompanyDraft>(initial);
  const set = <K extends keyof CompanyDraft>(k: K, v: CompanyDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const err = (k: string) => errors[k] ?? errors[`company.${k}`];
  const input = (k: keyof CompanyDraft, props: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <input className="input" id={`f-${k}`} value={d[k] as string} onChange={(e) => set(k, e.target.value as any)} {...props} />;
  const roots = meta.categories.filter((c) => !c.parent_id);
  const kids = (id: number) => meta.categories.filter((c) => c.parent_id === id);
  let n = 0;
  const num = () => ++n;
  const setContact = (i: number, patch: Partial<ContactDraft>) => set('contacts', d.contacts.map((k, j) => (j === i ? { ...k, ...patch } : patch.is_primary ? { ...k, is_primary: false } : k)));

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(d, e.currentTarget); }}>
      {mode === 'register' && <Honeypot />}
      <FormError message={message} />
      {header}
      <div className="card form-card"><h2><span className="num">{num()}</span> Datos de la empresa</h2><div className="form-grid">
        <Field label="Nombre comercial" required className="span-2" error={err('name')} htmlFor="f-name">{input('name', { maxLength: 150, autoComplete: 'organization' })}</Field>
        <Field label="Razón social" error={err('legal_name')} htmlFor="f-legal_name" hint="Nombre legal registrado, si es distinto">{input('legal_name', { maxLength: 200 })}</Field>
        <Field label="Actividad principal" error={err('main_activity')} htmlFor="f-main_activity">{input('main_activity', { maxLength: 200, placeholder: 'Ej.: Fabricación de envases de cartón' })}</Field>
        <Field label="Descripción" className="span-2" error={err('description')} htmlFor="f-description">
          <textarea className="input" id="f-description" value={d.description} maxLength={4000} onChange={(e) => set('description', e.target.value)} placeholder="Qué hacéis, para quién, volúmenes, diferenciación…" /></Field>
        <Field label="Sitio web oficial" error={err('website')} htmlFor="f-website">{input('website', { type: 'url', placeholder: 'https://' })}</Field>
        <Field label="Año de fundación" error={err('year_founded')} htmlFor="f-year_founded">{input('year_founded', { type: 'number', min: 1500, max: new Date().getFullYear() })}</Field>
        <Field label="Email corporativo público" error={err('email')} htmlFor="f-email" hint="Buzón genérico de la empresa (p. ej. ventas@)">{input('email', { type: 'email' })}</Field>
        <Field label="Teléfono comercial público" error={err('phone')} htmlFor="f-phone">{input('phone', { type: 'tel' })}</Field>
        <Field label="Identificación fiscal" error={err('tax_id')} htmlFor="f-tax_id" hint="No se publica. Sirve para verificar y evitar duplicados.">{input('tax_id', { maxLength: 40 })}</Field>
        <Field label="Código LEI (opcional)" error={err('lei')} htmlFor="f-lei" hint="20 caracteres. Permite contrastar con el registro GLEIF.">{input('lei', { maxLength: 20 })}</Field>
        <Field label="Tamaño (empleados)" htmlFor="f-employees_range"><select className="input" id="f-employees_range" value={d.employees_range} onChange={(e) => set('employees_range', e.target.value)}>
          <option value="">—</option>{['1-9', '10-49', '50-249', '250-999', '1000+'].map((v) => <option key={v}>{v}</option>)}</select></Field>
      </div></div>

      <div className="card form-card"><h2><span className="num">{num()}</span> Ubicación</h2><div className="form-grid">
        <Field label="País" required error={err('country_code')} htmlFor="f-country_code"><select className="input" id="f-country_code" value={d.country_code} onChange={(e) => set('country_code', e.target.value)}>
          <option value="">Selecciona…</option>{meta.countries.map((c) => <option key={c.iso_code} value={c.iso_code}>{c.name}</option>)}</select></Field>
        <Field label="Región / provincia / estado" htmlFor="f-region">{input('region', { maxLength: 100 })}</Field>
        <Field label="Ciudad" error={err('city')} htmlFor="f-city">{input('city', { maxLength: 100 })}</Field>
        <Field label="Código postal" htmlFor="f-postal_code">{input('postal_code', { maxLength: 20 })}</Field>
        <Field label="Dirección comercial pública" className="span-2" htmlFor="f-address" hint="Solo si es pública (oficina, fábrica, almacén)">{input('address', { maxLength: 200 })}</Field>
        <Field label="Zona de cobertura" className="span-2" htmlFor="f-coverage_area">{input('coverage_area', { maxLength: 300, placeholder: 'Ej.: Unión Europea y Norte de África' })}</Field>
      </div></div>

      <div className="card form-card"><h2><span className="num">{num()}</span> Actividad, sectores y oferta</h2><div className="stack">
        <div className={`field ${err('company_types') ? 'has-error' : ''}`}><span className="label req">Tipo de actividad</span>
          <div className="check-grid">{meta.business_types.map((b) => <label key={b.slug} className="check"><input type="checkbox" checked={d.company_types.includes(b.slug)} onChange={(e) => set('company_types', toggle(d.company_types, b.slug, e.target.checked))} /><span>{b.name}</span></label>)}</div>
          {err('company_types') && <span className="error-msg">{err('company_types')}</span>}</div>
        <div className={`field ${err('categories') ? 'has-error' : ''}`}><span className="label">Sectores</span><span className="hint">Marca los más específicos. Si tu sector no aparece, usa las palabras clave.</span>
          <div className="stack">{roots.map((r) => (
            <details key={r.id} className="cat-block" open={kids(r.id).some((c) => d.categories.includes(c.id) || kids(c.id).some((g) => d.categories.includes(g.id))) || d.categories.includes(r.id)}>
              <summary><strong>{r.name}</strong></summary>
              <div className="check-grid" style={{ marginTop: 8 }}>
                {kids(r.id).length === 0 && <label className="check"><input type="checkbox" checked={d.categories.includes(r.id)} onChange={(e) => set('categories', toggle(d.categories, r.id, e.target.checked))} /><span>{r.name}</span></label>}
                {kids(r.id).flatMap((c) => [
                  <label key={c.id} className="check"><input type="checkbox" checked={d.categories.includes(c.id)} onChange={(e) => set('categories', toggle(d.categories, c.id, e.target.checked))} /><span><strong>{c.name}</strong></span></label>,
                  ...kids(c.id).map((g) => <label key={g.id} className="check" style={{ paddingLeft: 12 }}><input type="checkbox" checked={d.categories.includes(g.id)} onChange={(e) => set('categories', toggle(d.categories, g.id, e.target.checked))} /><span>{g.name}</span></label>)])}
              </div></details>))}</div>
          {err('categories') && <span className="error-msg">{err('categories')}</span>}</div>
        <div className="field"><span className="label">Palabras clave</span><span className="hint">Productos, materiales, sectores o servicios con los que quieres aparecer (Intro para añadir)</span>
          <TagInput value={d.keywords} onChange={(v) => set('keywords', v)} placeholder="Ej.: envases compostables, PLA, OEM" /></div>
        <div className="field"><span className="label">Productos y servicios</span>
          {d.offerings.map((o, i) => (
            <div key={i} className="inline-form" style={{ marginBottom: 6 }}>
              <select className="input" style={{ width: 130 }} value={o.kind} onChange={(e) => set('offerings', d.offerings.map((x, j) => (j === i ? { ...x, kind: e.target.value as 'product' | 'service' } : x)))} aria-label="Tipo"><option value="product">Producto</option><option value="service">Servicio</option></select>
              <input className="input" style={{ flex: 2, minWidth: 180 }} value={o.name} maxLength={150} placeholder="Nombre" aria-label="Nombre del producto o servicio" onChange={(e) => set('offerings', d.offerings.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input" style={{ width: 130 }} value={o.hs_code} maxLength={12} placeholder="Código SA" aria-label="Código arancelario" onChange={(e) => set('offerings', d.offerings.map((x, j) => (j === i ? { ...x, hs_code: e.target.value } : x)))} />
              <button type="button" className="icon-btn" aria-label="Quitar" onClick={() => set('offerings', d.offerings.filter((_, j) => j !== i))}><Icon name="trash" /></button>
            </div>))}
          {errors['offerings.0.name'] && <span className="error-msg">{errors['offerings.0.name']}</span>}
          <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('offerings', [...d.offerings, { kind: 'product', name: '', hs_code: '' }])}><Icon name="plus" /> Añadir producto o servicio</button>
        </div>
        <div className="field"><span className="label">Certificaciones</span><div className="check-grid">{meta.certifications.map((c) => <label key={c.slug} className="check"><input type="checkbox" checked={d.certifications.includes(c.slug)} onChange={(e) => set('certifications', toggle(d.certifications, c.slug, e.target.checked))} /><span>{c.name}</span></label>)}</div></div>
        <div className="field"><span className="label">Idiomas de atención</span><div className="check-grid">{meta.languages.map((l) => <label key={l.code} className="check"><input type="checkbox" checked={d.languages.includes(l.code)} onChange={(e) => set('languages', toggle(d.languages, l.code, e.target.checked))} /><span>{l.name}</span></label>)}</div></div>
        <div className="field"><span className="label">Tipo de cliente</span><div className="check-grid">{meta.client_types.map((c) => <label key={c.slug} className="check"><input type="checkbox" checked={d.client_types.includes(c.slug)} onChange={(e) => set('client_types', toggle(d.client_types, c.slug, e.target.checked))} /><span>{c.name}</span></label>)}</div></div>
      </div></div>

      <div className="card form-card"><h2><span className="num">{num()}</span> Mercados, capacidad y condiciones</h2><div className="form-grid">
        {(['export_markets', 'import_markets'] as const).map((k) => (
          <Field key={k} label={k === 'export_markets' ? 'Exporta a' : 'Importa desde'} htmlFor={`f-${k}`} hint="Ctrl/Cmd + clic para elegir varios">
            <select className="input" id={`f-${k}`} multiple size={7} value={d[k]} onChange={(e) => set(k, [...e.target.selectedOptions].map((o) => o.value))}>
              {meta.countries.map((c) => <option key={c.iso_code} value={c.iso_code}>{c.name}</option>)}</select></Field>))}
        <Field label="Capacidad de exportación (t/año)" error={err('export_capacity_tons')} htmlFor="f-export_capacity_tons">{input('export_capacity_tons', { type: 'number', min: 0 })}</Field>
        <Field label="Capacidad de producción" htmlFor="f-production_capacity">{input('production_capacity', { maxLength: 200 })}</Field>
        <Field label="Pedido mínimo (kg)" error={err('minimum_order_kg')} htmlFor="f-minimum_order_kg">{input('minimum_order_kg', { type: 'number', min: 0, step: 'any' })}</Field>
        <Field label="Pedido mínimo (descripción)" htmlFor="f-minimum_order_notes">{input('minimum_order_notes', { maxLength: 200, placeholder: "Ej.: 1 palé, 1 contenedor de 20'" })}</Field>
        <Field label="Condiciones comerciales" className="span-2" htmlFor="f-commercial_terms"><textarea className="input" id="f-commercial_terms" value={d.commercial_terms} maxLength={1500} onChange={(e) => set('commercial_terms', e.target.value)} placeholder="Incoterms, pago, plazos, muestras…" /></Field>
      </div></div>

      <div className="card form-card"><h2><span className="num">{num()}</span> Redes sociales</h2><div className="form-grid">
        {(['linkedin', 'instagram', 'facebook', 'other'] as const).map((k) => (
          <Field key={k} label={{ linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', other: 'Otra red o catálogo' }[k]} error={err(`social.${k}`)} htmlFor={`f-s-${k}`}>
            <input className="input" id={`f-s-${k}`} type="url" value={d.social[k]} onChange={(e) => set('social', { ...d.social, [k]: e.target.value })} /></Field>))}
      </div></div>

      <div className="card form-card"><h2><span className="num">{num()}</span> Personas de contacto</h2>
        <p className="small muted">Indica preferentemente contactos corporativos. Los datos personales solo se publican si la persona lo autoriza.</p>
        {d.contacts.map((k, i) => (
          <div key={i} className="contact-block">
            {i > 0 && <button type="button" className="btn btn-ghost btn-sm" style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => set('contacts', d.contacts.filter((_, j) => j !== i))}><Icon name="trash" /> Quitar</button>}
            <div className="form-grid">
              <Field label="Nombre y apellidos" error={errors[`company.contacts.${i}.full_name`] ?? errors[`contacts.${i}.full_name`]}><input className="input" value={k.full_name} maxLength={120} onChange={(e) => setContact(i, { full_name: e.target.value })} /></Field>
              <Field label="Cargo"><input className="input" value={k.job_title} maxLength={120} onChange={(e) => setContact(i, { job_title: e.target.value })} /></Field>
              <Field label="Email" error={errors[`company.contacts.${i}.email`] ?? errors[`contacts.${i}.email`]}><input className="input" type="email" value={k.email} onChange={(e) => setContact(i, { email: e.target.value })} /></Field>
              <Field label="Teléfono" error={errors[`company.contacts.${i}.phone`] ?? errors[`contacts.${i}.phone`]}><input className="input" type="tel" value={k.phone} onChange={(e) => setContact(i, { phone: e.target.value })} /></Field>
              <Field label="WhatsApp" error={errors[`company.contacts.${i}.whatsapp`]}><input className="input" type="tel" value={k.whatsapp} onChange={(e) => setContact(i, { whatsapp: e.target.value })} /></Field>
              <div className="field"><span className="label">Idiomas</span><div className="row" style={{ gap: 10 }}>{meta.languages.slice(0, 8).map((l) => <label key={l.code} className="check"><input type="checkbox" checked={k.languages.includes(l.code)} onChange={(e) => setContact(i, { languages: toggle(k.languages, l.code, e.target.checked) })} />{l.code.toUpperCase()}</label>)}</div></div>
              <label className="check"><input type="radio" name="primary" checked={k.is_primary} onChange={() => setContact(i, { is_primary: true })} /> Contacto principal (recibe las solicitudes)</label>
              <label className="check"><input type="checkbox" checked={!k.is_personal} onChange={(e) => setContact(i, { is_personal: !e.target.checked })} /> Es un buzón/teléfono corporativo genérico (no una persona)</label>
              <label className="check span-2"><input type="checkbox" checked={k.consent_public} onChange={(e) => setContact(i, { consent_public: e.target.checked })} />
                <span>{k.is_personal ? 'Esta persona autoriza mostrar públicamente su email, teléfono y WhatsApp.' : 'Mostrar públicamente este contacto corporativo.'} Si no se marca, solo se mostrará el formulario.</span></label>
            </div>
          </div>))}
        {d.contacts.length < 5 && <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => set('contacts', [...d.contacts, emptyContact(false)])}><Icon name="plus" /> Añadir contacto</button>}
      </div>

      {mode === 'register' && <div className="card form-card"><h2>Consentimientos</h2><div className="stack">
        <div className={`field ${errors.consent_authority ? 'has-error' : ''}`}><label className="check"><input type="checkbox" name="consent_authority" /><span>Confirmo que represento a esta empresa y que tengo autorización para publicar estos datos y los de las personas de contacto.</span></label>{errors.consent_authority && <span className="error-msg">{errors.consent_authority}</span>}</div>
        <div className={`field ${errors.consent_privacy ? 'has-error' : ''}`}><label className="check"><input type="checkbox" name="consent_privacy" /><span>He leído y acepto la <Link href="/privacidad" target="_blank">política de privacidad</Link>.</span></label>{errors.consent_privacy && <span className="error-msg">{errors.consent_privacy}</span>}</div>
      </div></div>}
      <div className="sticky-actions">{footerExtra}<span className="spacer" /><button className="btn btn-primary btn-lg" type="submit" disabled={busy}>{busy ? 'Guardando…' : submitLabel}</button></div>
    </form>
  );
}
