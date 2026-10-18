import { api } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireAdmin();
  return { items: await many(getDb(), 'SELECT id, to_email, subject, body_text, status, attempts, last_error, created_at, sent_at FROM email_outbox ORDER BY id DESC LIMIT 200') };
});
