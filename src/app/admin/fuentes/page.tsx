'use client';
import { apiFetch, useToast } from '@/components/client';
import { dt, Loading, money, useAdmin } from '../hooks';

export default function Page() {
  const { data, error, reload } = useAdmin<any>('/api/admin/sources');
  const toast = useToast();
  if (!data) return <Loading error={error} />;
  const save = async (s: any, form: HTMLFormElement) => {
    const f = new FormData(form);
    try {
      await apiFetch(`/api/admin/sources/${s.id}`, { method: 'PUT', body: { enabled: f.get('enabled') === 'on', daily_quota: f.get('daily_quota') === '' ? null : f.get('daily_quota'), cost_per_1000_usd: f.get('cost'), reliability: f.get('reliability') } });
      toast('Fuente actualizada'); reload();
    } catch (e) { toast((e as Error).message, { error: true }); }
  };
  return (
    <>
      <h1>Fuentes, cuotas y costes</h1>
      <p className="muted">Los costes son estimaciones calculadas con el precio por 1.000 peticiones configurado. Comprueba la facturación real en el panel de cada proveedor.</p>
      <div className="stack">{data.sources.map((s: any) => (
        <form key={s.id} className="card card-pad" onSubmit={(e) => { e.preventDefault(); save(s, e.currentTarget); }}>
          <div className="row"><h3 style={{ margin: 0 }}>{s.name}</h3><span className="badge">{s.kind}</span>
            {s.credentials === 'missing' && <span className="badge badge-rejected">Sin credenciales</span>}
            {s.credentials === 'configured' && <span className="badge badge-verified">Credenciales configuradas</span>}
            <span className="spacer" />
            <span className="small">Hoy: {s.requests_today} peticiones · {money(s.cost_today)} · 30 días: {s.requests_30d} (+{s.cached_30d} desde caché) · {money(s.cost_30d)} · errores {s.errors_30d}</span></div>
          {s.notes && <p className="small muted" style={{ margin: '6px 0' }}>{s.notes} {s.terms_url && <a href={s.terms_url} target="_blank" rel="noopener noreferrer">Condiciones</a>}</p>}
          {s.last_error && <p className="small" style={{ color: 'var(--danger)', margin: '4px 0' }}>Último error: {s.last_error}</p>}
          <p className="small muted" style={{ margin: '4px 0' }}>Último éxito: {dt(s.last_ok_at)}</p>
          <div className="inline-form">
            <label className="check"><input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Activa</label>
            <label className="field"><span className="small">Cuota diaria propia</span><input className="input" name="daily_quota" type="number" min={0} defaultValue={s.daily_quota ?? ''} style={{ width: 120 }} /></label>
            <label className="field"><span className="small">USD / 1.000 peticiones</span><input className="input" name="cost" type="number" min={0} step="0.01" defaultValue={s.cost_per_1000_usd} style={{ width: 120 }} /></label>
            <label className="field"><span className="small">Fiabilidad (0-100)</span><input className="input" name="reliability" type="number" min={0} max={100} defaultValue={s.reliability} style={{ width: 100 }} /></label>
            <button className="btn btn-outline btn-sm">Guardar</button>
          </div>
        </form>))}</div>
      <h3 style={{ marginTop: 24 }}>Últimas peticiones externas</h3>
      <div className="table-wrap"><table className="table"><thead><tr><th>Fecha</th><th>Fuente</th><th>Uso</th><th>Consulta</th><th>Estado</th><th className="num">ms</th><th className="num">Res.</th><th className="num">Coste</th><th>Error</th></tr></thead><tbody>
        {data.recent.map((r: any) => <tr key={r.id}><td className="small">{dt(r.created_at)}</td><td>{r.source}</td><td>{r.purpose}</td><td className="small" style={{ maxWidth: 220, wordBreak: 'break-word' }}>{r.query}</td><td>{r.status}{r.http_status ? ` (${r.http_status})` : ''}</td><td className="num">{r.duration_ms}</td><td className="num">{r.results}</td><td className="num">{money(r.cost_usd)}</td><td className="small" style={{ maxWidth: 220 }}>{r.error}</td></tr>)}
      </tbody></table></div>
    </>
  );
}
