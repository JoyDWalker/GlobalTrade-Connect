import { api, HttpError, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { invalidateMeta } from '@/lib/meta';
import { sqlConflict, TAXONOMIES, taxonomyValues, type TaxonomyKey } from '@/lib/services/admin';

const def = (t: string) => { if (!(t in TAXONOMIES)) throw new HttpError(404, 'Catálogo desconocido'); return TAXONOMIES[t as TaxonomyKey]; };

export const PUT = api<{ type: string; id: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const d = def(params.type);
  const { values, errors } = taxonomyValues(params.type as TaxonomyKey, await readJson(req));
  if (Object.keys(errors).length) throw new HttpError(422, 'Revisa los campos', errors);
  delete values[d.pk];                       // la clave primaria no se cambia (evita romper referencias)
  if (params.type === 'categories' && Number(values.parent_id) === Number(params.id)) throw new HttpError(422, 'Una categoría no puede ser su propio padre');
  const keys = Object.keys(values);
  const db = getDb();
  try {
    const r = await db.query(`UPDATE ${d.table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE ${d.pk} = $1`, [params.id, ...keys.map((k) => values[k])]);
    if (!r.rowCount) throw new HttpError(404, 'No encontrado');
  } catch (e) { throw sqlConflict(e); }
  await audit(db, { id: u.id, email: u.email }, 'taxonomy.update', { type: params.type, id: params.id }, values, ipHash);
  invalidateMeta();
  return { ok: true };
});

/** Las referencias usan ON DELETE RESTRICT: si está en uso, se rechaza en lugar de borrar datos relacionados. */
export const DELETE = api<{ type: string; id: string }>(async ({ params, ipHash }) => {
  const u = await requireAdmin();
  const d = def(params.type);
  const db = getDb();
  if (params.type === 'business-types') {
    const used = await db.query('SELECT 1 FROM companies WHERE $1 = ANY(company_types) LIMIT 1', [params.id]);
    if (used.rows.length) throw new HttpError(409, 'No se puede eliminar: está en uso');
  }
  try { await db.query(`DELETE FROM ${d.table} WHERE ${d.pk} = $1`, [params.id]); } catch (e) { throw sqlConflict(e); }
  await audit(db, { id: u.id, email: u.email }, 'taxonomy.delete', { type: params.type, id: params.id }, {}, ipHash);
  invalidateMeta();
  return { ok: true };
});
