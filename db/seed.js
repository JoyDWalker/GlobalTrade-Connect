import { hashPassword } from '../server/auth.js';
import { saveCompany, validateCompany } from '../server/companies.js';
import { config } from '../server/config.js';
import { slugify } from '../server/util.js';
import * as data from './seed-data.js';

const DIAL = { BR: '+55', ES: '+34', AR: '+54', CO: '+57', BE: '+32', CH: '+41' };
const LOCAL_FLAGS = new Set(['BR', 'ES', 'AR', 'CO', 'BE', 'CH']);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

export function seed(db, { log = console.log } = {}) {
  if (db.get('SELECT COUNT(*) AS n FROM countries').n > 0) { log('La base de datos ya tiene datos: seed omitido.'); return false; }

  db.tx(() => {
    data.countries.forEach(([name, iso, prio], i) => db.run(
      'INSERT INTO countries (name, iso_code, flag_url, is_priority, sort_order) VALUES (?,?,?,?,?)',
      name, iso, LOCAL_FLAGS.has(iso) ? `/img/flags/${iso.toLowerCase()}.svg` : null, prio ? 1 : 0, prio ? i + 1 : 100));

    data.categories.forEach((cat, i) => {
      const pid = db.run('INSERT INTO categories (name, slug, parent_id, sort_order) VALUES (?,?,NULL,?)', cat.name, cat.slug, i + 1).lastInsertRowid;
      cat.children.forEach((sub, j) => {
        const sid = db.run('INSERT INTO categories (name, slug, parent_id, sort_order) VALUES (?,?,?,?)', sub.name, sub.slug, pid, j + 1).lastInsertRowid;
        for (const [pname, hs] of sub.products) db.run('INSERT INTO products (name, category_id, hs_code) VALUES (?,?,?)', pname, sid, hs);
      });
    });
    for (const [name, slug] of data.certifications) db.run('INSERT INTO certifications (name, slug) VALUES (?,?)', name, slug);
    for (const [code, name] of data.languages) db.run('INSERT INTO languages (code, name) VALUES (?,?)', code, name);
    for (const [slug, name] of data.businessTypes) db.run('INSERT INTO business_types (slug, name) VALUES (?,?)', slug, name);
    for (const [slug, name] of data.clientTypes) db.run('INSERT INTO client_types (slug, name) VALUES (?,?)', slug, name);

    const idOf = (table, col, values) => values.map((v) => {
      const r = db.get(`SELECT id FROM ${table} WHERE ${col} = ?`, v);
      if (!r) throw new Error(`Seed: ${table}.${col} = ${v} no existe`);
      return r.id;
    });

    data.companies.forEach((c, i) => {
      const slug = slugify(c.name);
      const n = String(i + 1).padStart(2, '0');
      const body = {
        name: c.name, description: c.description, year_founded: c.year,
        website: `https://www.${slug}.example`, tax_id: `DEMO-${c.country}-${100000 + i * 7919}`,
        country_id: idOf('countries', 'iso_code', [c.country])[0], region: c.region, city: c.city,
        address: c.address || `${c.city} (dirección aproximada)`, coverage_area: c.coverage || 'Mercado nacional y exportación',
        company_type: c.type, business_types: idOf('business_types', 'slug', c.types || []),
        categories: idOf('categories', 'slug', c.subcats), products: idOf('products', 'name', c.products || []),
        certifications: idOf('certifications', 'slug', c.certs || []), languages: idOf('languages', 'code', c.langs || []),
        client_types: idOf('client_types', 'slug', c.clients || []),
        export_markets: idOf('countries', 'iso_code', c.exports || []), import_markets: idOf('countries', 'iso_code', c.imports || []),
        export_capacity: c.capacity, minimum_order: c.minOrder, minimum_order_notes: c.minNotes,
        production_capacity: c.prod, commercial_terms: c.terms,
        linkedin_url: `https://www.linkedin.example/company/${slug}`,
        instagram_url: i % 3 === 0 ? null : `https://www.instagram.example/${slug.replace(/-/g, '')}`,
        status: c.status || 'approved', verification_status: c.verification, is_featured: c.featured,
        contacts: [{
          full_name: c.contact[0], job_title: c.contact[1], email: `comercial@${slug}.example`,
          phone: `${DIAL[c.country]} 000 000 0${n}`, whatsapp: i % 4 === 3 ? null : `${DIAL[c.country]} 000 000 1${n}`,
          languages: c.langs.join(','), is_primary: true, consent_public: i % 5 !== 4,
        }],
      };
      const d = validateCompany(db, body, { admin: true });
      saveCompany(db, d, null, { is_demo: 1, created_at: daysAgo(c.daysAgo), updated_at: daysAgo(c.daysAgo) });
    });

    // Usuarios de prueba (credenciales definidas en .env / .env.example)
    const s = config.seed;
    if (s.adminPassword) {
      db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,'admin')", s.adminName, s.adminEmail, hashPassword(s.adminPassword));
    }
    if (s.companyPassword) {
      const cid = db.get('SELECT id FROM companies ORDER BY id LIMIT 1').id;
      db.run("INSERT INTO users (name, email, password_hash, role, company_id) VALUES (?,?,?,'company',?)",
        'Usuario Empresa Demo', s.companyEmail, hashPassword(s.companyPassword), cid);
    }

    const cidByName = (name) => db.get('SELECT id FROM companies WHERE name = ?', name).id;
    for (const q of data.sampleInquiries) {
      db.run(`INSERT INTO inquiries (company_id, inquiry_type, sender_name, sender_company, sender_country, email, product_interest,
              estimated_volume, message, consent_privacy, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)`,
        cidByName(q.company), q.type, q.name, q.comp, q.country, q.email, q.product, q.volume, q.message, daysAgo(q.daysAgo));
    }
    for (const r of data.sampleSupplierRequests) {
      db.run(`INSERT INTO supplier_requests (user_name, email, company_name, product, category_id, origin_countries, certifications,
              quantity, target_date, notes, consent_privacy) VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
        r.name, r.email, r.company, r.product, db.get('SELECT id FROM categories WHERE slug = ?', r.category).id,
        r.origins, r.certs, r.quantity, daysAgo(-r.targetDays).slice(0, 10), r.notes);
    }
    db.run('INSERT INTO data_reports (company_id, reporter_email, field, message) VALUES (?,?,?,?)',
      cidByName('Tostadero Porteño Café de Origen'), 'usuario6@ejemplo.example', 'Teléfono', 'El teléfono de la ficha no responde (dato de ejemplo).');
  });

  log(`Seed completado: ${data.companies.length} empresas de ejemplo.`);
  if (!config.seed.adminPassword) log('⚠  ADMIN_PASSWORD no definido: no se ha creado el usuario administrador.');
  return true;
}
