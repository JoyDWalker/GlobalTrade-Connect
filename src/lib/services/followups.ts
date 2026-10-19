// Seguimiento comercial privado (solo administradores): estado de contacto, etiquetas, próxima acción y notas.
import { z } from 'zod';
import type { Queryable } from '../db';
import { many, one } from '../db';

export const FOLLOWUP_STATUS: Record<string, string> = {
  pendiente: 'Pendiente de contactar', contactado: 'Contactado', en_conversacion: 'En conversación', interesado: 'Interesado',
  cliente: 'Cliente', no_interesado: 'No interesado', descartado: 'Descartado',
};
export const NOTE_KIND: Record<string, string> = { nota: 'Nota', llamada: 'Llamada', email: 'Email', reunion: 'Reunión' };

const tag = z.string().trim().toLowerCase().min(1).max(40);
export const followupInput = z.object({
  status: z.enum(Object.keys(FOLLOWUP_STATUS) as [string, ...string[]]),
  tags: z.array(tag).max(20).transform((t) => [...new Set(t)]),
  next_action: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  next_action_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')).transform((v) => v || null),
});
export const noteInput = z.object({
  kind: z.enum(Object.keys(NOTE_KIND) as [string, ...string[]]).default('nota'),
  body: z.string().trim().min(1, 'Escribe la nota').max(5000),
});

export async function getFollowup(q: Queryable, companyId: string) {
  const [followup, notes] = await Promise.all([
    one(q, 'SELECT status, tags, next_action, next_action_at::text AS next_action_at, last_contact_at, updated_at FROM company_followups WHERE company_id = $1', [companyId]),
    many(q, `SELECT n.id, n.kind, n.body, n.created_at, p.email AS author FROM company_notes n LEFT JOIN profiles p ON p.id = n.created_by
      WHERE n.company_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 200`, [companyId]),
  ]);
  return { followup, notes };
}

export async function saveFollowup(q: Queryable, companyId: string, input: z.infer<typeof followupInput>, userId: string | null) {
  await q.query(`INSERT INTO company_followups (company_id, status, tags, next_action, next_action_at, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (company_id) DO UPDATE SET status = EXCLUDED.status, tags = EXCLUDED.tags, next_action = EXCLUDED.next_action,
      next_action_at = EXCLUDED.next_action_at, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [companyId, input.status, input.tags, input.next_action, input.next_action_at, userId]);
}

/** Añade una nota. Una llamada, email o reunión cuenta como contacto: actualiza la fecha y, si estaba pendiente, pasa a "contactado". */
export async function addNote(q: Queryable, companyId: string, input: z.infer<typeof noteInput>, userId: string | null) {
  const row = await one<{ id: number }>(q, 'INSERT INTO company_notes (company_id, kind, body, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [companyId, input.kind, input.body, userId]);
  if (input.kind !== 'nota') {
    await q.query(`INSERT INTO company_followups (company_id, status, last_contact_at, updated_by) VALUES ($1, 'contactado', now(), $2)
      ON CONFLICT (company_id) DO UPDATE SET last_contact_at = now(), updated_by = EXCLUDED.updated_by, updated_at = now(),
        status = CASE WHEN company_followups.status = 'pendiente' THEN 'contactado' ELSE company_followups.status END`, [companyId, userId]);
  } else {
    await q.query("INSERT INTO company_followups (company_id, updated_by) VALUES ($1, $2) ON CONFLICT (company_id) DO NOTHING", [companyId, userId]);
  }
  return row!.id;
}

export async function deleteNote(q: Queryable, companyId: string, noteId: number) {
  return (await q.query('DELETE FROM company_notes WHERE id = $1 AND company_id = $2', [noteId, companyId])).rowCount > 0;
}

export interface FollowupFilters { status?: string | null; tag?: string | null; q?: string | null; due?: boolean; page?: number; pageSize?: number }

/** Listado de empresas en seguimiento con sus datos de contacto. Las que tienen la próxima acción más cercana, primero. */
export async function listFollowups(q: Queryable, f: FollowupFilters) {
  const where = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.status) where.push(`f.status = ${add(f.status)}`);
  if (f.tag) where.push(`${add(f.tag.toLowerCase())} = ANY(f.tags)`);
  if (f.q) where.push(`(c.name ILIKE ${add(`%${f.q}%`)} OR c.domain ILIKE $${params.length} OR c.city ILIKE $${params.length})`);
  if (f.due) where.push("f.next_action_at <= current_date AND f.status NOT IN ('cliente', 'no_interesado', 'descartado')");
  const whereSql = where.join(' AND ');
  const total = Number((await one<{ n: string }>(q, `SELECT count(*) AS n FROM company_followups f JOIN companies c ON c.id = f.company_id WHERE ${whereSql}`, params))!.n);
  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const items = await many(q, `SELECT c.id, c.slug, c.name, c.city, c.country_code, co.name AS country_name, c.website,
      coalesce(c.email, (SELECT k.email FROM company_contacts k WHERE k.company_id = c.id AND k.email IS NOT NULL ORDER BY k.is_primary DESC, k.id LIMIT 1)) AS email,
      coalesce(c.phone, (SELECT k.phone FROM company_contacts k WHERE k.company_id = c.id AND k.phone IS NOT NULL ORDER BY k.is_primary DESC, k.id LIMIT 1)) AS phone,
      f.status, f.tags, f.next_action, f.next_action_at::text AS next_action_at, f.last_contact_at, f.updated_at,
      (SELECT n.body FROM company_notes n WHERE n.company_id = c.id ORDER BY n.created_at DESC, n.id DESC LIMIT 1) AS last_note
    FROM company_followups f JOIN companies c ON c.id = f.company_id LEFT JOIN countries co ON co.iso_code = c.country_code
    WHERE ${whereSql} ORDER BY f.next_action_at NULLS LAST, f.updated_at DESC LIMIT ${add(pageSize)} OFFSET ${add((page - 1) * pageSize)}`, params);
  const tags = (await many<{ tag: string; n: number }>(q, 'SELECT tag, count(*)::int AS n FROM company_followups, unnest(tags) AS tag GROUP BY tag ORDER BY n DESC, tag LIMIT 100')).map((t) => t.tag);
  const counts = Object.fromEntries((await many<{ status: string; n: number }>(q, 'SELECT status, count(*)::int AS n FROM company_followups GROUP BY status')).map((r) => [r.status, r.n]));
  return { total, page, pages: Math.max(1, Math.ceil(total / pageSize)), items, tags, counts };
}

export const followupExportColumns: [string, string][] = [
  ['Empresa', 'name'], ['Ciudad', 'city'], ['País', 'country_name'], ['Teléfono', 'phone'], ['Email', 'email'], ['Web', 'website'],
  ['Estado', 'status_label'], ['Etiquetas', 'tags'], ['Próxima acción', 'next_action'], ['Fecha próxima acción', 'next_action_at'],
  ['Último contacto', 'last_contact_at'], ['Última nota', 'last_note'], ['Ficha', 'url'],
];
