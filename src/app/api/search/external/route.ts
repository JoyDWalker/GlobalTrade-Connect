// Búsqueda en fuentes externas, invocada en segundo plano por la página de resultados.
import { z } from 'zod';
import { api, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';
import { hit } from '@/lib/rate-limit';
import { runExternalSearch } from '@/lib/search/external';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = api(async ({ req, ipHash }) => {
  const db = getDb();
  const body = z.object({ q: z.string().trim().min(2).max(200), country: z.string().regex(/^[A-Z]{2}$/).optional().nullable(), searchId: z.number().int().optional().nullable() }).parse(await readJson(req));
  const user = await getSessionUser();
  const actorKey = user ? `u:${user.id}` : `ip:${ipHash}`;
  await hit(db, `extburst:${actorKey}`, 5, 60);                      // ráfagas
  const r = await runExternalSearch(db, { query: body.q, country: body.country ?? null, actorKey, isUser: Boolean(user) });
  if (body.searchId) {
    await db.query("UPDATE searches SET external_status = $2, external_results = $3 WHERE id = $1 AND (ip_hash = $4 OR user_id = $5)",
      [body.searchId, r.status, r.items.length, ipHash, user?.id ?? null]);
    if (r.items.length) await db.query(`INSERT INTO search_results (search_id, company_id, rank, origin) SELECT $1, id, 1000 + ord, 'external'
      FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ord) ON CONFLICT DO NOTHING`, [body.searchId, r.items.map((c) => c.id)]);
  }
  return r;
});
