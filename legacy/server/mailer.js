// En desarrollo los emails NO se envían: se guardan en la tabla mail_outbox
// (visible en Admin → Emails) y se muestran por consola.
// En producción, sustituye deliver() por un proveedor (Nodemailer + SMTP, Resend, SES, Postmark…).

async function deliver(_msg) { return false; }

export function sendMail(db, { to, subject, body, relatedType = null, relatedId = null }) {
  if (!to) return;
  const r = db.run(
    'INSERT INTO mail_outbox (to_email, subject, body, related_type, related_id) VALUES (?,?,?,?,?)',
    to, subject, body, relatedType, relatedId,
  );
  console.log(`✉  [outbox #${r.lastInsertRowid}] → ${to} · ${subject}`);
  deliver({ to, subject, body })
    .then((ok) => ok && db.run("UPDATE mail_outbox SET sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", r.lastInsertRowid))
    .catch((e) => console.error('Error enviando email', e));
}
