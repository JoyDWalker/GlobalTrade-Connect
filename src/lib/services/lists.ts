// Favoritos y listas personales. Todas las consultas filtran por user_id: un usuario nunca ve las listas de otro.
import type { Queryable } from '../db';
import { many, one } from '../db';
import { companyCards } from './companies';

export class ListNotFound extends Error { constructor() { super('Lista no encontrada'); } }

export async function defaultList(q: Queryable, userId: string) {
  const r = await one<{ id: string }>(q, `INSERT INTO lists (user_id, name, is_default) VALUES ($1, 'Favoritos', true)
    ON CONFLICT (user_id, name) DO UPDATE SET is_default = true RETURNING id`, [userId]);
  return r!.id;
}

export async function userLists(q: Queryable, userId: string) {
  await defaultList(q, userId);
  return many<{ id: string; name: string; is_default: boolean; items: number }>(q, `SELECT l.id, l.name, l.is_default, count(i.company_id)::int AS items
    FROM lists l LEFT JOIN list_items i ON i.list_id = l.id WHERE l.user_id = $1 GROUP BY l.id ORDER BY l.is_default DESC, l.created_at`, [userId]);
}

async function ownList(q: Queryable, userId: string, listId: string) {
  const l = await one<{ id: string; name: string; is_default: boolean }>(q, 'SELECT id, name, is_default FROM lists WHERE id = $1 AND user_id = $2', [listId, userId]);
  if (!l) throw new ListNotFound();
  return l;
}

export async function createList(q: Queryable, userId: string, name: string) {
  const r = await one<{ id: string }>(q, 'INSERT INTO lists (user_id, name) VALUES ($1, $2) ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [userId, name.trim().slice(0, 80)]);
  return r!.id;
}

export async function renameList(q: Queryable, userId: string, listId: string, name: string) {
  await ownList(q, userId, listId);
  await q.query('UPDATE lists SET name = $3 WHERE id = $1 AND user_id = $2', [listId, userId, name.trim().slice(0, 80)]);
}

export async function deleteList(q: Queryable, userId: string, listId: string) {
  const l = await ownList(q, userId, listId);
  if (l.is_default) throw new Error('La lista de favoritos no se puede eliminar');
  await q.query('DELETE FROM lists WHERE id = $1 AND user_id = $2', [listId, userId]);
}

export async function listItems(q: Queryable, userId: string, listId: string) {
  const l = await ownList(q, userId, listId);
  const rows = await many<{ company_id: string; note: string | null }>(q, `SELECT i.company_id, i.note FROM list_items i JOIN companies c ON c.id = i.company_id
    WHERE i.list_id = $1 AND c.deleted_at IS NULL AND c.record_status IN ('published', 'detected') ORDER BY i.created_at DESC`, [listId]);
  const cards = await companyCards(q, rows.map((r) => r.company_id));
  const notes = new Map(rows.map((r) => [r.company_id, r.note]));
  return { list: l, items: cards.map((c) => ({ ...c, note: notes.get(c.id) ?? null })) };
}

export async function addToList(q: Queryable, userId: string, listId: string | null, companyIds: string[], note?: string | null) {
  const id = listId ? (await ownList(q, userId, listId)).id : await defaultList(q, userId);
  const visible = await many<{ id: string }>(q, "SELECT id FROM companies WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL AND record_status IN ('published', 'detected')", [companyIds]);
  for (const c of visible) await q.query('INSERT INTO list_items (list_id, company_id, note) VALUES ($1,$2,$3) ON CONFLICT (list_id, company_id) DO UPDATE SET note = coalesce(EXCLUDED.note, list_items.note)', [id, c.id, note ?? null]);
  return { listId: id, added: visible.length };
}

export async function removeFromList(q: Queryable, userId: string, listId: string | null, companyId: string) {
  const id = listId ? (await ownList(q, userId, listId)).id : await defaultList(q, userId);
  await q.query('DELETE FROM list_items WHERE list_id = $1 AND company_id = $2', [id, companyId]);
}

/** Ids de empresas guardadas en cualquier lista del usuario (para pintar los corazones). */
export async function savedCompanyIds(q: Queryable, userId: string) {
  return (await many<{ company_id: string }>(q, 'SELECT DISTINCT i.company_id FROM list_items i JOIN lists l ON l.id = i.list_id WHERE l.user_id = $1', [userId])).map((r) => r.company_id);
}
