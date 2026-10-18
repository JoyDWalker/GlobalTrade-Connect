'use client';
import { useState } from 'react';
import { apiFetch, Field, FormError, Honeypot, useFormToken, useSubmit } from '@/components/client';

export function PrivacyForm() {
  const token = useFormToken();
  const { busy, errors, message, run } = useSubmit();
  const [done, setDone] = useState(false);
  if (done) return <div className="notice notice-ok">Solicitud registrada. Te responderemos en el plazo legal. Podemos pedirte que verifiques tu identidad.</div>;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(e.currentTarget)), form_token: token };
    if (await run(() => apiFetch('/api/privacy-requests', { body }))) setDone(true);
  }
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Honeypot />
      <FormError message={message} />
      <Field label="Tipo de solicitud" required><select className="input" name="request_type">
        <option value="deletion">Supresión de mis datos</option><option value="access">Acceso a mis datos</option>
        <option value="rectification">Rectificación</option><option value="objection">Oposición / ocultar mi contacto</option></select></Field>
      <Field label="Nombre" required error={errors.name}><input className="input" name="name" autoComplete="name" /></Field>
      <Field label="Email asociado a tus datos" required error={errors.email}><input className="input" type="email" name="email" autoComplete="email" /></Field>
      <Field label="Detalles" error={errors.details} hint="Por ejemplo, la ficha en la que apareces"><textarea className="input" name="details" maxLength={2000} /></Field>
      <button className="btn btn-primary" disabled={busy || !token}>{busy ? 'Enviando…' : 'Enviar solicitud'}</button>
    </form>
  );
}
