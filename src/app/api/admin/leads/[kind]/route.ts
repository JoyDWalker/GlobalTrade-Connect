import { api, HttpError } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { isLeadKind, LEAD_KINDS } from '@/lib/services/admin-leads';

export const dynamic = 'force-dynamic';

export const GET = api<{ kind: string }>(async ({ req, params }) => {
  await requireAdmin();
  if (!isLeadKind(params.kind)) throw new HttpError(404, 'Listado desconocido');
  const def = LEAD_KINDS[params.kind];
  const status = req.nextUrl.searchParams.get('status');
  const valid = status && (def.statuses as readonly string[]).includes(status);
  const items = await many(getDb(), `${def.sql} ${valid ? 'WHERE x.status = $1' : ''} ORDER BY x.created_at DESC LIMIT 500`, valid ? [status] : []);
  return { items, statuses: def.statuses };
});
