// Registro de acciones sensibles (quién, qué, cuándo). Nunca guarda secretos.
import type { Queryable } from './db';
import { redact } from './logger';

export interface Actor { id: string | null; email?: string | null }

export async function audit(q: Queryable, actor: Actor | null, action: string, entity?: { type: string; id: string | number }, details: Record<string, unknown> = {}, ipHash?: string | null) {
  await q.query('INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, details, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [actor?.id ?? null, actor?.email ?? null, action, entity?.type ?? null, entity ? String(entity.id) : null, JSON.stringify(redact(details)), ipHash ?? null]);
}
