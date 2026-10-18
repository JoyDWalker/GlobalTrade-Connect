// Solicitudes de contacto/cotización, solicitudes de proveedores, reportes y derechos RGPD.
import type { Db, Queryable } from '../db';
import { many, one } from '../db';
import { env } from '../env';
import { queueEmail } from '../email';
import type { z } from 'zod';
import type { dataReportSchema, inquirySchema, privacyRequestSchema, supplierRequestSchema } from '../validation';

const site = () => env().NEXT_PUBLIC_SITE_URL;
const adminEmail = () => env().ADMIN_NOTIFY_EMAIL;

/** Destinatario de los leads: contacto principal visible o email corporativo de la empresa. */
async function companyRecipient(q: Queryable, companyId: string) {
  const r = await one<{ email: string | null }>(q, `SELECT coalesce(
      (SELECT email FROM company_contacts WHERE company_id = c.id AND email IS NOT NULL AND NOT hidden ORDER BY is_primary DESC, id LIMIT 1), c.email) AS email
    FROM companies c WHERE c.id = $1`, [companyId]);
  return r?.email ?? null;
}

export async function createInquiry(db: Db, company: { id: string; name: string; slug: string; record_status: string }, d: z.infer<typeof inquirySchema>, meta: { userId: string | null; ipHash: string }) {
  return db.tx(async (q) => {
    const row = await one<{ id: number }>(q, `INSERT INTO inquiries (company_id, sender_user_id, inquiry_type, sender_name, sender_company, sender_country, email, phone,
        product_interest, estimated_volume, message, consent_privacy, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12) RETURNING id`,
    [company.id, meta.userId, d.inquiry_type, d.sender_name, d.sender_company, d.sender_country, d.email, d.phone, d.product_interest, d.estimated_volume, d.message, meta.ipHash]);
    const kind = d.inquiry_type === 'quote' ? 'Solicitud de cotización' : 'Nuevo mensaje';
    const to = company.record_status === 'published' ? await companyRecipient(q, company.id) : null;
    const body = `${kind} para ${company.name} recibida a través de GlobalTrade Connect.\n\nDe: ${d.sender_name}${d.sender_company ? ` (${d.sender_company})` : ''} · ${d.sender_country}\n`
      + `Email: ${d.email}${d.phone ? `\nTeléfono: ${d.phone}` : ''}\nProducto: ${d.product_interest ?? '-'}\nVolumen estimado: ${d.estimated_volume ?? '-'}\n\n${d.message}\n\n`
      + `Responde directamente a ${d.email}. El remitente ha aceptado compartir estos datos contigo para esta solicitud.`;
    if (to) {
      await queueEmail(q, { to, subject: `${kind}: ${d.product_interest ?? company.name}`, body, relatedType: 'inquiry', relatedId: row!.id });
    } else {
      // Empresa detectada (sin contacto verificado): el equipo revisa y reenvía manualmente si procede
      await queueEmail(q, { to: adminEmail(), subject: `[Revisar] ${kind} para una empresa no verificada: ${company.name}`, body: `${body}\n\nFicha: ${site()}/empresa/${company.slug}`, relatedType: 'inquiry', relatedId: row!.id });
    }
    await queueEmail(q, { to: d.email, subject: `Hemos recibido tu solicitud para ${company.name}`, relatedType: 'inquiry', relatedId: row!.id,
      body: `Hola ${d.sender_name},\n\n${to ? `Hemos enviado tu mensaje a ${company.name}. La empresa te responderá directamente.` : `${company.name} todavía no ha verificado sus datos de contacto; nuestro equipo revisará tu solicitud antes de reenviarla.`}\n\nGlobalTrade Connect` });
    return { id: row!.id, delivered: Boolean(to) };
  });
}

export async function createSupplierRequest(db: Db, d: z.infer<typeof supplierRequestSchema>, userId: string | null) {
  return db.tx(async (q) => {
    const row = await one<{ id: number }>(q, `INSERT INTO supplier_requests (user_id, user_name, email, company_name, phone, product, category_id, origin_countries,
      certifications, quantity, target_date, notes, consent_privacy) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING id`,
    [userId, d.user_name, d.email, d.company_name, d.phone, d.product, d.category_id, d.origin_countries, d.certifications, d.quantity, d.target_date, d.notes]);
    await queueEmail(q, { to: adminEmail(), subject: `Nueva solicitud de proveedores: ${d.product}`, relatedType: 'supplier_request', relatedId: row!.id,
      body: `${d.user_name} (${d.email}${d.company_name ? `, ${d.company_name}` : ''}) busca: ${d.product}\nOrigen: ${d.origin_countries.join(', ') || 'indiferente'}\nCertificaciones: ${d.certifications.join(', ') || '-'}\nCantidad: ${d.quantity}\nFecha objetivo: ${d.target_date ?? '-'}\n\n${d.notes ?? ''}\n\n${site()}/admin/solicitudes` });
    await queueEmail(q, { to: d.email, subject: 'Hemos recibido tu solicitud de proveedores', relatedType: 'supplier_request', relatedId: row!.id,
      body: `Hola ${d.user_name},\n\nRevisaremos tu solicitud («${d.product}») y te contactaremos con proveedores que encajen.\n\nGlobalTrade Connect` });
    return row!.id;
  });
}

export async function createDataReport(db: Db, companyId: string, d: z.infer<typeof dataReportSchema>) {
  return db.tx(async (q) => {
    const row = await one<{ id: number }>(q, 'INSERT INTO data_reports (company_id, reporter_email, field, message) VALUES ($1,$2,$3,$4) RETURNING id', [companyId, d.reporter_email, d.field, d.message]);
    await q.query(`INSERT INTO review_tasks (company_id, kind, priority, details, dedupe_key) VALUES ($1, 'data_report', 60, $2, $3)
      ON CONFLICT (dedupe_key) WHERE status = 'open' AND dedupe_key IS NOT NULL DO NOTHING`, [companyId, JSON.stringify({ report_id: row!.id, field: d.field }), `report:${row!.id}`]);
    return row!.id;
  });
}

export async function createPrivacyRequest(db: Db, d: z.infer<typeof privacyRequestSchema>) {
  return db.tx(async (q) => {
    const row = await one<{ id: number }>(q, 'INSERT INTO privacy_requests (name, email, request_type, details) VALUES ($1,$2,$3,$4) RETURNING id', [d.name, d.email, d.request_type, d.details]);
    await queueEmail(q, { to: adminEmail(), subject: `Solicitud RGPD (${d.request_type}) de ${d.email}`, body: `${d.details ?? '(sin detalles)'}\n\n${site()}/admin/rgpd`, relatedType: 'privacy', relatedId: row!.id });
    await queueEmail(q, { to: d.email, subject: 'Hemos recibido tu solicitud sobre tus datos personales', relatedType: 'privacy', relatedId: row!.id,
      body: `Hola ${d.name},\n\nAtenderemos tu solicitud en el plazo legal (un mes, ampliable en casos complejos). Podremos pedirte que verifiques tu identidad.\n\nGlobalTrade Connect` });
    return row!.id;
  });
}

/** Datos personales asociados a un email (derecho de acceso). */
export async function personalDataFor(q: Queryable, email: string) {
  const e = email.toLowerCase();
  return {
    profile: await one(q, 'SELECT id, email, full_name, role, created_at FROM profiles WHERE lower(email) = $1', [e]),
    contacts: await many(q, 'SELECT c.company_id, co.name AS company, c.full_name, c.job_title, c.email, c.phone, c.whatsapp, c.consent_public FROM company_contacts c JOIN companies co ON co.id = c.company_id WHERE lower(c.email) = $1', [e]),
    inquiries: await many(q, 'SELECT id, company_id, created_at, sender_name, sender_company, phone, message FROM inquiries WHERE lower(email) = $1', [e]),
    supplier_requests: await many(q, 'SELECT id, created_at, user_name, company_name, phone, product, notes FROM supplier_requests WHERE lower(email) = $1', [e]),
    data_reports: await many(q, 'SELECT id, company_id, created_at, message FROM data_reports WHERE lower(reporter_email) = $1', [e]),
  };
}

/** Derecho de supresión: anonimiza leads, oculta/borra contactos personales y elimina el perfil. */
export async function executeErasure(db: Db, email: string) {
  const e = email.toLowerCase();
  return db.tx(async (q) => ({
    inquiries: (await q.query(`UPDATE inquiries SET sender_name = '[eliminado]', sender_company = NULL, email = 'eliminado@anonimizado.invalid', phone = NULL,
      message = '[Contenido eliminado por solicitud RGPD]', ip_hash = NULL WHERE lower(email) = $1`, [e])).rowCount,
    supplier_requests: (await q.query(`UPDATE supplier_requests SET user_name = '[eliminado]', company_name = NULL, email = 'eliminado@anonimizado.invalid', phone = NULL, notes = NULL WHERE lower(email) = $1`, [e])).rowCount,
    data_reports: (await q.query('UPDATE data_reports SET reporter_email = NULL WHERE lower(reporter_email) = $1', [e])).rowCount,
    contacts: (await q.query('DELETE FROM company_contacts WHERE lower(email) = $1 AND is_personal', [e])).rowCount,
    outbox: (await q.query("UPDATE email_outbox SET to_email = 'eliminado@anonimizado.invalid', body_text = '[eliminado]' WHERE lower(to_email) = $1", [e])).rowCount,
    profiles: (await q.query("DELETE FROM profiles WHERE lower(email) = $1 AND role <> 'admin' RETURNING id", [e])).rowCount,
  }));
}
