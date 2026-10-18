// Acciones rápidas de revisión: publicar, rechazar, ocultar, verificar, destacar, consultar registro…
import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb, one } from '@/lib/db';
import { env } from '@/lib/env';
import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { queueEmail } from '@/lib/email';
import { enqueue } from '@/lib/jobs/queue';
import { setCompanyStatus } from '@/lib/services/companies';
import { invalidateMeta } from '@/lib/meta';

const schema = z.object({
  action: z.enum(['publish', 'reject', 'hide', 'restore', 'verify', 'contrast', 'unverify', 'feature', 'unfeature', 'registry_check', 'enrich']),
  reason: z.string().trim().max(500).optional().nullable(),
  method: z.string().trim().max(300).optional().nullable(),
});

export const POST = api<{ id: string }>(async ({ req, params, ipHash }) => {
  const u = await requireAdmin();
  const id = z.string().uuid().parse(params.id);
  const { action, reason, method } = schema.parse(await readJson(req));
  const db = getDb();
  const c = await one<{ id: string; name: string; slug: string; email: string | null; record_status: string }>(db, 'SELECT id, name, slug, email, record_status FROM companies WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!c) throw new HttpError(404, 'Empresa no encontrada');

  if (action === 'registry_check' || action === 'enrich') {
    const jobId = await enqueue(db, action === 'enrich' ? 'enrich_company' : 'verify_registry', { companyId: id }, { dedupeKey: `${action}:${id}`, priority: 80, createdBy: u.id });
    await audit(db, { id: u.id, email: u.email }, `company.${action}`, { type: 'company', id }, { jobId }, ipHash);
    return { ok: true, jobId, message: jobId ? 'Tarea encolada' : 'Ya hay una tarea igual en curso' };
  }
  if (action === 'verify' && !method) throw new HttpError(422, 'Indica el procedimiento de verificación realizado', { method: 'Obligatorio para verificar' });
  if (action === 'reject' && !reason) throw new HttpError(422, 'Indica el motivo del rechazo', { reason: 'Obligatorio' });

  const patch: Parameters<typeof setCompanyStatus>[2] = {
    publish: { record_status: 'published', rejection_reason: null }, reject: { record_status: 'rejected', rejection_reason: reason ?? null },
    hide: { record_status: 'hidden' }, restore: { record_status: 'published' },
    verify: { verification_level: 'verified', verification_method: method ?? null }, contrast: { verification_level: 'contrasted', verification_method: method ?? null },
    unverify: { verification_level: 'none', verification_method: null }, feature: { is_featured: true }, unfeature: { is_featured: false },
  }[action];

  await db.tx(async (q) => {
    await setCompanyStatus(q, id, patch, u.id);
    if (action === 'verify' || action === 'contrast') {
      await q.query("INSERT INTO verification_events (company_id, kind, result, details, actor_id) VALUES ($1, 'manual_review', 'match', $2, $3)", [id, JSON.stringify({ level: patch.verification_level, method }), u.id]);
    }
    await q.query("UPDATE review_tasks SET status = 'resolved', resolved_by = $2, resolved_at = now(), resolution = $3 WHERE company_id = $1 AND status = 'open' AND kind IN ('self_registered', 'new_detected') AND $4",
      [id, u.id, action, action === 'publish' || action === 'reject' || action === 'hide']);
    await audit(q, { id: u.id, email: u.email }, `company.${action}`, { type: 'company', id }, { reason, method }, ipHash);
    // Aviso al titular en altas propias
    if ((action === 'publish' || action === 'reject') && c.record_status === 'pending_review') {
      const owner = await one<{ email: string }>(q, "SELECT p.email FROM company_members m JOIN profiles p ON p.id = m.user_id WHERE m.company_id = $1 AND m.role = 'owner' LIMIT 1", [id]);
      await queueEmail(q, { to: owner?.email, relatedType: 'company', relatedId: id,
        subject: action === 'publish' ? 'Tu empresa ya está publicada' : 'Tu solicitud de alta no ha sido aprobada',
        body: action === 'publish' ? `${c.name} ya es visible en GlobalTrade Connect: ${env().NEXT_PUBLIC_SITE_URL}/empresa/${c.slug}`
          : `La ficha de ${c.name} no ha sido aprobada.\n\nMotivo: ${reason}\n\nPuedes corregir los datos desde tu cuenta: ${env().NEXT_PUBLIC_SITE_URL}/cuenta` });
    }
  });
  invalidateMeta();
  return { ok: true };
});
