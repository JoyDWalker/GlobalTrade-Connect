import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb, many } from '@/lib/db';
import { canManageCompany, getSessionUser } from '@/lib/auth/session';
import { companyCards, companyDetail, isPubliclyVisible } from '@/lib/services/companies';
import { safeUrl } from '@/lib/text';
import { CompanyCard, Flag, fmtDate, Logo, StatusBadge, VerificationBadge } from '@/components/ui';
import { Icon } from '@/components/icons';
import { CompanyActions, ContactCard, ReportLink } from './company-client';
import { FollowupPanel } from '@/components/followup';

type Params = Promise<{ slug: string }>;

async function load(slug: string) {
  const user = await getSessionUser();
  const c = await companyDetail(getDb(), { slug }, { privateView: false });
  if (!c || (!isPubliclyVisible(c as any) && !canManageCompany(user, c.id))) return null;
  return { c, user };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const r = await load((await params).slug);
  if (!r) return { title: 'Empresa no encontrada' };
  return { title: r.c.name, description: (r.c.description ?? r.c.main_activity ?? '').slice(0, 160), robots: r.c.record_status === 'published' ? undefined : { index: false } };
}

const FIELD_LABEL: Record<string, string> = { name: 'Nombre', legal_name: 'Razón social', website: 'Web', country_code: 'País', description: 'Descripción', email: 'Email', phone: 'Teléfono',
  address: 'Dirección', city: 'Ciudad', region: 'Región', postal_code: 'Código postal', logo_url: 'Logo', lei: 'LEI', registry_status: 'Estado en registro', registry_address: 'Dirección en registro' };
const PROV_STATUS: Record<string, string> = { detected: 'detectado', pending_review: 'pendiente de revisión', confirmed: 'confirmado', rejected: 'descartado' };
const KIND: Record<string, string> = { search_api: 'Buscador', registry: 'Registro oficial', website: 'Web oficial', directory: 'Directorio', manual: 'Equipo', self_registered: 'Declarado por la empresa' };

export default async function CompanyPage({ params }: { params: Params }) {
  const r = await load((await params).slug);
  if (!r) notFound();
  const { c, user } = r;
  const db = getDb();
  const related = await companyCards(db, (await many<{ id: string }>(db, `SELECT DISTINCT c2.id, c2.verification_level FROM companies c2 JOIN company_categories x ON x.company_id = c2.id
    WHERE c2.deleted_at IS NULL AND c2.record_status = 'published' AND c2.id <> $1 AND x.category_id IN (SELECT category_id FROM company_categories WHERE company_id = $1)
    ORDER BY c2.verification_level DESC LIMIT 3`, [c.id])).map((x) => x.id));
  const sectors = c.categories.filter((k: any) => k.parent_id);
  const site = safeUrl(c.website);
  const social = Object.entries((c.social ?? {}) as Record<string, string>).filter(([, v]) => safeUrl(v));
  const products = c.offerings.filter((o: any) => o.kind === 'product');
  const services = c.offerings.filter((o: any) => o.kind === 'service');
  const publicEmail = c.email || c.contacts.find((k: any) => k.email)?.email || null;
  const isDetected = c.record_status === 'detected';

  return (
    <div className="wrap">
      <nav className="breadcrumb" aria-label="Ruta"><Link href="/">Inicio</Link> › <Link href="/buscar">Empresas</Link>
        {c.country_code && <> › <Link href={`/buscar?country=${c.country_code}`}>{c.country_name}</Link></>} › <span>{c.name}</span></nav>

      {c.record_status !== 'published' && !isDetected && <div className="notice notice-warn" style={{ marginTop: 12 }}>Ficha no pública: <StatusBadge status={c.record_status} /> Solo la ven sus titulares y el equipo.</div>}
      {isDetected && <div className="notice notice-info" style={{ marginTop: 12 }}><strong>Empresa detectada automáticamente.</strong> Hemos encontrado esta empresa en una fuente pública. Sus datos no han sido revisados ni confirmados por la empresa: compruébalos antes de hacer negocios. ¿Es tu empresa? Puedes reclamar la ficha.</div>}
      {c.is_demo && <div className="notice notice-info" style={{ marginTop: 12 }}><strong>Empresa ficticia de demostración.</strong> Usa dominios .example y teléfonos no asignables.</div>}

      <div className="card profile-head">
        <Logo name={c.name} url={c.logo_url} sectors={sectors} large />
        <div className="info">
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            {isDetected ? <span className="badge badge-detected">Detectada · sin revisar</span> : <VerificationBadge level={c.verification_level} />}
            {c.is_featured && <span className="badge badge-featured">Destacada</span>}
            {c.is_demo && <span className="badge badge-demo">DEMO</span>}
          </div>
          <h1>{c.name}</h1>
          {c.legal_name && c.legal_name !== c.name && <p className="muted" style={{ margin: '-4px 0 6px' }}>Razón social: {c.legal_name}</p>}
          <div className="meta-line">
            {c.country_code && <span><Flag iso={c.country_code} url={c.flag_url} name={c.country_name} /> {[c.city, c.region].filter(Boolean).join(', ')}{c.city || c.region ? ' · ' : ''}{c.country_name}</span>}
            {c.type_names.length > 0 && <span><Icon name="building" /> {c.type_names.map((t: any) => t.name).join(' · ')}</span>}
            {c.year_founded && <span><Icon name="calendar" /> Fundada en {c.year_founded}</span>}
          </div>
          {sectors.length > 0 && <div className="row" style={{ gap: 6, marginTop: 10 }}>{sectors.map((k: any) => <Link key={k.slug} className="chip chip-outline" href={`/buscar?category=${k.slug}`}>{k.name}</Link>)}</div>}
          <CompanyActions company={{ id: c.id, slug: c.slug, name: c.name, products: c.offerings.map((o: any) => o.name) }} publicEmail={publicEmail} detected={isDetected} />
        </div>
      </div>

      <div className="profile-layout">
        <div>
          <section className="card"><h2>Sobre la empresa</h2>
            {c.description ? <p style={{ whiteSpace: 'pre-line' }}>{c.description}</p> : <p className="muted">Sin descripción{isDetected && c.sources[0]?.snippet ? '. Extracto de la fuente: ' : '.'}{isDetected && c.sources[0]?.snippet && <em>«{c.sources[0].snippet}»</em>}</p>}
            {c.main_activity && <p><strong>Actividad principal:</strong> {c.main_activity}</p>}
            {c.keywords?.length > 0 && <div className="row" style={{ gap: 6 }}>{c.keywords.map((k: string) => <Link key={k} className="chip chip-outline" href={`/buscar?q=${encodeURIComponent(k)}`}>{k}</Link>)}</div>}
          </section>
          {(products.length > 0 || services.length > 0) && <section className="card"><h2>Productos y servicios</h2>
            {[['Productos', products], ['Servicios', services]].map(([label, list]: any) => list.length > 0 && (
              <div key={label} style={{ marginBottom: 12 }}><h3>{label}</h3>
                <ul className="product-list">{list.map((o: any) => <li key={o.name}><span>{o.name}{o.description ? <span className="muted small"> · {o.description}</span> : null}</span>{o.hs_code && <span className="hs" title="Código arancelario SA">SA {o.hs_code}</span>}</li>)}</ul></div>))}
          </section>}
          {c.certifications.length > 0 && <section className="card"><h2>Certificaciones declaradas</h2>
            <div className="row" style={{ gap: 6 }}>{c.certifications.map((k: any) => <Link key={k.slug} className="badge" href={`/buscar?cert=${k.slug}`}>{k.name}</Link>)}</div>
            <p className="provenance" style={{ marginTop: 8 }}>Las certificaciones las declara la empresa; solicita el certificado vigente antes de comprar.</p>
          </section>}
          {(c.export_markets.length > 0 || c.import_markets.length > 0) && <section className="card"><h2>Mercados</h2>
            {c.export_markets.length > 0 && <><h3>Exporta a</h3><div className="markets">{c.export_markets.map((m: any) => <span key={m.iso_code} className="chip chip-outline"><Flag iso={m.iso_code} url={m.flag_url} name={m.name} /> {m.name}</span>)}</div></>}
            {c.import_markets.length > 0 && <><h3 style={{ marginTop: 16 }}>Importa desde</h3><div className="markets">{c.import_markets.map((m: any) => <span key={m.iso_code} className="chip chip-outline"><Flag iso={m.iso_code} url={m.flag_url} name={m.name} /> {m.name}</span>)}</div></>}
          </section>}
          {(c.export_capacity_tons || c.production_capacity || c.minimum_order_kg || c.commercial_terms || c.client_types.length || c.languages.length) ? <section className="card"><h2>Capacidad y condiciones comerciales</h2><dl className="kv">
            <dt>Capacidad de exportación</dt><dd>{c.export_capacity_tons ? `${Number(c.export_capacity_tons).toLocaleString('es-ES')} t/año` : 'No indicada'}</dd>
            <dt>Capacidad de producción</dt><dd>{c.production_capacity ?? 'No indicada'}</dd>
            <dt>Pedido mínimo</dt><dd>{c.minimum_order_kg ? `${Number(c.minimum_order_kg).toLocaleString('es-ES')} kg` : 'No indicado'}{c.minimum_order_notes ? <span className="muted"> · {c.minimum_order_notes}</span> : null}</dd>
            <dt>Condiciones</dt><dd>{c.commercial_terms ?? 'A consultar'}</dd>
            <dt>Clientes atendidos</dt><dd>{c.client_types.map((t: any) => t.name).join(', ') || '—'}</dd>
            <dt>Idiomas de atención</dt><dd>{c.languages.map((l: any) => l.name).join(', ') || '—'}</dd>
          </dl></section> : null}

          <section className="card" id="procedencia"><h2><Icon name="database" /> Procedencia y verificación</h2>
            <dl className="kv" style={{ marginBottom: 16 }}>
              <dt>Estado</dt><dd>{isDetected ? 'Detectada automáticamente, sin revisar' : c.record_status === 'published' ? 'Publicada tras revisión' : c.record_status}</dd>
              <dt>Verificación</dt><dd><VerificationBadge level={c.verification_level} />{c.verification_method && <span className="small muted"> · {c.verification_method}</span>}{c.verified_at && <span className="small muted"> · {fmtDate(c.verified_at)}</span>}</dd>
              <dt>Datos recopilados</dt><dd>{fmtDate(c.data_collected_at)}</dd>
              <dt>Última comprobación</dt><dd>{fmtDate(c.last_checked_at)}{c.website_status !== 'unknown' && <span className="small muted"> · web: {{ ok: 'accesible', redirect: 'redirige a otro dominio', broken: 'no accesible', blocked: 'no rastreable' }[c.website_status as string]}</span>}</dd>
              {c.lei && <><dt>LEI</dt><dd><a href={`https://search.gleif.org/#/record/${c.lei}`} target="_blank" rel="noopener noreferrer">{c.lei}</a></dd></>}
            </dl>
            <h3>Fuentes</h3>
            {c.sources.length ? <ul className="source-list">{c.sources.map((s: any) => (
              <li key={`${s.key}-${s.source_url}`}><strong>{s.name}</strong> <span className="muted small">({KIND[s.kind] ?? s.kind})</span><br />
                {safeUrl(s.source_url) && <a className="small" href={safeUrl(s.source_url)!} target="_blank" rel="noopener noreferrer nofollow">{s.source_url}</a>}
                <div className="provenance">Visto por primera vez {fmtDate(s.first_seen_at)} · última vez {fmtDate(s.last_seen_at)}</div></li>))}</ul> : <p className="muted small">Sin fuentes registradas.</p>}
            {c.provenance.length > 0 && <>
              <h3 style={{ marginTop: 16 }}>Datos y su origen</h3>
              <div className="table-wrap"><table className="table"><thead><tr><th>Dato</th><th>Valor</th><th>Fuente</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>
                {c.provenance.slice(0, 30).map((p: any, i: number) => (
                  <tr key={i}><td>{FIELD_LABEL[p.field] ?? p.field}</td><td style={{ maxWidth: 260, wordBreak: 'break-word' }}>{String(p.value ?? '').slice(0, 140)}</td>
                    <td>{p.source_name ?? '—'}</td><td>{PROV_STATUS[p.status] ?? p.status}</td><td>{fmtDate(p.collected_at)}</td></tr>))}
              </tbody></table></div></>}
            {c.verifications.length > 0 && <>
              <h3 style={{ marginTop: 16 }}>Comprobaciones</h3>
              <ul className="source-list">{c.verifications.slice(0, 5).map((v: any, i: number) => <li key={i}>{{ registry_lookup: 'Consulta en registro oficial', link_check: 'Comprobación de la web', manual_review: 'Revisión del equipo' }[v.kind as string] ?? v.kind}: <strong>{{ match: 'coincide', partial: 'coincidencia parcial', no_match: 'sin coincidencias', ok: 'correcta', error: 'error', info: 'información' }[v.result as string]}</strong> <span className="provenance">· {v.source_name ?? 'equipo'} · {fmtDate(v.created_at)}</span></li>)}</ul></>}
            <p className="provenance" style={{ marginTop: 12 }}>Que una empresa tenga web o aparezca en una fuente pública no demuestra por sí solo que esté legalmente registrada o activa. <Link href="/fuentes#verificacion">Cómo verificamos</Link>.</p>
          </section>
        </div>

        <aside>
          <ContactCard company={{ id: c.id, slug: c.slug, name: c.name, products: c.offerings.map((o: any) => o.name) }} contacts={c.contacts} email={c.email} phone={c.phone} website={site} social={social} hasPrivate={c.has_private_contacts} detected={isDetected} />
          {user?.role === 'admin' && <FollowupPanel companyId={c.id} name={c.name} city={c.city} country={c.country_name} />}
          <div className="card card-pad">
            <h3>Ubicación y cobertura</h3>
            <div className="contact-line"><Icon name="pin" /><span className="grow">{c.address ?? c.city ?? '—'}<br /><span className="muted small">{[c.postal_code, c.city, c.region, c.country_name].filter(Boolean).join(', ')}</span></span></div>
            {c.coverage_area && <div className="contact-line"><Icon name="ship" /><span className="grow">{c.coverage_area}</span></div>}
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>Actualizada el {fmtDate(c.updated_at)} · <ReportLink slug={c.slug} name={c.name} /></p>
        </aside>
      </div>
      {related.length > 0 && <section style={{ marginBottom: 48 }}><h2>Empresas similares</h2><div className="cards">{related.map((x) => <CompanyCard key={x.id} c={x} />)}</div></section>}
    </div>
  );
}
