// Empresas del usuario y alta de una nueva empresa (queda pendiente de revisión).
import { api, checkSpam, readJson } from '@/lib/api';
import { getDb, many } from '@/lib/db';
import { env } from '@/lib/env';
import { requireUser } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { queueEmail } from '@/lib/email';
import { hit } from '@/lib/rate-limit';
import { companyCards, saveCompany, similarByName } from '@/lib/services/companies';
import { registerCompanySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const u = await requireUser();
  const db = getDb();
  const ids = (await many<{ company_id: string }>(db, `SELECT m.company_id FROM company_members m JOIN companies c ON c.id = m.company_id
    WHERE m.user_id = $1 AND c.deleted_at IS NULL`, [u.id])).map((r) => r.company_id);
  const companies = await companyCards(db, ids);
  const inquiries = ids.length ? await many(db, `SELECT i.id, i.company_id, i.inquiry_type, i.sender_name, i.sender_company, i.sender_country, i.email, i.phone,
      i.product_interest, i.estimated_volume, i.message, i.status, i.created_at FROM inquiries i WHERE i.company_id = ANY($1::uuid[]) ORDER BY i.created_at DESC LIMIT 300`, [ids]) : [];
  const tasks = ids.length ? await many(db, 'SELECT id, company_id, kind, status, created_at, resolution FROM review_tasks WHERE company_id = ANY($1::uuid[]) AND requested_by = $2 ORDER BY created_at DESC LIMIT 50', [ids, u.id]) : [];
  return { companies, inquiries, tasks };
});

export const POST = api(async ({ req, ipHash }) => {
  const u = await requireUser();
  const db = getDb();
  const body = await readJson(req);
  checkSpam(body);
  await hit(db, `register:${u.id}`, 5, 86400);
  const { company } = registerCompanySchema.parse(body);
  const id = await db.tx(async (q) => {
    const cid = await saveCompany(q, company, { actorId: u.id, changeSource: 'owner', sourceKey: 'self_registered',
      extra: { record_status: 'pending_review', verification_level: 'none', origin: 'self_registered' } });
    await q.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING", [cid, u.id]);
    if (u.role === 'user') await q.query("UPDATE profiles SET role = 'company' WHERE id = $1 AND role = 'user'", [u.id]);
    const similar = await similarByName(q, company.name, company.country_code, cid);
    await q.query(`INSERT INTO review_tasks (company_id, kind, priority, details, dedupe_key, requested_by) VALUES ($1, 'self_registered', 70, $2, $3, $4)`,
      [cid, JSON.stringify({ similar: similar.map((s) => ({ id: s.id, name: s.name })) }), `self:${cid}`, u.id]);
    await audit(q, { id: u.id, email: u.email }, 'company.register', { type: 'company', id: cid }, { name: company.name }, ipHash);
    await queueEmail(q, { to: env().ADMIN_NOTIFY_EMAIL, subject: `Nueva empresa pendiente de revisión: ${company.name}`, body: `${env().NEXT_PUBLIC_SITE_URL}/admin/empresas/${cid}`, relatedType: 'company', relatedId: cid });
    await queueEmail(q, { to: u.email, subject: 'Hemos recibido el alta de tu empresa', relatedType: 'company', relatedId: cid,
      body: `Hola,\n\nHemos recibido la solicitud de alta de ${company.name}. La revisaremos antes de publicarla y te avisaremos por email.\n\nGlobalTrade Connect` });
    return cid;
  });
  return { ok: true, id };
});
