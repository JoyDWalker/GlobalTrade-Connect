// Componentes de presentación (renderizables en servidor).
import Link from 'next/link';
import type { CompanyCard as Card } from '@/lib/services/companies';
import { Icon } from './icons';
import { FavButton, SelectBox } from './client';

export const VERIFICATION: Record<string, string> = { verified: 'Verificada', contrasted: 'Información contrastada', none: 'Sin verificar' };
export const STATUS: Record<string, string> = { detected: 'Detectada · sin revisar', pending_review: 'Pendiente de revisión', published: 'Publicada', hidden: 'Oculta', rejected: 'Rechazada' };

export function Flag({ iso, url, name }: { iso: string | null; url?: string | null; name?: string | null }) {
  if (!iso) return null;
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img className="flag" src={url} alt="" title={name ?? iso} />;
  return <span className="flag-iso" title={name ?? iso}>{iso}</span>;
}

const CAT_CLASS = ['cafe', 'chocolate', 'aceite'];
export function catClass(sectors: { slug: string }[]) {
  const s = sectors.find((x) => CAT_CLASS.some((c) => x.slug.startsWith(c) || x.slug === 'aove' || x.slug === 'cacao'));
  if (!s) return '';
  if (s.slug.startsWith('cafe') || s.slug === 'capsulas') return 'cat-cafe';
  if (s.slug.startsWith('aceite') || s.slug === 'aove' || s.slug === 'otros-aceites') return 'cat-aceite';
  return 'cat-chocolate';
}

export function Logo({ name, url, sectors = [], large = false }: { name: string; url?: string | null; sectors?: { slug: string }[]; large?: boolean }) {
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter((w) => w.length > 2 || /^\p{Lu}/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';
  const safe = url && /^(https:\/\/|\/)/.test(url) ? url : null;
  return (
    <div className={`logo ${large ? 'logo-lg' : ''} ${catClass(sectors)}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {safe ? <img src={safe} alt="" referrerPolicy="no-referrer" /> : initials}
    </div>
  );
}

export function VerificationBadge({ level }: { level: string }) {
  const cls = level === 'verified' ? 'badge-verified' : level === 'contrasted' ? 'badge-contrasted' : 'badge-unverified';
  return <span className={`badge ${cls}`} title={level === 'verified' ? 'Verificada mediante el procedimiento documentado' : level === 'contrasted' ? 'Datos clave coinciden en al menos dos fuentes independientes' : 'Datos sin contrastar'}>
    {level !== 'none' && <Icon name="check" />}{VERIFICATION[level] ?? level}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const cls = { published: 'badge-verified', pending_review: 'badge-pending', rejected: 'badge-rejected', detected: 'badge-detected', hidden: 'badge-hidden' }[status] ?? '';
  return <span className={`badge ${cls}`}>{STATUS[status] ?? status}</span>;
}

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Señales de que la empresa existe y se puede contactar. */
export function Signals({ c }: { c: Pick<Card, 'sig_registry' | 'sig_website' | 'sig_maps' | 'email' | 'phone'> }) {
  const items: [boolean, string, string][] = [
    [c.sig_registry, 'Registro oficial', 'Inscrita y activa en un registro oficial (GLEIF) o verificada por el equipo'],
    [c.sig_website, 'Web activa', 'Su web responde (comprobada por el sistema)'],
    [c.sig_maps, 'Google Maps', 'Tiene ficha de negocio en Google Maps'],
    [Boolean(c.phone || c.email), 'Contactable', 'Tiene teléfono o correo públicos'],
  ];
  const n = items.filter(([ok]) => ok).length;
  return (
    <div className="signals" title={`${n} de ${items.length} señales`}>
      <span className={`signals-score ${n >= 3 ? 'ok' : n === 2 ? 'mid' : 'low'}`}>{n >= 3 ? 'Comprobada' : n === 2 ? 'Probable' : 'Sin comprobar'}</span>
      {items.map(([ok, label, title]) => <span key={label} className={`signal ${ok ? 'on' : ''}`} title={title}>{ok ? '✓' : '·'} {label}</span>)}
    </div>
  );
}

export function CompanyCard({ c, selectable = false }: { c: Card; selectable?: boolean }) {
  return (
    <article className="card company-card" data-id={c.id}>
      {selectable && <SelectBox id={c.id} name={c.name} />}
      <div className="top">
        <Logo name={c.name} url={c.logo_url} sectors={c.sectors} />
        <div className="meta">
          <h3><Link href={`/empresa/${c.slug}`}>{c.name}</Link></h3>
          <div className="loc"><Flag iso={c.country_code} url={c.flag_url} name={c.country_name} /> {[c.city, c.region].filter(Boolean).join(', ') || c.country_name}{c.city && c.country_name ? ` · ${c.country_name}` : ''}</div>
        </div>
      </div>
      <div className="tags">
        {c.sectors.slice(0, 3).map((s) => <span key={s.slug} className={`chip chip-cat ${catClass([s])}`}>{s.name}</span>)}
        {c.type_names.slice(0, 2).map((t) => <span key={t} className="chip chip-outline">{t}</span>)}
      </div>
      {c.excerpt && <p className="excerpt">{c.excerpt}</p>}
      <div className="card-contact">
        <div className="contact-line"><Icon name="globe" />{c.website && /^https?:\/\//i.test(c.website)
          ? <a className="grow" href={c.website} target="_blank" rel="noopener noreferrer nofollow">{c.website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')}</a>
          : <span className="grow muted">Sin página web</span>}</div>
        <div className="contact-line"><Icon name="mail" />{c.email ? <a className="grow" href={`mailto:${c.email}`}>{c.email}</a> : <span className="grow muted">Sin correo electrónico</span>}</div>
        <div className="contact-line"><Icon name="phone" />{c.phone ? <a className="grow" href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a> : <span className="grow muted">Sin teléfono</span>}</div>
      </div>
      <Signals c={c} />
      <div className="tags">
        {c.record_status === 'detected' ? <span className="badge badge-detected" title="Encontrada automáticamente en una fuente externa; datos no revisados">Detectada · sin revisar</span> : <VerificationBadge level={c.verification_level} />}
        {c.is_featured && <span className="badge badge-featured">Destacada</span>}
        {c.certifications.slice(0, 3).map((k) => <span key={k} className="badge">{k}</span>)}
        {c.certifications.length > 3 && <span className="badge">+{c.certifications.length - 3}</span>}
        {c.is_demo && <span className="badge badge-demo" title="Datos ficticios de demostración">DEMO</span>}
      </div>
      <div className="foot">
        <Link className="btn btn-primary btn-sm" href={`/empresa/${c.slug}`}>Ver ficha</Link>
        <span className="small muted" title="Última comprobación de los datos">{c.last_checked_at ? `Revisado ${fmtDate(c.last_checked_at)}` : ''}</span>
        <span className="spacer" />
        <FavButton id={c.id} />
      </div>
    </article>
  );
}

export function Empty({ title, children, icon = 'search' }: { title: string; children?: React.ReactNode; icon?: string }) {
  return <div className="card empty"><Icon name={icon} /><h3>{title}</h3>{children}</div>;
}

export { fmtDate };
