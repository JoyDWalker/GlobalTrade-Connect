'use client';
// Piezas interactivas compartidas: sesión, favoritos, selección, avisos, modales y llamadas a la API.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icons';

// ───────── API ─────────
export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: Record<string, string>, public extra?: any) { super(message); }
}
export async function apiFetch<T = any>(url: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.form ? undefined : { 'Content-Type': 'application/json' },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    if (!res.ok) throw new ApiError(`Error ${res.status}`, res.status);
    return res as unknown as T;
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error ?? `Error ${res.status}`, res.status, data.details, data);
  return data;
}

export async function download(url: string, body?: unknown) {
  const res = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error ?? 'No se pudo exportar', res.status);
  const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export');
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}

// ───────── Avisos ─────────
type Toast = { id: number; msg: string; error?: boolean };
const ToastCtx = createContext<(msg: string, opts?: { error?: boolean }) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

// ───────── Sesión y favoritos ─────────
export interface ClientUser { id: string; email: string; full_name: string | null; role: string; companyIds: string[] }
interface SessionState { user: ClientUser | null; saved: Set<string>; toggleSaved: (id: string) => Promise<void>; refresh: () => Promise<void>; authEnabled: boolean }
const SessionCtx = createContext<SessionState>({ user: null, saved: new Set(), toggleSaved: async () => {}, refresh: async () => {}, authEnabled: false });
export const useSession = () => useContext(SessionCtx);

export function Providers({ children, authEnabled }: { children: React.ReactNode; authEnabled: boolean }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((msg: string, opts: { error?: boolean } = {}) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, error: opts.error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.error ? 5000 : 2800);
  }, []);
  const [user, setUser] = useState<ClientUser | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const router = useRouter();
  const refresh = useCallback(async () => {
    try { const me = await apiFetch<{ user: ClientUser | null; saved: string[] }>('/api/me'); setUser(me.user); setSaved(new Set(me.saved)); } catch { /* sin sesión */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const toggleSaved = useCallback(async (id: string) => {
    if (!user) { toast('Inicia sesión para guardar empresas en tus listas'); router.push(`/acceder?next=${encodeURIComponent(location.pathname + location.search)}`); return; }
    const on = !saved.has(id);
    try {
      if (on) await apiFetch('/api/lists/default/items', { body: { companyIds: [id] } });
      else await apiFetch(`/api/lists/default/items/${id}`, { method: 'DELETE' });
      setSaved((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
      toast(on ? 'Guardada en Favoritos' : 'Eliminada de Favoritos');
    } catch (e) { toast((e as Error).message, { error: true }); }
  }, [user, saved, toast, router]);
  const value = useMemo(() => ({ user, saved, toggleSaved, refresh, authEnabled }), [user, saved, toggleSaved, refresh, authEnabled]);
  return (
    <ToastCtx.Provider value={toast}>
      <SessionCtx.Provider value={value}>
        {children}
        <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>{t.msg}</div>)}</div>
      </SessionCtx.Provider>
    </ToastCtx.Provider>
  );
}

export function FavButton({ id, label = false }: { id: string; label?: boolean }) {
  const { saved, toggleSaved } = useSession();
  const on = saved.has(id);
  if (label) return <button type="button" className={`btn btn-outline ${on ? 'is-fav' : ''}`} onClick={() => toggleSaved(id)}><Icon name="heart" /> {on ? 'Guardada' : 'Guardar en favoritos'}</button>;
  return <button type="button" className={`icon-btn ${on ? 'is-fav' : ''}`} aria-pressed={on} title={on ? 'Quitar de favoritos' : 'Guardar en favoritos'} onClick={() => toggleSaved(id)}><Icon name="heart" /></button>;
}

// ───────── Selección para exportar (página de resultados) ─────────
const SelectionCtx = createContext<{ selected: Set<string>; toggle: (id: string, on: boolean) => void; clear: () => void; setMany: (ids: string[], on: boolean) => void } | null>(null);
export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }), []);
  const setMany = useCallback((ids: string[], on: boolean) => setSelected((s) => { const n = new Set(s); for (const id of ids) if (on) n.add(id); else n.delete(id); return n; }), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return <SelectionCtx.Provider value={{ selected, toggle, clear, setMany }}>{children}</SelectionCtx.Provider>;
}
export const useSelection = () => useContext(SelectionCtx);

export function SelectBox({ id, name }: { id: string; name: string }) {
  const sel = useSelection();
  if (!sel) return null;
  return <label className="select-box" title="Seleccionar para exportar"><span className="sr-only">Seleccionar {name}</span>
    <input type="checkbox" checked={sel.selected.has(id)} onChange={(e) => sel.toggle(id, e.target.checked)} /></label>;
}

// ───────── Modal ─────────
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" data-close aria-label="Cerrar" onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ───────── Formularios ─────────
/** Token anti-spam + campo trampa. */
export function useFormToken() {
  const [token, setToken] = useState('');
  useEffect(() => { apiFetch<{ token: string }>('/api/form-token').then((r) => setToken(r.token)).catch(() => {}); }, []);
  return token;
}
export function Honeypot() {
  return <div className="hp-field" aria-hidden="true"><label>No rellenes este campo<input type="text" name="hp_field" tabIndex={-1} autoComplete="off" /></label></div>;
}

export function Field({ label, error, required, hint, children, className = '', htmlFor }: { label: React.ReactNode; error?: string; required?: boolean; hint?: string; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label className={required ? 'req' : ''} htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="error-msg">{error}</span>}
    </div>
  );
}

/** Estado de envío + errores por campo para un formulario. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setBusy(true); setErrors({}); setMessage(null);
    try { return await fn(); }
    catch (e) {
      const err = e as ApiError;
      setErrors(err.details ?? {});
      setMessage(err.message ?? 'Error');
      setTimeout(() => document.querySelector('.has-error, .form-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return null;
    } finally { setBusy(false); }
  }, []);
  return { busy, errors, message, run, setErrors };
}

export function FormError({ message }: { message: string | null }) {
  return message ? <div className="form-error" role="alert">{message}</div> : null;
}
