import Link from 'next/link';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { getMeta } from '@/lib/meta';
import { hashIp } from '@/lib/text';
import { performSearch } from '@/lib/search';
import { RateLimitError } from '@/lib/rate-limit';
import { searchParamsFromUrl } from '@/lib/validation';
import { getSessionUser } from '@/lib/auth/session';
import { CompanyCard, Empty } from '@/components/ui';
import { SelectionProvider } from '@/components/client';
import { ExternalOnDemand, ExternalResults, ExportBar, Filters, SearchBar } from './search-client';

export const metadata: Metadata = { title: 'Buscar empresas' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const raw = await searchParams;
  const p = searchParamsFromUrl(raw);
  const db = getDb();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  const [meta, user] = await Promise.all([getMeta(db), getSessionUser()]);
  let result: Awaited<ReturnType<typeof performSearch>> | null = null;
  let limited = false;
  try {
    result = await performSearch(db, p, { user, ipHash: hashIp(ip, env().APP_SECRET) });
  } catch (e) {
    if (e instanceof RateLimitError) limited = true; else throw e;
  }
  const qs = (patch: Record<string, string | number | null>) => {
    const u = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (v == null ? [] : [[k, Array.isArray(v) ? v.join(',') : v]])));
    for (const [k, v] of Object.entries(patch)) if (v == null || v === '') u.delete(k); else u.set(k, String(v));
    return `/buscar?${u}`;
  };
  const exportQs = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (v == null || k === 'page' ? [] : [[k, Array.isArray(v) ? v.join(',') : v]])));

  return (
    <SelectionProvider>
      <div className="wrap search-layout">
        <Filters meta={meta} />
        <section aria-label="Resultados">
          <SearchBar initialQ={p.q} sort={p.sort} />
          {limited || !result ? (
            <Empty title="Has hecho muchas búsquedas en poco tiempo" icon="clock"><p>Espera unos minutos e inténtalo de nuevo. {user ? '' : 'Con una cuenta tienes un límite mayor.'}</p></Empty>
          ) : (
            <>
              {p.q && (result.interpreted.countries.length > 0 || result.interpreted.types.length > 0) && (
                <p className="small muted" style={{ margin: '0 0 8px' }}>
                  Interpretado como: {result.interpreted.terms.length ? <>«{result.interpreted.terms.join(' ')}»</> : 'cualquier producto'}
                  {result.interpreted.types.length > 0 && <> · tipo: {result.interpreted.types.map((t) => meta.business_types.find((b) => b.slug === t)?.name ?? t).join(', ')}</>}
                  {result.interpreted.countries.length > 0 && <> · país: {result.interpreted.countries.map((c) => meta.countries.find((x) => x.iso_code === c)?.name ?? c).join(', ')}</>}
                </p>
              )}
              <ExportBar total={result.total} exportQuery={exportQs.toString()} pageIds={result.items.map((c) => c.id)} />
              {result.items.length ? (
                <div className="cards">{result.items.map((c) => <CompanyCard key={c.id} c={c} selectable />)}</div>
              ) : (
                <Empty title="No hay empresas guardadas que coincidan">
                  <p>{result.suggestExternal ? 'Estamos consultando fuentes externas…' : 'Prueba con términos más generales, quita algún filtro o pide ayuda a nuestro equipo.'}</p>
                  <Link className="btn btn-primary" href={`/solicitar-proveedores?product=${encodeURIComponent(p.q)}`}>Solicitar proveedores</Link>
                </Empty>
              )}
              {result.pages > 1 && (
                <nav className="pagination" aria-label="Paginación">
                  {result.page > 1 && <Link className="btn btn-outline btn-sm" href={qs({ page: result.page - 1 })}>‹ Anterior</Link>}
                  <span className="small muted" style={{ alignSelf: 'center' }}>Página {result.page} de {result.pages}</span>
                  {result.page < result.pages && <Link className="btn btn-outline btn-sm" href={qs({ page: result.page + 1 })}>Siguiente ›</Link>}
                </nav>
              )}
              {result.suggestExternal && <ExternalResults q={p.q} country={p.country[0] ?? null} searchId={result.searchId} />}
              {!result.suggestExternal && result.canExternal && <ExternalOnDemand q={p.q} country={p.country[0] ?? null} searchId={result.searchId} />}
              {!result.suggestExternal && p.q && result.total > 0 && result.total < 6 && (
                <p className="small muted" style={{ marginTop: 16 }}>¿No encuentras lo que buscas? <Link href={`/solicitar-proveedores?product=${encodeURIComponent(p.q)}`}>Pide ayuda a nuestro equipo</Link>.</p>
              )}
            </>
          )}
        </section>
      </div>
    </SelectionProvider>
  );
}
