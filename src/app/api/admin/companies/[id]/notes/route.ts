// Notas privadas de seguimiento (llamadas, emails, reuniones). Solo administradores.
import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb, one } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { addNote, getFollowup, noteInput } from '@/lib/services/followups';

export const dynamic = 'force-dynamic';

export const POST = api<{ id: string }>(async ({ req, params }) => {
  const u = await requireAdmin();
  const id = z.string().uuid().parse(params.id);
  const db = getDb();
  if (!(await one(db, 'SELECT 1 FROM companies WHERE id = $1 AND deleted_at IS NULL', [id]))) throw new HttpError(404, 'Empresa no encontrada');
  await addNote(db, id, noteInput.parse(await readJson(req)), u.id);
  return getFollowup(db, id);
});
