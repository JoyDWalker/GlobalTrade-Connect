// Siembra idempotente de catálogos (todos los entornos) y datos de demostración (solo desarrollo/pruebas).
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db';
import { one } from '../db';
import { companyInputSchema } from '../validation';
import { saveCompany } from '../services/companies';
import * as catalog from './catalog';

export async function seedCatalog(db: Db) {
  await db.tx(async (q) => {
    for (const c of catalog.countries()) {
      await q.query(`INSERT INTO countries (iso_code, name, continent, flag_url, is_priority, sort_order) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (iso_code) DO NOTHING`, [c.iso_code, c.name, c.continent, c.flag_url, c.is_priority, c.sort_order]);
    }
    const insertCats = async (list: typeof catalog.categories, parent: number | null) => {
      for (const [i, c] of list.entries()) {
        await q.query('INSERT INTO categories (name, slug, parent_id, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING', [c.name, c.slug, parent, i + 1]);
        const id = (await one<{ id: number }>(q, 'SELECT id FROM categories WHERE slug = $1', [c.slug]))!.id;
        if (c.children) await insertCats(c.children, Number(id));
      }
    };
    await insertCats(catalog.categories, null);
    for (const [i, [slug, name]] of catalog.businessTypes.entries()) await q.query('INSERT INTO business_types (slug, name, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [slug, name, i + 1]);
    for (const [slug, name] of catalog.certifications) await q.query('INSERT INTO certifications (slug, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [slug, name]);
    for (const [code, name] of catalog.languages) await q.query('INSERT INTO languages (code, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [code, name]);
    for (const [slug, name] of catalog.clientTypes) await q.query('INSERT INTO client_types (slug, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [slug, name]);
    for (const s of catalog.sources) {
      await q.query(`INSERT INTO sources (key, name, kind, base_url, terms_url, licence, reliability, daily_quota, cost_per_1000_usd, notes, enabled)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (key) DO NOTHING`,
      [s.key, s.name, s.kind, (s as any).base_url ?? null, (s as any).terms_url ?? null, (s as any).licence ?? null, s.reliability, s.quota, s.cost, s.notes, s.key !== 'seed_demo']);
    }
    for (const [key, value, description] of catalog.defaultSettings) {
      await q.query('INSERT INTO app_settings (key, value, description) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING', [key, JSON.stringify(value), description]);
    }
  });
}

const DEMO_FILE = path.join(process.cwd(), 'db', 'seed', 'demo-data.json');
const SUBCAT_MAP: Record<string, string> = {}; // los slugs de la demo coinciden con los del catálogo

/** Empresas ficticias (dominios .example, teléfonos 000). Prohibido en producción. */
export async function seedDemo(db: Db, appEnv: string) {
  if (appEnv === 'production') throw new Error('Los datos de demostración no se cargan en producción');
  if (await one(db, 'SELECT 1 FROM companies WHERE is_demo LIMIT 1')) return 0;
  const demo = JSON.parse(fs.readFileSync(DEMO_FILE, 'utf8'));
  const dial: Record<string, string> = { BR: '+55', ES: '+34', AR: '+54', CO: '+57', BE: '+32', CH: '+41' };
  let n = 0;
  for (const [i, c] of (demo.companies as any[]).entries()) {
    const slug = c.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const cats = (await db.query<{ id: number }>('SELECT id FROM categories WHERE slug = ANY($1::text[])', [c.subcats.map((s: string) => SUBCAT_MAP[s] ?? s)])).rows.map((r) => Number(r.id));
    const nn = String(i + 1).padStart(2, '0');
    const input = companyInputSchema.parse({
      name: c.name, description: `${c.description} (Empresa ficticia de demostración.)`, main_activity: c.prod,
      country_code: c.country, region: c.region, city: c.city, address: c.address ?? `${c.city} (dirección aproximada)`,
      coverage_area: c.coverage ?? 'Mercado nacional y exportación', website: `https://www.${slug}.example`,
      email: `info@${slug}.example`, phone: `${dial[c.country]} 000 000 0${nn}`,
      company_types: [c.type, ...(c.types ?? [])].filter((t: string, k: number, a: string[]) => a.indexOf(t) === k),
      keywords: [], year_founded: c.year, export_capacity_tons: c.capacity, production_capacity: c.prod,
      minimum_order_kg: c.minOrder, minimum_order_notes: c.minNotes, commercial_terms: c.terms,
      social: { linkedin: `https://www.linkedin.example/company/${slug}` },
      tax_id: `DEMO-${c.country}-${100000 + i * 7919}`, categories: cats,
      offerings: (c.products ?? []).map((name: string) => ({ kind: 'product', name })),
      certifications: c.certs ?? [], languages: c.langs ?? [], client_types: c.clients ?? [],
      export_markets: c.exports ?? [], import_markets: c.imports ?? [],
      contacts: [{ full_name: c.contact[0], job_title: c.contact[1], email: `comercial@${slug}.example`, phone: `${dial[c.country]} 000 000 1${nn}`,
        languages: c.langs ?? [], is_primary: true, is_personal: true, consent_public: i % 5 !== 4 }],
    });
    const level = c.verification === 'verified' ? 'verified' : 'none';
    await db.tx((q) => saveCompany(q, input, {
      changeSource: 'system', sourceKey: 'seed_demo',
      extra: { record_status: c.status === 'pending_review' ? 'pending_review' : 'published', verification_level: level,
        verification_method: level === 'verified' ? 'Demostración (dato ficticio)' : null,
        is_featured: Boolean(c.featured), origin: 'seed', is_demo: true, created_at: new Date(Date.now() - c.daysAgo * 864e5).toISOString() },
    }));
    n++;
  }
  return n;
}
