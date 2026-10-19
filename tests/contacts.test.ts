import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers';
import { contactSearch, HANDLERS } from '@/lib/jobs/worker';
import { domainMatchesName, placeMatchesName, type FoundContacts } from '@/lib/sources/find-contacts';
import type { SearchAdapter } from '@/lib/sources/adapters';
import { companyCards, searchCompanies } from '@/lib/services/companies';
import { searchParamsFromUrl } from '@/lib/validation';

const original = { ...contactSearch };
afterEach(() => Object.assign(contactSearch, original));

const fakeSerper: SearchAdapter = { key: 'serper', isConfigured: () => true, search: vi.fn() };
async function gleifCompany(db: any, extra = '') {
  const r = await db.query(`INSERT INTO companies (slug, name, legal_name, city, country_code, address, record_status, verification_level, origin${extra ? ', website, domain' : ''})
    VALUES ('cafe-kladdkakan', 'Cafe Kladdkakan i Gamla Stan AB', 'Cafe Kladdkakan i Gamla Stan AB', 'Stockholm', 'SE', 'C/O Cafe Kladdkakan, Stora Nygatan 32', 'detected', 'none', 'external'${extra}) RETURNING id`);
  return r.rows[0].id as string;
}
const run = (db: any, companyId: string) => HANDLERS.enrich_company({ db, job: { id: 1, payload: { companyId } } as any, deadline: Date.now() + 10000 });

describe('contactos de empresas sin web', () => {
  it('reconoce el dominio y la ficha de Maps de la empresa, no los de otras', () => {
    const name = 'Cafe Kladdkakan i Gamla Stan AB';
    expect(domainMatchesName('kladdkakan.se', name)).toBe(true);
    expect(domainMatchesName('cafekladdkakan.com', name)).toBe(true);
    expect(domainMatchesName('www.visitstockholm.com', name)).toBe(false);
    expect(domainMatchesName('cafe.se', name)).toBe(false);
    expect(placeMatchesName('Café Kladdkakan', name)).toBe(true);
    expect(placeMatchesName('Gamla Stans Bryggeri', name)).toBe(false);
  });

  it('guarda el teléfono encontrado con su procedencia y registra la llamada y su coste', async () => {
    const db = await freshDb();
    const id = await gleifCompany(db);
    const found: FoundContacts = { website: null, phone: '+46 8 123 45 67', address: 'Stora Nygatan 32, Stockholm', sourceKey: 'serper', sourceUrl: 'https://www.google.com/maps?cid=1',
      calls: [{ sourceKey: 'serper', query: 'maps: x', status: 'ok', results: 1, ms: 5 }] };
    const find = vi.fn(async () => found);
    Object.assign(contactSearch, { find, webAdapters: () => [fakeSerper] });
    const r: any = await run(db, id);
    expect(find).toHaveBeenCalledWith({ name: 'Cafe Kladdkakan i Gamla Stan AB', city: 'Stockholm', country_code: 'SE' }, expect.objectContaining({ usePlaces: true }));
    expect(r.found).toEqual(['phone']);                                   // la dirección ya existía: no se sobrescribe
    const c = (await db.query('SELECT phone, address, contacts_searched_at IS NOT NULL AS searched FROM companies WHERE id = $1', [id])).rows[0];
    expect(c).toMatchObject({ phone: '+46 8 123 45 67', address: 'C/O Cafe Kladdkakan, Stora Nygatan 32', searched: true });
    const prov = (await db.query("SELECT status, source_url FROM data_provenance WHERE company_id = $1 AND field = 'phone'", [id])).rows[0];
    expect(prov).toEqual({ status: 'detected', source_url: 'https://www.google.com/maps?cid=1' });
    const req = (await db.query("SELECT purpose, status, cost_usd FROM external_requests")).rows[0];
    expect(req.purpose).toBe('enrich');
    expect(Number(req.cost_usd)).toBeGreaterThan(0);
  });

  it('no asigna una web que ya tiene otra ficha, y sin buscador configurado no hace nada', async () => {
    const db = await freshDb();
    await db.query("INSERT INTO companies (slug, name, website, domain, record_status, verification_level, origin) VALUES ('otra', 'Otra', 'https://kladdkakan.se', 'kladdkakan.se', 'published', 'none', 'admin')");
    const id = await gleifCompany(db);
    Object.assign(contactSearch, { find: vi.fn(async () => ({ website: 'https://kladdkakan.se', phone: null, address: null, sourceKey: 'serper', sourceUrl: null, calls: [] })), webAdapters: () => [fakeSerper] });
    const r: any = await run(db, id);
    expect(r.website).toBeNull();
    expect((await db.query('SELECT website FROM companies WHERE id = $1', [id])).rows[0].website).toBeNull();

    Object.assign(contactSearch, { webAdapters: () => [] });
    expect(await run(db, id)).toEqual({ skipped: 'sin web y sin buscador configurado' });
  });

  it('el presupuesto diario agotado detiene la búsqueda', async () => {
    const db = await freshDb();
    const id = await gleifCompany(db);
    await db.query(`UPDATE app_settings SET value = jsonb_set(value, '{daily_budget_usd}', '0') WHERE key = 'limits'`);
    const find = vi.fn();
    Object.assign(contactSearch, { find, webAdapters: () => [fakeSerper] });
    expect(await run(db, id)).toEqual({ skipped: 'presupuesto diario de APIs agotado' });
    expect(find).not.toHaveBeenCalled();
  });

  it('programa la búsqueda para las detectadas sin teléfono ni correo', async () => {
    const db = await freshDb();
    const id = await gleifCompany(db);
    expect(await HANDLERS.fill_contacts({ db, job: {} as any, deadline: Date.now() + 10000 })).toEqual({ queued: 0 });   // sin buscador
    Object.assign(contactSearch, { webAdapters: () => [fakeSerper] });
    expect(await HANDLERS.fill_contacts({ db, job: {} as any, deadline: Date.now() + 10000 })).toEqual({ queued: 1 });
    expect((await db.query("SELECT payload->>'companyId' AS id FROM jobs WHERE type = 'enrich_company'")).rows[0].id).toBe(id);
  });

  it('filtra las contactables, las ordena primero y calcula las señales', async () => {
    const db = await freshDb();
    const id = await gleifCompany(db);
    await db.query("INSERT INTO companies (slug, name, city, country_code, phone, website, domain, website_status, record_status, verification_level, origin) VALUES ('kladdkakan-cafe', 'Kladdkakan Cafe Stockholm', 'Stockholm', 'SE', '+46 8 1', 'https://kladd.example', 'kladd.example', 'ok', 'detected', 'none', 'external')");
    await db.query("UPDATE companies SET lei = '549300TEST', search_text = 'cafe kladdkakan' WHERE id = $1", [id]);
    await db.query("UPDATE companies SET search_text = 'cafe kladdkakan' WHERE slug = 'kladdkakan-cafe'");
    const all = await searchCompanies(db, searchParamsFromUrl(new URLSearchParams('q=kladdkakan')));
    expect(all.items.map((c) => c.slug)).toEqual(['kladdkakan-cafe', 'cafe-kladdkakan']);   // la contactable primero
    const only = await searchCompanies(db, searchParamsFromUrl(new URLSearchParams('q=kladdkakan&contact=1')));
    expect(only.items.map((c) => c.slug)).toEqual(['kladdkakan-cafe']);

    await db.query("INSERT INTO data_provenance (company_id, field, value, source_url, status) VALUES ($1, 'phone', '+46', 'https://www.google.com/maps?cid=1', 'detected')", [id]);
    const [gleif, web] = await companyCards(db, [id, only.items[0].id]);
    expect(gleif).toMatchObject({ sig_registry: true, sig_website: false, sig_maps: true });
    expect(web).toMatchObject({ sig_registry: false, sig_website: true, sig_maps: false });
  });
});
