// Correo transaccional: se encola en email_outbox y se entrega por Resend (o se registra en modo 'log').
import type { Queryable } from './db';
import { env } from './env';
import { log } from './logger';

export async function queueEmail(q: Queryable, msg: { to: string | null | undefined; subject: string; body: string; relatedType?: string; relatedId?: string | number }) {
  if (!msg.to) return;
  await q.query('INSERT INTO email_outbox (to_email, subject, body_text, related_type, related_id) VALUES ($1,$2,$3,$4,$5)',
    [msg.to, msg.subject.slice(0, 200), msg.body.slice(0, 20000), msg.relatedType ?? null, msg.relatedId != null ? String(msg.relatedId) : null]);
}

async function deliverResend(to: string, subject: string, text: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env().RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env().EMAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(data as any).message ?? 'error'}`);
  return (data as any).id as string;
}

/** Entrega los correos pendientes (lo ejecuta el worker). */
export async function flushOutbox(q: Queryable, limit = 20) {
  const rows = (await q.query<{ id: number; to_email: string; subject: string; body_text: string; attempts: number }>(
    `UPDATE email_outbox SET attempts = attempts + 1 WHERE id IN (
       SELECT id FROM email_outbox WHERE status IN ('queued', 'failed') AND attempts < 5 ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id, to_email, subject, body_text, attempts`, [limit])).rows;
  let sent = 0;
  for (const m of rows) {
    try {
      if (env().EMAIL_PROVIDER === 'resend') {
        const providerId = await deliverResend(m.to_email, m.subject, m.body_text);
        await q.query("UPDATE email_outbox SET status = 'sent', sent_at = now(), provider_id = $2, last_error = NULL WHERE id = $1", [m.id, providerId]);
      } else {
        log.info('Email registrado (EMAIL_PROVIDER=log, no se envía)', { id: m.id, subject: m.subject });
        await q.query("UPDATE email_outbox SET status = 'logged', sent_at = now() WHERE id = $1", [m.id]);
      }
      sent++;
    } catch (e) {
      await q.query("UPDATE email_outbox SET status = 'failed', last_error = $2 WHERE id = $1", [m.id, String((e as Error).message).slice(0, 500)]);
      log.warn('Fallo al enviar email', { id: m.id, error: e });
    }
  }
  return { processed: rows.length, sent };
}
