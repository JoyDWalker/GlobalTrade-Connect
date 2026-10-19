import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { companyDetail, DuplicateCompanyError, saveCompany, softDeleteCompany } from '@/lib/services/companies';
import { companyInputSchema, fieldErrors, inquirySchema, registerCompanySchema } from '@/lib/validation';
import { createInquiry, executeErasure, personalDataFor } from '@/lib/services/leads';
import { resetEnvCache, env } from '@/lib/env';

const base = (over: Record<string, unknown> = {}) => companyInputSchema.parse({
  name: 'Válvulas del Norte', country_code: 'ES', city: 'Bilbao', company_types: ['fabricante'], keywords: ['válvulas industriales'],
  website: 'https://www.valvulas-norte.example', tax_id: 'B-11111111', contacts: [{ full_name: 'Ana', email: 'ventas@valvulas-norte.example', is_personal: false, consent_public: true }],
  ...over,
});

describe('validación de formularios', () => {
  it('rechaza datos inválidos con errores por campo', () => {
    const r = companyInputSchema.safeParse({ name: '', country_code: 'XXX', company_types: [], website: 'javascript:alert(1)', contacts: [{ full_name: 'A' }] });
    expect(r.success).toBe(false);
    const e = fieldErrors(r.error!);
    expect(Object.keys(e)).toEqual(expect.arrayContaining(['name', 'country_code', 'company_types', 'website', 'contacts.0.email']));
    expect(inquirySchema.safeParse({ sender_name: 'x', sender_country: 'ES', email: 'no', message: 'corto', consent_privacy: false }).success).toBe(false);
    expect(registerCompanySchema.safeParse({ company: base(), consent_privacy: true, consent_authority: false }).success).toBe(false);
  });
  it('acepta sectores no catalogados mediante palabras clave', () => {
    expect(base({ categories: [], keywords: ['drones agrícolas'] }).keywords).toEqual(['drones agrícolas']);
  });
});

describe('deduplicación y persistencia', () => {
  it('impide duplicados por dominio e identificador fiscal y conserva historial', async () => {
    const db = await freshDb();
    const id = await db.tx((q) => saveCompany(q, base(), { changeSource: 'admin', extra: { record_status: 'published' } }));
    await expect(db.tx((q) => saveCompany(q, base({ name: 'Otra', tax_id: null, website: 'http://valvulas-norte.example/contacto' }), { changeSource: 'admin' }))).rejects.toBeInstanceOf(DuplicateCompanyError);
    await expect(db.tx((q) => saveCompany(q, base({ name: 'Otra', website: 'https://otra.example', tax_id: 'B11111111' }), { changeSource: 'admin' }))).rejects.toThrow(/identificador fiscal/);
    // Webs genéricas (redes sociales) no cuentan como duplicado
    await db.tx((q) => saveCompany(q, base({ name: 'Sin web propia 1', website: 'https://facebook.com/a', tax_id: null }), { changeSource: 'admin' }));
    await db.tx((q) => saveCompany(q, base({ name: 'Sin web propia 2', website: 'https://facebook.com/b', tax_id: null }), { changeSource: 'admin' }));
    await db.tx((q) => saveCompany(q, base({ city: 'Getxo' }), { id, changeSource: 'owner' }));
    const d = await companyDetail(db, { id }, { privateView: true });
    expect(d!.changes.length).toBe(2);
    expect(d!.changes[0].changes.city).toEqual({ from: 'Bilbao', to: 'Getxo' });
  });

  it('el borrado lógico conserva leads e historial', async () => {
    const db = await freshDb();
    const id = await db.tx((q) => saveCompany(q, base(), { changeSource: 'admin', extra: { record_status: 'published' } }));
    const c = await companyDetail(db, { id });
    await createInquiry(db, c as any, inquirySchema.parse({ sender_name: 'Comprador', sender_country: 'FR', email: 'c@x.example', message: 'Necesito 500 válvulas DN50 al mes.', consent_privacy: true }), { userId: null, ipHash: 'h' });
    expect(await softDeleteCompany(db, id, null)).toBe(true);
    expect((await db.query('SELECT count(*)::int AS n FROM inquiries WHERE company_id = $1', [id])).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM company_changes WHERE company_id = $1', [id])).rows[0].n).toBe(2);
    expect(await companyDetail(db, { id })).toBeNull();
    // Borrar físicamente una empresa con leads está bloqueado por la base de datos
    await expect(db.query('DELETE FROM companies WHERE id = $1', [id])).rejects.toThrow();
  });
});

describe('leads y RGPD', () => {
  it('envía el lead a la empresa y anonimiza al ejercer la supresión', async () => {
    const db = await freshDb();
    const id = await db.tx((q) => saveCompany(q, base(), { changeSource: 'admin', extra: { record_status: 'published' } }));
    const c = await companyDetail(db, { id });
    const r = await createInquiry(db, c as any, inquirySchema.parse({ sender_name: 'Laura', sender_country: 'ES', email: 'laura@cliente.example', message: 'Solicito precio de válvulas de bola.', consent_privacy: true }), { userId: null, ipHash: 'h' });
    expect(r.delivered).toBe(true);
    const mails = await db.query('SELECT to_email FROM email_outbox ORDER BY id');
    expect(mails.rows.map((m: any) => m.to_email)).toEqual(['ventas@valvulas-norte.example', 'laura@cliente.example']);
    expect((await personalDataFor(db, 'laura@cliente.example')).inquiries).toHaveLength(1);
    const res = await executeErasure(db, 'Laura@Cliente.example');
    expect(res.inquiries).toBe(1);
    expect((await personalDataFor(db, 'laura@cliente.example')).inquiries).toHaveLength(0);
    expect((await db.query('SELECT sender_name FROM inquiries')).rows[0].sender_name).toBe('[eliminado]');
  });
});

describe('configuración', () => {
  it('exige en producción variables críticas y conexión cifrada', () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { APP_ENV: 'production', DATABASE_URL: 'postgres://x@y/z', DATABASE_SSL: 'disable', NEXT_PUBLIC_SUPABASE_URL: 'https://a.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k', CRON_SECRET: 's' });
      resetEnvCache();
      expect(() => env()).toThrow(/cifrada/);
      process.env.DATABASE_SSL = 'require';
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      resetEnvCache();
      expect(() => env()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://a.supabase.co';
      process.env.APP_SECRET = 'corto';
      resetEnvCache();
      expect(() => env()).toThrow(/APP_SECRET/);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      resetEnvCache();
    }
  });
});
