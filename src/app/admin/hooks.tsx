'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/components/client';

/** Carga datos del panel con recarga manual. */
export function useAdmin<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try { setData(await apiFetch<T>(url)); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [url]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

export function Loading({ error }: { error?: string | null }) {
  return error ? <div className="form-error">{error}</div> : <div className="loading"><div className="spinner" />Cargando…</div>;
}

export const dt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const money = (n: number | string | null | undefined) => `${Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;

export function Bars({ rows, label, value }: { rows: any[]; label: (r: any) => React.ReactNode; value: (r: any) => number }) {
  const max = Math.max(1, ...rows.map(value));
  if (!rows.length) return <p className="muted small">Sin datos todavía.</p>;
  return (
    <ul className="bars">{rows.map((r, i) => (
      <li key={i} title={`${value(r)}`}><span className="name">{label(r)}</span><span className="track"><span className="fill" style={{ width: `${(value(r) / max) * 100}%` }} /></span><span className="val">{value(r).toLocaleString('es-ES')}</span></li>))}
    </ul>
  );
}
