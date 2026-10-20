import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers';
import { contactSearch, HANDLERS } from '@/lib/jobs/worker';
import { domainMatchesName, findContacts, nameTokens, placeMatchesName, type FoundContacts } from '@/lib/sources/find-contacts';
import { candidateDomains, pageMatches } from '@/lib/sources/guess-domain';
import { parseOverpass } from '@/lib/sources/osm';
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

  it('guarda los datos encontrados con la fuente de cada uno y registra las llamadas y su coste', async () => {
    const db = await freshDb();
    const id = await gleifCompany(db);
    const osmUrl = 'https://www.openstreetmap.org/node/1';
    const found: FoundContacts = { website: null, phone: '+46 8 123 45 67', email: 'Hej@Kladdkakan.se', address: 'Stora Nygatan 32, Stockholm',
      origin: { phone: { sourceKey: 'osm', url: osmUrl }, email: { sourceKey: 'osm', url: osmUrl }, address: { sourceKey: 'osm', url: osmUrl } },
      calls: [{ sourceKey: 'osm', query: 'osm: Kladdkakan @ Stockholm', status: 'ok', results: 1, ms: 5 }, { sourceKey: 'serper', query: 'maps: x', status: 'ok', results: 0, ms: 5 }] };
    const find = vi.fn(async () => found);
    Object.assign(contactSearch, { find, webAdapters: () => [fakeSerper] });
    const r: any = await run(db, id);
    expect(find).toHaveBeenCalledWith({ name: 'Cafe Kladdkakan i Gamla Stan AB', city: 'Stockholm', country_code: 'SE' }, expect.objectContaining({ usePlaces: true }));
    expect(r.found).toEqual(['phone', 'email']);                          // la dirección ya existía: no se sobrescribe
    const c = (await db.query('SELECT phone, email, address, contacts_searched_at IS NOT NULL AS searched FROM companies WHERE id = $1', [id])).rows[0];
    expect(c).toMatchObject({ phone: '+46 8 123 45 67', email: 'Hej@Kladdkakan.se', address: 'C/O Cafe Kladdkakan, Stora Nygatan 32', searched: true });
    const prov = (await db.query("SELECT p.status, p.source_url, s.key FROM data_provenance p JOIN sources s ON s.id = p.source_id WHERE p.company_id = $1 AND p.field = 'phone'", [id])).rows[0];
    expect(prov).toEqual({ status: 'detected', source_url: osmUrl, key: 'osm' });
    const reqs = (await db.query("SELECT s.key, r.purpose, r.cost_usd FROM external_requests r JOIN sources s ON s.id = r.source_id ORDER BY r.id")).rows;
    expect(reqs.map((x: any) => [x.key, x.purpose, Number(x.cost_usd) > 0])).toEqual([['osm', 'enrich', false], ['serper', 'enrich', true]]);
  });

  it('no asigna una web que ya tiene otra ficha; sin claves de pago usa solo las fuentes gratuitas', async () => {
    const db = await freshDb();
    await db.query("INSERT INTO companies (slug, name, website, domain, record_status, verification_level, origin) VALUES ('otra', 'Otra', 'https://kladdkakan.se', 'kladdkakan.se', 'published', 'none', 'admin')");
    const id = await gleifCompany(db);
    const find = vi.fn(async () => ({ website: 'https://kladdkakan.se', phone: null, email: null, address: null, origin: { website: { sourceKey: 'website', url: 'https://kladdkakan.se' } }, calls: [] }));
    Object.assign(contactSearch, { find, webAdapters: () => [] });
    const r: any = await run(db, id);
    expect(r.website).toBeNull();
    expect((await db.query('SELECT website FROM companies WHERE id = $1', [id])).rows[0].website).toBeNull();
    expect(find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ webAdapters: [], usePlaces: false }));
  });

  it('con el presupuesto diario agotado no usa las fuentes de pago, pero sí las gratuitas', async () => {
    const db = await freshDb();
    const id = await gleifCompany(db);
    await db.query(`UPDATE app_settings SET value = jsonb_set(value, '{daily_budget_usd}', '0') WHERE key = 'limits'`);
    const find = vi.fn(async () => ({ website: null, phone: null, email: null, address: null, origin: {}, calls: [] }));
    Object.assign(contactSearch, { find, webAdapters: () => [fakeSerper] });
    await run(db, id);
    expect(find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ webAdapters: [], usePlaces: false }));
  });

  it('programa la búsqueda para las detectadas sin teléfono ni correo', async () => {
    const db = await freshDb();
    const id = await gleifCompany(db);
    expect(await HANDLERS.fill_contacts({ db, job: {} as any, deadline: Date.now() + 10000 })).toEqual({ queued: 1 });
    expect((await db.query("SELECT payload->>'companyId' AS id FROM jobs WHERE type = 'enrich_company'")).rows[0].id).toBe(id);
  });

  it('fuentes gratuitas: OpenStreetMap primero y, si no hay web, la deduce por el nombre', async () => {
    const osm = vi.fn(async () => ({ httpStatus: 200, attempts: 1, places: [
      { name: 'Gamla Stans Bryggeri', phone: '+46 1', email: null, website: null, address: null, url: 'https://www.openstreetmap.org/node/9' },
      { name: 'Café Kladdkakan', phone: '+46 8 123', email: 'hej@kladdkakan.se', website: null, address: 'Stora Nygatan 32', url: 'https://www.openstreetmap.org/node/1' },
    ] }));
    const guess = vi.fn(async () => ({ website: 'https://kladdkakan.se', tried: ['cafekladdkakan.se', 'kladdkakan.se'] }));
    const r = await findContacts({ name: 'Cafe Kladdkakan i Gamla Stan AB', city: 'Stockholm', country_code: 'SE' }, { webAdapters: [], usePlaces: false, osm, guess });
    expect(osm).toHaveBeenCalledWith('Kladdkakan', 'Stockholm');
    expect(r).toMatchObject({ phone: '+46 8 123', email: 'hej@kladdkakan.se', website: 'https://kladdkakan.se' });
    expect(r.origin.phone?.sourceKey).toBe('osm');
    expect(r.origin.website?.sourceKey).toBe('website');
    // Sin ciudad no se consulta OpenStreetMap (sería buscar en un país entero)
    osm.mockClear();
    await findContacts({ name: 'Cafe Kladdkakan i Gamla Stan AB', city: null, country_code: 'SE' }, { webAdapters: [], usePlaces: false, osm, guess });
    expect(osm).not.toHaveBeenCalled();
  });

  it('deduce dominios candidatos y solo acepta una página que sea de la empresa', () => {
    expect(candidateDomains(nameTokens('Cafe Kladdkakan i Gamla Stan AB'), 'SE')).toEqual(['kladdkakan.se', 'kladdkakan.com', 'cafekladdkakan.se', 'cafekladdkakan.com', 'cafe-kladdkakan.se', 'cafe-kladdkakan.com']);
    expect(candidateDomains(nameTokens('Aceites Oleomar SL'), 'GB')).toContain('aceitesoleomar.co.uk');
    const tokens = nameTokens('Cafe Kladdkakan i Gamla Stan AB');
    expect(pageMatches('<title>Kladdkakan – Café i Gamla Stan</title><p>Välkommen</p>', tokens, 'Stockholm')).toBe(true);
    expect(pageMatches('<title>Domain for sale: kladdkakan.se</title>', tokens, 'Stockholm')).toBe(false);
    expect(pageMatches('<title>Gamla Stan Café</title>', tokens, 'Stockholm')).toBe(false);
  });

  it('interpreta la respuesta de OpenStreetMap', () => {
    const places = parseOverpass({ elements: [{ type: 'node', id: 7, tags: { name: 'Café Kladdkakan', 'contact:phone': '+46 8 1', 'addr:street': 'Stora Nygatan', 'addr:housenumber': '32', 'addr:city': 'Stockholm', website: 'https://kladdkakan.se' } }, { type: 'way', id: 1, tags: {} }] });
    expect(places).toEqual([{ name: 'Café Kladdkakan', phone: '+46 8 1', email: null, website: 'https://kladdkakan.se', address: 'Stora Nygatan 32, Stockholm', url: 'https://www.openstreetmap.org/node/7' }]);
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

describe('webs que no responden', () => {
  it('una web que no existe queda marcada como caída sin que la tarea falle ni se reintente', async () => {
    const db = await freshDb();
    const id = await gleifCompany(db, ", 'https://empresa-cerrada.invalid', 'empresa-cerrada.invalid'");
    const r: any = await HANDLERS.enrich_company({ db, job: { id: 1, attempts: 1, max_attempts: 3, payload: { companyId: id } } as any, deadline: Date.now() + 10000 });
    expect(r).toEqual({ unreachable: 'El dominio no resuelve' });
    expect((await db.query('SELECT website_status FROM companies WHERE id = $1', [id])).rows[0].website_status).toBe('broken');
  });
});
