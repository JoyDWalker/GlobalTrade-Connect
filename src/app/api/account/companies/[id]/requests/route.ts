// La empresa solicita una verificación o una corrección al equipo.
import { z } from 'zod';
import { api, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { requireCompanyAccess } from '@/lib/auth/session';
import { hit } from '@/lib/rate-limit';

export const POST = api<{ id: string }>(async ({ req, params }) => {
  const id = z.string().uuid().parse(params.id);
  const u = await requireCompanyAccess(id);
  const body = z.object({
    kind: z.enum(['verification_request', 'correction_request']),
    message: z.string().trim().min(10, 'Explica tu solicitud (mín. 10 caracteres)').max(2000),
    evidence_url: z.string().url().max(300).optional().nullable().or(z.literal('')),
  }).parse(await readJson(req));
  const db = getDb();
  await hit(db, `ownerreq:${u.id}`, 10, 86400);
  await db.query('INSERT INTO review_tasks (company_id, kind, priority, details, requested_by) VALUES ($1, $2, 60, $3, $4)',
    [id, body.kind, JSON.stringify({ message: body.message, evidence_url: body.evidence_url || null }), u.id]);
  return { ok: true };
});
