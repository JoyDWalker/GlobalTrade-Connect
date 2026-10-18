import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { addToList, ListNotFound } from '@/lib/services/lists';

export const POST = api<{ id: string }>(async ({ req, params }) => {
  const u = await requireUser();
  const body = z.object({ companyIds: z.array(z.string().uuid()).min(1).max(500), note: z.string().max(500).optional().nullable() }).parse(await readJson(req));
  try {
    return await addToList(getDb(), u.id, params.id === 'default' ? null : z.string().uuid().parse(params.id), body.companyIds, body.note);
  } catch (e) {
    if (e instanceof ListNotFound) throw new HttpError(404, e.message);
    throw e;
  }
});
