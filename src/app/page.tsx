import Link from 'next/link';
import { connection } from 'next/server';
import { getDb, many, one } from '@/lib/db';
import { getMeta } from '@/lib/meta';
import { companyCards } from '@/lib/services/companies';
import { CompanyCard, Flag } from '@/components/ui';
import { Icon } from '@/components/icons';

export default async function Home() {
  await connection();
  const db = getDb();
  const meta = await getMeta(db);
  const ids = async (sql: string) => (await many<{ id: string }>(db, sql)).map((r) => r.id);
  const [featured, latest, stats] = await Promise.all([
    ids("SELECT id FROM companies WHERE deleted_at IS NULL AND record_status = 'published' AND is_featured ORDER BY verification_level = 'verified' DESC, name LIMIT 6").then((x) => companyCards(db, x)),
    ids("SELECT id FROM companies WHERE deleted_at IS NULL AND record_status = 'published' ORDER BY created_at DESC LIMIT 6").then((x) => companyCards(db, x)),
    one<{ companies: number; verified: number; countries: number }>(db, `SELECT count(*)::int AS companies, count(*) FILTER (WHERE verification_level = 'verified')::int AS verified,
      count(DISTINCT country_code)::int AS countries FROM companies WHERE deleted_at IS NULL AND record_status IN ('published', 'detected')`),
  ]);
  const roots = meta.categories.filter((c) => !c.parent_id);
  const sectors = meta.categories.filter((c) => roots.some((r) => r.id === c.parent_id));
  const withCompanies = meta.countries.filter((c) => c.company_count > 0).slice(0, 12);

  return (
    <>
      <section className="hero"><div className="wrap">
        <h1>Encuentra empresas y proveedores de cualquier sector, en cualquier país</h1>
        <p className="lead">Fabricantes, exportadores, importadores, distribuidores, mayoristas y prestadores de servicios. Escribe lo que necesitas con tus palabras.</p>
        <form className="hero-search" action="/buscar" role="search">
          <label className="sr-only" htmlFor="hq">Qué buscas</label>
          <input className="input" id="hq" name="q" placeholder="Ej.: fabricantes de envases compostables en México" autoComplete="off" maxLength={200} />
          <label className="sr-only" htmlFor="hc">País</label>
          <select className="input" id="hc" name="country" defaultValue="">
            <option value="">Cualquier país</option>
            {meta.countries.map((c) => <option key={c.iso_code} value={c.iso_code}>{c.name}</option>)}
          </select>
          <button className="btn btn-accent btn-lg" type="submit"><Icon name="search" /> Buscar</button>
        </form>
        <div className="quick" aria-label="Búsquedas rápidas">
          {[['Fabricantes', 'type=fabricante'], ['Exportadores', 'type=exportador'], ['Importadores', 'type=importador'], ['Distribuidores', 'type=distribuidor'],
            ['OEM / marca blanca', 'type=oem,marca-blanca'], ['Logística', 'category=logistica'], ['Software', 'category=software'], ['Café', 'category=cafe'], ['Aceite de oliva', 'category=aove']].map(([l, q]) => (
            <Link key={l} href={`/buscar?${q}`}>{l}</Link>))}
        </div>
        <div className="hero-stats">
          <div><strong>{stats?.companies ?? 0}</strong><span>empresas en el directorio</span></div>
          <div><strong>{stats?.verified ?? 0}</strong><span>verificadas</span></div>
          <div><strong>{stats?.countries ?? 0}</strong><span>países con empresas</span></div>
        </div>
      </div></section>

      {withCompanies.length > 0 && <section className="section"><div className="wrap">
        <div className="section-head"><div><h2>Explora por país</h2><p>Cobertura mundial; se muestran los países con más empresas</p></div><Link href="/buscar">Ver todos →</Link></div>
        <div className="country-grid">
          {withCompanies.slice(0, 12).map((c) => (
            <Link key={c.iso_code} className="country-card" href={`/buscar?country=${c.iso_code}`}>
              <Flag iso={c.iso_code} url={c.flag_url} name={c.name} /><strong>{c.name}</strong><span className="muted small">{c.company_count} empresas</span>
            </Link>))}
        </div>
      </div></section>}

      <section className="section" style={{ paddingTop: 0 }}><div className="wrap">
        <div className="section-head"><div><h2>Sectores</h2><p>Un punto de partida: la búsqueda acepta cualquier producto o servicio</p></div></div>
        <div className="cat-grid">
          {roots.map((r) => (
            <div key={r.id} className="cat-card" style={{ ['--cat' as string]: 'var(--primary)' }}>
              <h3><Link href={`/buscar?category=${r.slug}`} style={{ color: 'inherit' }}>{r.name}</Link><span className="muted small">{r.company_count}</span></h3>
              <div className="row" style={{ gap: 6 }}>{sectors.filter((s) => s.parent_id === r.id).map((s) => <Link key={s.id} className="chip chip-outline" href={`/buscar?category=${s.slug}`}>{s.name}</Link>)}</div>
            </div>))}
        </div>
      </div></section>

      {featured.length > 0 && <section className="section" style={{ paddingTop: 0 }}><div className="wrap">
        <div className="section-head"><div><h2>Empresas destacadas</h2></div><Link href="/buscar?featured=1">Ver destacadas →</Link></div>
        <div className="cards">{featured.map((c) => <CompanyCard key={c.id} c={c} />)}</div>
      </div></section>}

      {latest.length > 0 && <section className="section" style={{ paddingTop: 0 }}><div className="wrap">
        <div className="section-head"><div><h2>Últimas empresas añadidas</h2></div><Link href="/buscar?sort=newest">Ver novedades →</Link></div>
        <div className="cards">{latest.map((c) => <CompanyCard key={c.id} c={c} />)}</div>
      </div></section>}

      <section className="section" style={{ paddingTop: 0 }}><div className="wrap cta-band">
        <div className="cta"><h2>Registra tu empresa</h2><p>Llega a compradores profesionales de todo el mundo. El alta es gratuita y revisamos cada ficha antes de publicarla.</p>
          <Link className="btn btn-accent" href="/registrar">Dar de alta mi empresa</Link></div>
        <div className="cta alt"><h2>Solicita proveedores</h2><p>Cuéntanos qué producto o servicio, volumen y certificaciones necesitas y te ayudamos a encontrar proveedores.</p>
          <Link className="btn btn-outline" href="/solicitar-proveedores">Enviar solicitud</Link></div>
      </div></section>
    </>
  );
}
