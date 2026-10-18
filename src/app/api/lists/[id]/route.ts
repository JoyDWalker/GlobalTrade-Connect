import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { defaultList, deleteList, listItems, ListNotFound, renameList } from '@/lib/services/lists';

export const dynamic = 'force-dynamic';
const resolveId = async (userId: string, id: string) => (id === 'default' ? defaultList(getDb(), userId) : z.string().uuid().parse(id));
const guard = async <T>(fn: () => Promise<T>) => { try { return await fn(); } catch (e) { if (e instanceof ListNotFound) throw new HttpError(404, e.message); throw e; } };

export const GET = api<{ id: string }>(async ({ params }) => {
  const u = await requireUser();
  return guard(async () => listItems(getDb(), u.id, await resolveId(u.id, params.id)));
});

export const PATCH = api<{ id: string }>(async ({ req, params }) => {
  const u = await requireUser();
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await readJson(req));
  await guard(async () => renameList(getDb(), u.id, await resolveId(u.id, params.id), name));
  return { ok: true };
});

export const DELETE = api<{ id: string }>(async ({ params }) => {
  const u = await requireUser();
  await guard(async () => deleteList(getDb(), u.id, await resolveId(u.id, params.id)));
  return { ok: true };
});
