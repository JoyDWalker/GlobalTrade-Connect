// Punto de entrada del buscador: límite de uso, búsqueda interna, registro de la consulta
// y decisión de si conviene consultar fuentes externas (que se hace en segundo plano desde el navegador).
import type { Db } from '../db';
import { many, one } from '../db';
import { getSetting } from '../settings';
import { hit } from '../rate-limit';
import { searchCompanies } from '../services/companies';
import type { SearchParams } from '../validation';
import { SEARCH_ADAPTERS } from '../sources/registry';
import type { SessionUser } from '../auth/session';

export async function externalAvailable(db: Db) {
  const enabled = await many<{ key: string }>(db, 'SELECT key FROM sources WHERE enabled AND key = ANY($1::text[])', [SEARCH_ADAPTERS.map((a) => a.key)]);
  return SEARCH_ADAPTERS.some((a) => a.isConfigured() && enabled.some((e) => e.key === a.key));
}

export async function performSearch(db: Db, p: SearchParams, viewer: { user: SessionUser | null; ipHash: string }) {
  const limits = await getSetting(db, 'limits');
  await hit(db, viewer.user ? `search:u:${viewer.user.id}` : `search:ip:${viewer.ipHash}`, viewer.user ? limits.searches_per_hour_user : limits.searches_per_hour_anon, 3600);
  const started = Date.now();
  const result = await searchCompanies(db, p);
  const cfg = await getSetting(db, 'external_search');
  const allowed = !cfg.admins_only || viewer.user?.role === 'admin';
  // canExternal: el administrador puede pedir más resultados de fuera aunque haya bastantes guardados
  const canExternal = Boolean(p.q && cfg.enabled && allowed && result.interpreted.terms.length && (await externalAvailable(db)));
  const suggestExternal = canExternal && p.page === 1 && result.total < cfg.min_internal_results;
  let searchId: number | null = null;
  if (p.q || p.page === 1) {
    const row = await one<{ id: number }>(db, `INSERT INTO searches (query, query_normalized, filters, user_id, ip_hash, internal_results, external_status, duration_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [p.q.slice(0, 200), result.interpreted.terms.join(' '), JSON.stringify({ ...p, q: undefined }), viewer.user?.id ?? null, viewer.ipHash, result.total,
      suggestExternal ? 'pending' : 'not_requested', Date.now() - started]);
    searchId = row?.id ?? null;
    if (searchId && result.items.length) {
      await db.query(`INSERT INTO search_results (search_id, company_id, rank, origin) SELECT $1, id, ord, 'internal'
        FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ord) ON CONFLICT DO NOTHING`, [searchId, result.items.map((c) => c.id)]);
    }
  }
  return { ...result, searchId, suggestExternal, canExternal: canExternal && viewer.user?.role === 'admin' };
}
