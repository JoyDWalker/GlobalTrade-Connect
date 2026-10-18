import { api, HttpError, readJson } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { invalidateMeta } from '@/lib/meta';
import { sqlConflict, TAXONOMIES, taxonomyValues, type TaxonomyKey } from '@/lib/services/admin';

export const dynamic = 'force-dynamic';
const def = (t: string) => { if (!(t in TAXONOMIES)) throw new HttpError(404, 'Catálogo desconocido'); return TAXONOMIES[t as TaxonomyKey]; };

export const GET = api<{ type: string }>(async ({ params }) => {
  await requireAdmin();
  const d = def(params.type);
  return { items: await many(getDb(), `SELECT * FROM ${d.table} ORDER BY ${d.order}`), fields: d.fields, pk: d.pk };
});

export const POST = api<{ type: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const d = def(params.type);
  const { values, errors } = taxonomyValues(params.type as TaxonomyKey, await readJson(req));
  if (Object.keys(errors).length) throw new HttpError(422, 'Revisa los campos', errors);
  const keys = Object.keys(values);
  const db = getDb();
  try {
    await db.query(`INSERT INTO ${d.table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => values[k]));
  } catch (e) { throw sqlConflict(e); }
  await audit(db, { id: u.id, email: u.email }, 'taxonomy.create', { type: params.type, id: String(values[d.pk] ?? values.slug ?? '') }, values, ipHash);
  invalidateMeta();
  return { ok: true };
});
