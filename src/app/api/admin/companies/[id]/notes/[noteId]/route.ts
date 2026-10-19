import { z } from 'zod';
import { api, HttpError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { deleteNote, getFollowup } from '@/lib/services/followups';

export const dynamic = 'force-dynamic';

export const DELETE = api<{ id: string; noteId: string }>(async ({ params }) => {
  await requireAdmin();
  const id = z.string().uuid().parse(params.id);
  const db = getDb();
  if (!(await deleteNote(db, id, z.coerce.number().int().positive().parse(params.noteId)))) throw new HttpError(404, 'Nota no encontrada');
  return getFollowup(db, id);
});
