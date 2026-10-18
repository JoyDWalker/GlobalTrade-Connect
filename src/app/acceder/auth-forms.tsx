'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { supabaseBrowser } from '@/components/header';
import { Field, FormError, useSession, useToast } from '@/components/client';

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/cuenta');
const ERRORS: Record<string, string> = {
  'Invalid login credentials': 'Email o contraseña incorrectos',
  'Email not confirmed': 'Confirma tu email: te enviamos un enlace al registrarte',
  'User already registered': 'Ya existe una cuenta con este email',
};
const tr = (m: string) => ERRORS[m] ?? m;

function NotConfigured() {
  return <div className="notice notice-warn">La autenticación no está configurada en este entorno (faltan las variables de Supabase). Consulta el README.</div>;
}

export function LoginForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const { refresh } = useSession();
  const toast = useToast();
  const [error, setError] = useState<string | null>(sp.get('error'));
  const [busy, setBusy] = useState(false);
  if (!enabled) return <NotConfigured />;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    const { error: err } = await supabaseBrowser().auth.signInWithPassword({ email: String(f.get('email')), password: String(f.get('password')) });
    setBusy(false);
    if (err) return setError(tr(err.message));
    await refresh();
    toast('Sesión iniciada');
    router.push(safeNext(sp.get('next')));
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <FormError message={error} />
      <Field label="Email" htmlFor="l-email"><input id="l-email" className="input" type="email" name="email" autoComplete="username" required /></Field>
      <Field label="Contraseña" htmlFor="l-pass"><input id="l-pass" className="input" type="password" name="password" autoComplete="current-password" required /></Field>
      <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      <p className="small muted"><Link href="/recuperar">¿Has olvidado la contraseña?</Link> · ¿No tienes cuenta? <Link href={`/registro${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`}>Regístrate</Link></p>
    </form>
  );
}

export function SignupForm({ enabled, siteUrl }: { enabled: boolean; siteUrl: string }) {
  const sp = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!enabled) return <NotConfigured />;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email')).trim();
    const password = String(f.get('password'));
    const errs: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) errs.email = 'Email no válido';
    if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) errs.password = 'Mínimo 10 caracteres, con letras y números';
    if (f.get('consent') !== 'on') errs.consent = 'Debes aceptar la política de privacidad';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const { error: err } = await supabaseBrowser().auth.signUp({
      email, password,
      options: { data: { full_name: String(f.get('full_name') ?? '').slice(0, 120) }, emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(safeNext(sp.get('next')))}` },
    });
    setBusy(false);
    if (err) return setError(tr(err.message));
    setSent(email);
  }
  if (sent) return <div className="notice notice-ok">Te hemos enviado un email a <strong>{sent}</strong>. Abre el enlace para confirmar tu cuenta.</div>;
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <FormError message={error} />
      <Field label="Nombre" htmlFor="s-name"><input id="s-name" className="input" name="full_name" autoComplete="name" maxLength={120} /></Field>
      <Field label="Email" required error={errors.email} htmlFor="s-email"><input id="s-email" className="input" type="email" name="email" autoComplete="email" /></Field>
      <Field label="Contraseña" required error={errors.password} hint="Mínimo 10 caracteres, con letras y números" htmlFor="s-pass"><input id="s-pass" className="input" type="password" name="password" autoComplete="new-password" /></Field>
      <div className={`field ${errors.consent ? 'has-error' : ''}`}>
        <label className="check"><input type="checkbox" name="consent" /><span>Acepto la <Link href="/privacidad" target="_blank">política de privacidad</Link>.</span></label>
        {errors.consent && <span className="error-msg">{errors.consent}</span>}
      </div>
      <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creando cuenta…' : 'Crear cuenta'}</button>
      <p className="small muted">¿Ya tienes cuenta? <Link href="/acceder">Accede</Link></p>
    </form>
  );
}

export function ResetRequestForm({ enabled, siteUrl }: { enabled: boolean; siteUrl: string }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!enabled) return <NotConfigured />;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email'));
    const { error: err } = await supabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl}/auth/callback?next=/cuenta/contrasena` });
    if (err) return setError(tr(err.message));
    setSent(true);   // mismo mensaje exista o no la cuenta (no revela qué emails están registrados)
  }
  if (sent) return <div className="notice notice-ok">Si existe una cuenta con ese email, recibirás un enlace para elegir una nueva contraseña.</div>;
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <FormError message={error} />
      <Field label="Email" htmlFor="r-email"><input id="r-email" className="input" type="email" name="email" autoComplete="email" required /></Field>
      <button className="btn btn-primary" style={{ width: '100%' }}>Enviar enlace</button>
    </form>
  );
}

export function NewPasswordForm() {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password'));
    if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) return setError('Mínimo 10 caracteres, con letras y números');
    const { error: err } = await supabaseBrowser().auth.updateUser({ password });
    if (err) return setError(tr(err.message));
    toast('Contraseña actualizada');
    router.push('/cuenta');
  }
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <FormError message={error} />
      <Field label="Nueva contraseña" htmlFor="np"><input id="np" className="input" type="password" name="password" autoComplete="new-password" /></Field>
      <button className="btn btn-primary" style={{ width: '100%' }}>Guardar contraseña</button>
    </form>
  );
}
