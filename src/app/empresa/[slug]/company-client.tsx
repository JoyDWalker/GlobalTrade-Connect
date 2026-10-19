'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { apiFetch, FavButton, Field, FormError, Honeypot, Modal, useFormToken, useSession, useSubmit, useToast } from '@/components/client';

type Co = { id: string; slug: string; name: string; products: string[] };

async function copy(text: string, toast: (m: string) => void, msg = 'Copiado') {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { window.prompt('Copia el texto:', text); }
}

export function CompanyActions({ company, publicEmail, detected }: { company: Co; publicEmail: string | null; detected: boolean }) {
  const [modal, setModal] = useState<null | 'contact' | 'quote' | 'claim'>(null);
  const toast = useToast();
  const share = () => {
    const url = location.href;
    if (navigator.share) navigator.share({ title: company.name, url }).catch(() => {}); else copy(url, toast, 'Enlace copiado');
  };
  return (
    <>
      <div className="profile-actions">
        <button className="btn btn-primary" onClick={() => setModal('contact')}><Icon name="mail" /> Contactar empresa</button>
        <button className="btn btn-accent" onClick={() => setModal('quote')}><Icon name="quote" /> Solicitar cotización</button>
        <FavButton id={company.id} label />
        {publicEmail && <button className="btn btn-outline" onClick={() => copy(publicEmail, toast, 'Email copiado')}><Icon name="copy" /> Copiar email</button>}
        <button className="btn btn-outline" onClick={share}><Icon name="share" /> Compartir ficha</button>
        <button className="btn btn-ghost" onClick={() => setModal('claim')}><Icon name="shield" /> {detected ? '¿Es tu empresa?' : 'Reclamar ficha'}</button>
      </div>
      {(modal === 'contact' || modal === 'quote') && <ContactModal company={company} type={modal} onClose={() => setModal(null)} />}
      {modal === 'claim' && <ClaimModal company={company} onClose={() => setModal(null)} />}
    </>
  );
}

export function ContactCard({ company, contacts, email, phone, website, social, hasPrivate, detected }: {
  company: Co; contacts: any[]; email: string | null; phone: string | null; website: string | null; social: [string, string][]; hasPrivate: boolean; detected: boolean;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const LABEL: Record<string, string> = { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', other: 'Otra red' };
  return (
    <div className="card card-pad">
      <h2>Contacto</h2>
      {email ? <div className="contact-line"><Icon name="mail" /><a className="grow" href={`mailto:${email}`}>{email}</a><button className="icon-btn" aria-label="Copiar email" onClick={() => copy(email, toast, 'Email copiado')}><Icon name="copy" /></button></div>
        : <div className="contact-line"><Icon name="mail" /><span className="grow muted">Sin correo electrónico</span></div>}
      {phone ? <div className="contact-line"><Icon name="phone" /><a className="grow" href={`tel:${phone.replace(/\s/g, '')}`}>{phone}</a></div>
        : <div className="contact-line"><Icon name="phone" /><span className="grow muted">Sin teléfono</span></div>}
      {contacts.map((k) => (
        <div key={k.id} style={{ marginTop: 10 }}>
          {k.full_name && <div><strong>{k.full_name}</strong> <span className="muted small">{k.job_title ?? ''}</span></div>}
          {k.email && <div className="contact-line"><Icon name="mail" /><a className="grow" href={`mailto:${k.email}`}>{k.email}</a></div>}
          {k.phone && <div className="contact-line"><Icon name="phone" /><a className="grow" href={`tel:${k.phone.replace(/\s/g, '')}`}>{k.phone}</a></div>}
          {k.whatsapp && <div className="contact-line"><Icon name="whatsapp" /><a className="grow" href={`https://wa.me/${k.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">WhatsApp {k.whatsapp}</a></div>}
        </div>))}
      {hasPrivate && <div className="notice small" style={{ margin: '8px 0' }}>Algunos contactos personales no se publican. Usa el formulario.</div>}
      {website ? <div className="contact-line"><Icon name="globe" /><a className="grow" href={website} target="_blank" rel="noopener noreferrer nofollow">{website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></div>
        : <div className="contact-line"><Icon name="globe" /><span className="grow muted">Sin página web</span></div>}
      {social.length > 0 && <div className="row" style={{ gap: 6, marginTop: 10 }}>{social.map(([k, v]) => <a key={k} className="btn btn-outline btn-sm" href={v} target="_blank" rel="noopener noreferrer nofollow">{LABEL[k] ?? k}</a>)}</div>}
      {detected && <p className="provenance" style={{ marginTop: 8 }}>Datos públicos detectados en fuentes externas. Las solicitudes a empresas no verificadas las revisa nuestro equipo antes de reenviarlas.</p>}
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={() => setOpen(true)}>Enviar mensaje</button>
      {open && <ContactModal company={company} type="contact" onClose={() => setOpen(false)} />}
    </div>
  );
}

function ContactModal({ company, type, onClose }: { company: Co; type: 'contact' | 'quote'; onClose: () => void }) {
  const token = useFormToken();
  const { user } = useSession();
  const { busy, errors, message, run } = useSubmit();
  const [done, setDone] = useState<null | { delivered: boolean; email: string }>(null);
  const quote = type === 'quote';
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...Object.fromEntries(f), inquiry_type: type, consent_privacy: f.get('consent_privacy') === 'on', form_token: token };
    const r = await run(() => apiFetch<{ delivered: boolean }>(`/api/companies/${company.slug}/inquiries`, { body }));
    if (r) setDone({ delivered: r.delivered, email: String(body.email) });
  }
  return (
    <Modal title={quote ? `Solicitar cotización a ${company.name}` : `Contactar con ${company.name}`} onClose={onClose}>
      {done ? (
        <div className="empty" style={{ padding: 24 }}><Icon name="check" /><h3>Solicitud enviada</h3>
          <p>{done.delivered ? `Hemos enviado tu mensaje a ${company.name}. Te responderán a ${done.email}.` : 'Nuestro equipo revisará tu solicitud antes de reenviarla, porque esta empresa aún no ha verificado sus datos de contacto.'}</p>
          <button className="btn btn-primary" onClick={onClose}>Cerrar</button></div>
      ) : (
        <form onSubmit={submit} noValidate className="stack">
          <Honeypot />
          <FormError message={message} />
          <div className="form-grid">
            <Field label="Tu nombre" required error={errors.sender_name}><input className="input" name="sender_name" defaultValue={user?.full_name ?? ''} autoComplete="name" maxLength={120} /></Field>
            <Field label="Tu empresa" error={errors.sender_company}><input className="input" name="sender_company" autoComplete="organization" maxLength={150} /></Field>
            <Field label="País" required error={errors.sender_country}><input className="input" name="sender_country" autoComplete="country-name" maxLength={80} /></Field>
            <Field label="Email" required error={errors.email}><input className="input" type="email" name="email" defaultValue={user?.email ?? ''} autoComplete="email" /></Field>
            <Field label="Teléfono" error={errors.phone}><input className="input" type="tel" name="phone" autoComplete="tel" /></Field>
            <Field label="Producto o servicio de interés" error={errors.product_interest}><input className="input" name="product_interest" list="prods" maxLength={200} /><datalist id="prods">{company.products.map((p) => <option key={p} value={p} />)}</datalist></Field>
            <Field label="Volumen estimado" className="span-2" error={errors.estimated_volume}><input className="input" name="estimated_volume" maxLength={120} placeholder="Ej.: 2 contenedores de 20' al año" /></Field>
            <Field label="Mensaje" required className="span-2" error={errors.message}><textarea className="input" name="message" maxLength={3000} placeholder={quote ? 'Especificaciones, formato, Incoterm y destino…' : '¿Qué necesitas?'} /></Field>
          </div>
          <div className={`field ${errors.consent_privacy ? 'has-error' : ''}`}>
            <label className="check"><input type="checkbox" name="consent_privacy" /><span>He leído la <Link href="/privacidad" target="_blank">política de privacidad</Link> y acepto que mis datos se compartan con la empresa para responder a esta solicitud.</span></label>
            {errors.consent_privacy && <span className="error-msg">{errors.consent_privacy}</span>}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" type="submit" disabled={busy || !token}>{busy ? 'Enviando…' : quote ? 'Enviar solicitud de cotización' : 'Enviar mensaje'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ClaimModal({ company, onClose }: { company: Co; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const { busy, errors, message, run } = useSubmit();
  if (!user) return (
    <Modal title="Reclamar esta ficha" onClose={onClose}>
      <p>Para gestionar la ficha de {company.name} necesitas una cuenta. Después revisaremos que representas a la empresa.</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Link className="btn btn-primary" href={`/acceder?next=/empresa/${company.slug}`}>Acceder o crear cuenta</Link></div>
    </Modal>
  );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run(() => apiFetch<{ domainMatch: boolean }>('/api/account/claim', { body: { slug: company.slug, message: f.get('message'), job_title: f.get('job_title') || undefined } }));
    if (r) { toast('Solicitud enviada. La revisaremos.'); onClose(); }
  }
  return (
    <Modal title={`Reclamar la ficha de ${company.name}`} onClose={onClose}>
      <form onSubmit={submit} className="stack" noValidate>
        <p className="small muted">Revisamos manualmente cada reclamación. Ayuda que tu email ({user.email}) sea del dominio de la empresa y que aportes un medio de comprobación.</p>
        <FormError message={message} />
        <Field label="Tu cargo" error={errors.job_title}><input className="input" name="job_title" maxLength={120} /></Field>
        <Field label="¿Cómo podemos comprobar que representas a la empresa?" required error={errors.message}><textarea className="input" name="message" maxLength={2000} /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar'}</button></div>
      </form>
    </Modal>
  );
}

export function ReportLink({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = useState(false);
  const token = useFormToken();
  const toast = useToast();
  const { busy, errors, message, run } = useSubmit();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(e.currentTarget)), form_token: token };
    if (await run(() => apiFetch(`/api/companies/${slug}/reports`, { body }))) { setOpen(false); toast('Gracias. Revisaremos la información.'); }
  }
  return (
    <>
      <a href="#" onClick={(e) => { e.preventDefault(); setOpen(true); }}>Reportar datos incorrectos</a>
      {open && <Modal title="Reportar datos incorrectos" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="stack" noValidate>
          <Honeypot />
          <p className="muted">Ayúdanos a mantener la ficha de <strong>{name}</strong> al día.</p>
          <FormError message={message} />
          <Field label="¿Qué dato es incorrecto?"><select className="input" name="field">{['Datos de contacto', 'Dirección', 'Productos o servicios', 'Certificaciones', 'La empresa no existe o ha cerrado', 'Contiene datos personales que deben retirarse', 'Otro'].map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Descripción" required error={errors.message}><textarea className="input" name="message" maxLength={2000} /></Field>
          <Field label="Tu email (opcional)" error={errors.reporter_email}><input className="input" type="email" name="reporter_email" /></Field>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={busy || !token}>{busy ? 'Enviando…' : 'Enviar reporte'}</button></div>
        </form>
      </Modal>}
    </>
  );
}
