// Reclamar una ficha existente (p. ej. detectada en una fuente externa). Siempre requiere revisión manual.
import { z } from 'zod';
import { api, HttpError, readJson } from '@/lib/api';
import { getDb, one } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { hit } from '@/lib/rate-limit';
import { normalizeDomain, rootDomain } from '@/lib/text';

export const POST = api(async ({ req }) => {
  const u = await requireUser();
  const body = z.object({ slug: z.string().max(120), message: z.string().trim().min(10, 'Explica tu relación con la empresa').max(2000), job_title: z.string().trim().max(120).optional() }).parse(await readJson(req));
  const db = getDb();
  await hit(db, `claim:${u.id}`, 5, 86400);
  const c = await one<{ id: string; domain: string | null }>(db, 'SELECT id, domain FROM companies WHERE slug = $1 AND deleted_at IS NULL', [body.slug]);
  if (!c) throw new HttpError(404, 'Empresa no encontrada');
  // Indicio para el revisor (no prueba suficiente): el email de la cuenta usa el dominio de la empresa
  const emailDomain = normalizeDomain(u.email);
  const domainMatch = Boolean(c.domain && emailDomain && rootDomain(emailDomain) === rootDomain(c.domain));
  await db.query(`INSERT INTO review_tasks (company_id, kind, priority, details, requested_by, dedupe_key) VALUES ($1, 'verification_request', $2, $3, $4, $5)
    ON CONFLICT (dedupe_key) WHERE status = 'open' AND dedupe_key IS NOT NULL DO NOTHING`,
  [c.id, domainMatch ? 80 : 50, JSON.stringify({ claim: true, message: body.message, job_title: body.job_title ?? null, email_domain_matches: domainMatch, claimant_email: u.email }), u.id, `claim:${c.id}:${u.id}`]);
  return { ok: true, domainMatch };
});
