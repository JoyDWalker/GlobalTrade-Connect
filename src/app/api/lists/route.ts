import { z } from 'zod';
import { api, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { createList, userLists } from '@/lib/services/lists';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const u = await requireUser();
  return { lists: await userLists(getDb(), u.id) };
});

export const POST = api(async ({ req }) => {
  const u = await requireUser();
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await readJson(req));
  return { id: await createList(getDb(), u.id, name) };
});
