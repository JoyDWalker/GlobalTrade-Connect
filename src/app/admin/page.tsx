'use client';
import Link from 'next/link';
import { Flag } from '@/components/ui';
import { Bars, Loading, money, useAdmin } from './hooks';

export default function AdminHome() {
  const { data, error } = useAdmin<any>('/api/admin/stats');
  if (!data) return <Loading error={error} />;
  const t = data.totals;
  const kpi = (label: string, value: number, sub?: React.ReactNode) => <div className="kpi"><div className="label">{label}</div><div className="value">{(value ?? 0).toLocaleString('es-ES')}</div>{sub && <div className="sub">{sub}</div>}</div>;
  const costToday = data.costs.reduce((a: number, c: any) => a + Number(c.cost_today), 0);
  const cost30 = data.costs.reduce((a: number, c: any) => a + Number(c.cost_30d), 0);
  return (
    <>
      <h1>Resumen</h1>
      <div className="kpis">
        {kpi('Empresas publicadas', t.published, `${t.companies} en total`)}
        {kpi('Detectadas sin revisar', t.detected, <Link href="/admin/empresas?status=detected">Revisar →</Link>)}
        {kpi('Pendientes de revisión', t.pending_review, <Link href="/admin/empresas?status=pending_review">Revisar →</Link>)}
        {kpi('Verificadas', t.verified, `${t.contrasted} contrastadas`)}
        {kpi('Tareas de revisión abiertas', t.open_tasks, <Link href="/admin/revision">Ver →</Link>)}
        {kpi('Solicitudes de contacto', t.inquiries, `${t.inquiries_new} nuevas`)}
        {kpi('Solicitudes de proveedores nuevas', t.supplier_requests_new, <Link href="/admin/solicitudes?tab=supplier-requests">Ver →</Link>)}
        {kpi('Peticiones RGPD nuevas', t.privacy_new, <Link href="/admin/solicitudes?tab=privacy">Ver →</Link>)}
        {kpi('Tareas fallidas (7 días)', t.jobs_failed_7d, <Link href="/admin/tareas?status=failed">Ver →</Link>)}
        <div className="kpi"><div className="label">Coste estimado APIs</div><div className="value">{money(costToday)}</div><div className="sub">hoy · {money(cost30)} en 30 días</div></div>
      </div>
      <div className="chart-grid">
        <div className="card card-pad"><h3>Empresas visibles por país</h3><Bars rows={data.byCountry} label={(r) => <><Flag iso={r.iso_code} url={r.flag_url} name={r.name} /> {r.name}</>} value={(r) => r.n} /></div>
        <div className="card card-pad"><h3>Empresas por sector</h3><Bars rows={data.bySector} label={(r) => r.name} value={(r) => r.n} /></div>
        <div className="card card-pad"><h3>Búsquedas (14 días)</h3><Bars rows={data.searches} label={(r) => r.day.slice(5)} value={(r) => r.n} /></div>
        <div className="card card-pad"><h3>Consultas más frecuentes (30 días)</h3>
          {data.topQueries.length ? <table className="table"><thead><tr><th>Consulta</th><th className="num">Veces</th><th className="num">Resultados medios</th></tr></thead>
            <tbody>{data.topQueries.map((q: any) => <tr key={q.query}><td><Link href={`/buscar?q=${encodeURIComponent(q.query)}`}>{q.query}</Link></td><td className="num">{q.n}</td><td className="num">{q.avg_results}</td></tr>)}</tbody></table>
            : <p className="muted small">Sin datos todavía.</p>}
          <p className="small muted">Consultas con pocos resultados son buenas candidatas para el descubrimiento automático (Ajustes).</p></div>
      </div>
    </>
  );
}
