import { z } from 'zod';
import { api, HttpError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { ListNotFound, removeFromList } from '@/lib/services/lists';

export const DELETE = api<{ id: string; companyId: string }>(async ({ params }) => {
  const u = await requireUser();
  try {
    await removeFromList(getDb(), u.id, params.id === 'default' ? null : z.string().uuid().parse(params.id), z.string().uuid().parse(params.companyId));
  } catch (e) {
    if (e instanceof ListNotFound) throw new HttpError(404, e.message);
    throw e;
  }
  return { ok: true };
});
