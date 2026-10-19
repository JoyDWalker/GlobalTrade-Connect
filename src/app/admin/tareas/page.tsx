'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, Field, useToast } from '@/components/client';
import { dt, Loading, useAdmin } from '../hooks';

const TYPES: Record<string, string> = { enrich_company: 'Completar ficha (web, teléfono y correo)', fill_contacts: 'Buscar teléfono y correo de empresas sin contacto', import_wikidata: 'Importar empresas reales (Wikidata)', verify_registry: 'Consultar registro GLEIF', check_links: 'Comprobar webs', flag_stale: 'Programar actualización de fichas antiguas', detect_duplicates: 'Detectar duplicados', process_supplier_requests: 'Preparar candidatos para solicitudes', discovery: 'Descubrir empresas (búsqueda externa)', send_emails: 'Enviar emails pendientes', cleanup: 'Limpieza y retención' };

/** Importa empresas y busca contactos sin parar mientras la página esté abierta (no necesita cron). */
function ContinuousImport() {
  const [on, setOn] = useState(false);
  const [last, setLast] = useState<{ total: number; contactable: number; processed: number; failed: number } | null>(null);
  const [rounds, setRounds] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = on;
    if (!on) return;
    (async () => {
      while (active.current) {
        try { setLast(await apiFetch('/api/admin/run', { body: {} })); setRounds((n) => n + 1); setErr(null); }
        catch (e) { setErr((e as Error).message); await new Promise((r) => setTimeout(r, 15_000)); }
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();
    return () => { active.current = false; };
  }, [on]);
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <h3>Importación continua</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Mientras esta página esté abierta, importa empresas reales de todos los países (Wikidata, gratuito) y busca su teléfono y correo, sin parar. Se detiene al cerrar la página o al llegar al tope de Ajustes.</p>
      <div className="row" style={{ gap: 12 }}>
        <button className={`btn ${on ? 'btn-outline' : 'btn-primary'}`} onClick={() => setOn(!on)}>{on ? 'Detener' : 'Iniciar importación continua'}</button>
        {on && <span className="small"><span className="spinner" style={{ display: 'inline-block', width: 14, height: 14, verticalAlign: -2, marginRight: 6 }} />Trabajando… rondas: {rounds}</span>}
      </div>
      {last && <p className="small" style={{ marginBottom: 0 }}>Empresas en total: <strong>{last.total.toLocaleString('es-ES')}</strong> · con teléfono o correo: <strong>{last.contactable.toLocaleString('es-ES')}</strong> · última ronda: {last.processed} tareas{last.failed ? `, ${last.failed} con error` : ''}</p>}
      {err && <p className="form-error small">{err} (se reintenta en unos segundos)</p>}
    </div>
  );
}

export default function Page() {
  const [status, setStatus] = useState('');
  const { data, error, reload } = useAdmin<any>(`/api/admin/jobs${status ? `?status=${status}` : ''}`);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (type: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await apiFetch<any>('/api/admin/jobs', { body: { type, payload, runNow: true } });
      const p = r.run?.processed ?? [];
      toast(r.duplicate ? 'Ya hay una tarea igual en cola; se ha ejecutado la cola' : `Ejecutadas ${p.length} tareas${p.some((x: any) => !x.ok) ? ' (alguna con error)' : ''}`);
      reload();
    } catch (e) { toast((e as Error).message, { error: true }); } finally { setBusy(false); }
  };
  const jobAction = async (id: number, action: string) => { try { await apiFetch(`/api/admin/jobs/${id}`, { body: { action } }); toast('Hecho'); reload(); } catch (e) { toast((e as Error).message, { error: true }); } };
  return (
    <>
      <h1>Tareas y búsquedas</h1>
      <ContinuousImport />
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3>Búsqueda manual en fuentes externas</h3>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run('discovery', { query: String(f.get('q')), country: String(f.get('country') || '') || null, force: f.get('force') === 'on' }); }}>
          <Field label="Consulta" className="grow"><input className="input" name="q" required minLength={3} maxLength={200} placeholder="Ej.: fabricantes de válvulas industriales" /></Field>
          <Field label="País (ISO)"><input className="input" name="country" maxLength={2} style={{ width: 90 }} placeholder="ES" /></Field>
          <label className="check"><input type="checkbox" name="force" /> Ignorar caché</label>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Ejecutando…' : 'Buscar y guardar'}</button>
        </form>
        <p className="small muted">Las empresas encontradas se guardan como «detectadas» y entran en la cola de revisión. Consume cuota de las APIs.</p>
      </div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3>Ejecutar ahora</h3>
        <div className="row" style={{ gap: 6 }}>{Object.entries(TYPES).filter(([k]) => !['enrich_company', 'verify_registry', 'discovery'].includes(k)).map(([k, l]) => <button key={k} className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(k)}>{l}</button>)}</div>
        <p className="small muted">En producción se ejecutan solas mediante el cron (cada 15 min con GitHub Actions y diario con Vercel Cron).</p>
      </div>
      {!data ? <Loading error={error} /> : <>
        <h3>Resumen por tipo</h3>
        <div className="table-wrap" style={{ marginBottom: 16 }}><table className="table"><thead><tr><th>Tipo</th><th className="num">En cola</th><th className="num">En curso</th><th className="num">Fallidas</th><th className="num">Correctas</th><th>Último éxito</th></tr></thead><tbody>
          {data.summary.map((s: any) => <tr key={s.type}><td>{TYPES[s.type] ?? s.type}</td><td className="num">{s.queued}</td><td className="num">{s.running}</td><td className="num">{s.failed}</td><td className="num">{s.succeeded}</td><td>{dt(s.last_success)}</td></tr>)}</tbody></table></div>
        <div className="tabs">{['', 'queued', 'running', 'failed', 'succeeded'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{{ '': 'Todas', queued: 'En cola', running: 'En curso', failed: 'Fallidas', succeeded: 'Correctas' }[s]}</button>)}</div>
        <div className="table-wrap"><table className="table"><thead><tr><th>#</th><th>Tipo</th><th>Estado</th><th>Intentos</th><th>Programada</th><th>Fin</th><th>Resultado / error</th><th></th></tr></thead><tbody>
          {data.items.map((j: any) => <tr key={j.id}><td>{j.id}</td><td>{TYPES[j.type] ?? j.type}<div className="small muted">{JSON.stringify(j.payload).slice(0, 80)}</div></td><td>{j.status}</td><td>{j.attempts}/{j.max_attempts}</td><td className="small">{dt(j.run_at)}</td><td className="small">{dt(j.finished_at)}</td>
            <td className="small" style={{ maxWidth: 320, wordBreak: 'break-word' }}>{j.last_error ? <span style={{ color: 'var(--danger)' }}>{j.last_error}</span> : JSON.stringify(j.result)?.slice(0, 200)}</td>
            <td>{j.status === 'failed' || j.status === 'cancelled' ? <button className="btn btn-outline btn-sm" onClick={() => jobAction(j.id, 'retry')}>Reintentar</button> : j.status === 'queued' ? <button className="btn btn-ghost btn-sm" onClick={() => jobAction(j.id, 'cancel')}>Cancelar</button> : null}</td></tr>)}
        </tbody></table></div>
      </>}
    </>
  );
}
