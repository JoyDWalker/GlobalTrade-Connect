// Cliente privilegiado de Supabase (service_role). SOLO servidor: nunca importar desde componentes cliente.
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '../env';

export const serviceRoleConfigured = () => Boolean(env().NEXT_PUBLIC_SUPABASE_URL && env().SUPABASE_SERVICE_ROLE_KEY);

function adminClient() {
  if (!serviceRoleConfigured()) throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada');
  return createClient(env().NEXT_PUBLIC_SUPABASE_URL!, env().SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};

/** Sube un logo validado (tipo real por firma, ≤ 400 KB) al bucket público "logos". */
export async function uploadLogo(companyId: string, file: File) {
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 400 * 1024) throw new Error('El logo no puede superar 400 KB');
  const type = Object.keys(MAGIC).find((t) => MAGIC[t](buf));
  if (!type) throw new Error('Formato no admitido (PNG, JPG o WebP)');
  const ext = type.split('/')[1].replace('jpeg', 'jpg');
  const path = `${companyId}/${Date.now()}.${ext}`;
  const sb = adminClient();
  const { error } = await sb.storage.from('logos').upload(path, buf, { contentType: type, upsert: false, cacheControl: '31536000' });
  if (error) throw new Error(`No se pudo subir el logo: ${error.message}`);
  return sb.storage.from('logos').getPublicUrl(path).data.publicUrl;
}

/** Elimina la cuenta de Supabase Auth (derecho de supresión). */
export async function deleteAuthUser(userId: string) {
  const { error } = await adminClient().auth.admin.deleteUser(userId);
  if (error && !/not found/i.test(error.message)) throw new Error(error.message);
}
