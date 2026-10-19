'use client';
import { apiFetch, useToast } from '@/components/client';
import { Loading, useAdmin } from '../hooks';

const LABELS: Record<string, [string, Record<string, string>]> = {
  external_search: ['Búsqueda externa', { enabled: 'Activada', min_internal_results: 'Consultar fuera si hay menos de N resultados propios', max_results_per_source: 'Resultados máximos por fuente', cache_hours: 'Caché (horas)', timeout_ms: 'Tiempo máximo por fuente (ms)', ai_expansion: 'Ampliar la búsqueda con IA (sector y términos relacionados)', max_queries: 'Consultas generadas por búsqueda (máx. 10)', admins_only: 'Solo administradores pueden lanzar búsquedas externas' }],
  limits: ['Límites de uso', { searches_per_hour_anon: 'Búsquedas/hora (visitante)', searches_per_hour_user: 'Búsquedas/hora (usuario)', external_per_day_anon: 'Búsquedas externas/día (visitante)', external_per_day_user: 'Búsquedas externas/día (usuario)', daily_budget_usd: 'Presupuesto diario de APIs (USD)' }],
  worker: ['Worker', { batch_size: 'Tamaño de lote', time_budget_ms: 'Tiempo por ejecución (ms, ≤ 55.000 en Vercel)', stale_after_days: 'Actualizar fichas con más de N días', link_check_after_days: 'Comprobar webs cada N días', stuck_after_minutes: 'Recuperar tareas atascadas tras N min', concurrency: 'Webs visitadas en paralelo' }],
};

export default function Page() {
  const { data, error, reload } = useAdmin<any>('/api/admin/settings');
  const toast = useToast();
  if (!data) return <Loading error={error} />;
  const save = async (key: string, value: unknown) => {
    try { await apiFetch('/api/admin/settings', { method: 'PUT', body: { key, value } }); toast('Ajustes guardados'); reload(); } catch (e) { toast((e as Error).message, { error: true }); }
  };
  return (
    <>
      <h1>Ajustes</h1>
      {Object.entries(LABELS).map(([key, [title, fields]]) => (
        <form key={key} className="card form-card" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save(key, Object.fromEntries(Object.keys(fields).map((k) => [k, typeof data[key][k] === 'boolean' ? f.get(k) === 'on' : Number(f.get(k))])));
        }}>
          <h2>{title}</h2>
          <div className="form-grid">{Object.entries(fields).map(([k, label]) => typeof data[key][k] === 'boolean'
            ? <label key={k} className="check"><input type="checkbox" name={k} defaultChecked={data[key][k]} /> {label}</label>
            : <label key={k} className="field"><span className="label">{label}</span><input className="input" type="number" step="any" name={k} defaultValue={data[key][k]} /></label>)}</div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn btn-primary">Guardar</button></div>
        </form>))}
      <form className="card form-card" onSubmit={(e) => { e.preventDefault(); save('discovery_queries', String(new FormData(e.currentTarget).get('q')).split('\n').map((s) => s.trim()).filter(Boolean)); }}>
        <h2>Consultas de descubrimiento</h2>
        <p className="small muted">Una por línea. El worker las ejecuta una vez al día (máx. 5 por ejecución) y guarda las empresas encontradas como «detectadas». Cada consulta consume cuota de las APIs.</p>
        <textarea className="input" name="q" rows={6} defaultValue={(data.discovery_queries ?? []).join('\n')} placeholder={'exportadores de café Colombia\nfabricantes de envases compostables México'} />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn btn-primary">Guardar</button></div>
      </form>
    </>
  );
}
