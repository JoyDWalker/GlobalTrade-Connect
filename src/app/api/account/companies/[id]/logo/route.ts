import { z } from 'zod';
import { api, HttpError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireCompanyAccess } from '@/lib/auth/session';
import { serviceRoleConfigured, uploadLogo } from '@/lib/auth/admin';
import { audit } from '@/lib/audit';

export const POST = api<{ id: string }>(async ({ req, params }) => {
  const id = z.string().uuid().parse(params.id);
  const u = await requireCompanyAccess(id);
  if (!serviceRoleConfigured()) throw new HttpError(501, 'La subida de logos requiere configurar Supabase Storage (SUPABASE_SERVICE_ROLE_KEY).');
  const form = await req.formData();
  const file = form.get('logo');
  if (!(file instanceof File)) throw new HttpError(422, 'Adjunta un archivo de imagen');
  let url: string;
  try { url = await uploadLogo(id, file); } catch (e) { throw new HttpError(422, (e as Error).message); }
  const db = getDb();
  await db.query('UPDATE companies SET logo_url = $2 WHERE id = $1', [id, url]);
  await audit(db, { id: u.id, email: u.email }, 'company.logo_upload', { type: 'company', id });
  return { logo_url: url };
});

export const DELETE = api<{ id: string }>(async ({ params }) => {
  const id = z.string().uuid().parse(params.id);
  await requireCompanyAccess(id);
  await getDb().query('UPDATE companies SET logo_url = NULL WHERE id = $1', [id]);
  return { ok: true };
});
