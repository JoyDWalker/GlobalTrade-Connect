// Ejecución de derechos RGPD: exportar los datos de una persona (acceso) o suprimirlos.
import { z } from 'zod';
import { api, fileResponse, HttpError, readJson } from '@/lib/api';
import { getDb, one } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { deleteAuthUser, serviceRoleConfigured } from '@/lib/auth/admin';
import { executeErasure, personalDataFor } from '@/lib/services/leads';
import { log } from '@/lib/logger';

export const POST = api<{ id: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const { action } = z.object({ action: z.enum(['export', 'execute_erasure']) }).parse(await readJson(req));
  const db = getDb();
  const pr = await one<{ id: number; email: string; request_type: string }>(db, 'SELECT id, email, request_type FROM privacy_requests WHERE id = $1', [Number(params.id)]);
  if (!pr) throw new HttpError(404, 'Solicitud no encontrada');

  if (action === 'export') {
    const data = await personalDataFor(db, pr.email);
    await audit(db, { id: u.id, email: u.email }, 'privacy.export', { type: 'privacy_request', id: pr.id }, {}, ipHash);
    return fileResponse(JSON.stringify({ generated_at: new Date().toISOString(), subject: pr.email, data }, null, 2), `datos-personales-${pr.id}.json`, 'application/json');
  }

  if (pr.request_type !== 'deletion') throw new HttpError(400, 'Solo aplicable a solicitudes de supresión');
  const profile = await one<{ id: string; role: string }>(db, 'SELECT id, role FROM profiles WHERE lower(email) = lower($1)', [pr.email]);
  if (profile?.role === 'admin') throw new HttpError(409, 'No se puede suprimir una cuenta de administrador desde aquí');
  const affected = await executeErasure(db, pr.email);
  let authDeleted = false;
  if (profile && serviceRoleConfigured()) {
    try { await deleteAuthUser(profile.id); authDeleted = true; } catch (e) { log.error('No se pudo borrar el usuario de Supabase Auth', { error: e }); }
  }
  await db.query("UPDATE privacy_requests SET status = 'completed', resolved_at = now(), resolved_by = $2, details = NULL, email = 'eliminado@anonimizado.invalid', name = '[eliminado]' WHERE id = $1", [pr.id, u.id]);
  await audit(db, { id: u.id, email: u.email }, 'privacy.erasure', { type: 'privacy_request', id: pr.id }, { affected, authDeleted }, ipHash);
  return { ok: true, affected, authDeleted, authPending: Boolean(profile) && !authDeleted };
});
