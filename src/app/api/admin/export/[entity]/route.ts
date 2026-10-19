// Exportaciones privadas (empresas con datos internos, leads). Solo administradores; queda auditado.
import { api, fileResponse, HttpError } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { env } from '@/lib/env';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { toCSV, toXLSX, XLSX_TYPE } from '@/lib/export';
import { exportColumns, exportRows, searchCompanies } from '@/lib/services/companies';
import { isLeadKind, LEAD_KINDS } from '@/lib/services/admin-leads';
import { searchParamsFromUrl } from '@/lib/validation';
import { FOLLOWUP_STATUS, followupExportColumns, listFollowups } from '@/lib/services/followups';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = api<{ entity: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const format = sp.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  let rows: Record<string, unknown>[];
  let columns: [string, string][];
  if (params.entity === 'companies') {
    // Respeta los mismos filtros que el listado del panel
    const p = searchParamsFromUrl(sp);
    const ids: string[] = [];
    for (let page = 1; page <= 100; page++) {
      const r = await searchCompanies(db, { ...p, page, pageSize: 50, sort: 'name' }, { admin: true });
      ids.push(...r.items.map((c) => c.id));
      if (page >= r.pages) break;
    }
    rows = await exportRows(db, ids, env().NEXT_PUBLIC_SITE_URL, { privateView: true });
    columns = exportColumns(true);
  } else if (params.entity === 'followups') {
    const base = env().NEXT_PUBLIC_SITE_URL;
    rows = [];
    for (let page = 1; page <= 200; page++) {
      const r = await listFollowups(db, { status: sp.get('status'), tag: sp.get('tag'), q: sp.get('q'), due: sp.get('due') === '1', page, pageSize: 100 });
      rows.push(...r.items.map((x: any) => ({ ...x, status_label: FOLLOWUP_STATUS[x.status] ?? x.status, url: `${base}/empresa/${x.slug}` })));
      if (page >= r.pages) break;
    }
    columns = followupExportColumns;
  } else if (isLeadKind(params.entity)) {
    const d = LEAD_KINDS[params.entity];
    rows = await many(db, `${d.sql} ORDER BY x.created_at DESC LIMIT 20000`);
    columns = d.columns;
  } else {
    throw new HttpError(404, 'Exportación desconocida');
  }
  await audit(db, { id: u.id, email: u.email }, 'export', { type: params.entity, id: format }, { rows: rows.length, filters: Object.fromEntries(sp) }, ipHash);
  const name = `${params.entity}-${new Date().toISOString().slice(0, 10)}`;
  return format === 'xlsx' ? fileResponse(toXLSX(rows, columns, params.entity), `${name}.xlsx`, XLSX_TYPE) : fileResponse(toCSV(rows, columns), `${name}.csv`, 'text/csv; charset=utf-8');
});
