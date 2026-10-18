import { api, fileResponse, HttpError, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { getSessionUser } from '@/lib/auth/session';
import { performSearch } from '@/lib/search';
import { exportColumns, exportRows, searchCompanies } from '@/lib/services/companies';
import { searchParamsFromUrl, searchParamsSchema } from '@/lib/validation';
import { toCSV, toXLSX, XLSX_TYPE } from '@/lib/export';
import { hit } from '@/lib/rate-limit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
const stamp = () => new Date().toISOString().slice(0, 10);

/** Búsqueda pública. ?format=csv|xlsx exporta el resultado (máx. 500, solo datos públicos). */
export const GET = api(async ({ req, ipHash }) => {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const user = await getSessionUser();
  const format = sp.get('format');
  if (format === 'csv' || format === 'xlsx') {
    await hit(db, `export:${user?.id ?? ipHash}`, 20, 3600);
    const p = searchParamsSchema.parse({ ...searchParamsFromUrl(sp), page: 1, pageSize: 50 });
    const ids: string[] = [];
    for (let page = 1; page <= 10 && ids.length < 500; page++) {
      const r = await searchCompanies(db, { ...p, page });
      ids.push(...r.items.map((c) => c.id));
      if (page >= r.pages) break;
    }
    const rows = await exportRows(db, ids, env().NEXT_PUBLIC_SITE_URL);
    return format === 'xlsx'
      ? fileResponse(toXLSX(rows, exportColumns(false), 'Empresas'), `empresas-${stamp()}.xlsx`, XLSX_TYPE)
      : fileResponse(toCSV(rows, exportColumns(false)), `empresas-${stamp()}.csv`, 'text/csv; charset=utf-8');
  }
  return performSearch(db, searchParamsFromUrl(sp), { user, ipHash });
});

/** Exportación de una selección concreta de empresas visibles. */
export const POST = api(async ({ req, ipHash }) => {
  const db = getDb();
  const user = await getSessionUser();
  await hit(db, `export:${user?.id ?? ipHash}`, 20, 3600);
  const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), format: z.enum(['csv', 'xlsx']).default('csv') }).parse(await readJson(req));
  const rows = await exportRows(db, body.ids, env().NEXT_PUBLIC_SITE_URL);
  if (!rows.length) throw new HttpError(404, 'No hay empresas exportables en la selección');
  return body.format === 'xlsx'
    ? fileResponse(toXLSX(rows, exportColumns(false), 'Empresas'), `empresas-seleccion-${stamp()}.xlsx`, XLSX_TYPE)
    : fileResponse(toCSV(rows, exportColumns(false)), `empresas-seleccion-${stamp()}.csv`, 'text/csv; charset=utf-8');
});
