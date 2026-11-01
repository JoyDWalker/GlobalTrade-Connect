import { describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers';

// Sin red: la "web" de la empresa y Wikidata se simulan
vi.mock('@/lib/sources/adapters', async (orig) => {
  const real = await orig<typeof import('@/lib/sources/adapters')>();
  return {
    ...real,
    fetchSiteInfo: vi.fn(async (url: string) => {
      const { SourceError } = await import('@/lib/sources/http');
      if (url !== 'https://aceitessierrasur.es/') throw new SourceError('network', 'El dominio no resuelve');
      const html = `<html><head><title>Aceites Sierra Sur | Almazara en Jaén</title><meta name="description" content="Aceite de oliva virgen extra"></head>
        <body><footer>Aceites Sierra Sur S.L. · Tel. +34 953 123 456 · <a href="mailto:info@aceitessierrasur.es">info@aceitessierrasur.es</a></footer></body></html>`;
      return { ...real.parseSite(html, url), finalUrl: url, status: 200, redirected: false };
    }),
  };
});
vi.mock('@/lib/sources/open-data', async (orig) => ({ ...(await orig<typeof import('@/lib/sources/open-data')>()), wikidataByLei: vi.fn(async () => null) }));

describe('tarea discover_website', () => {
  it('una empresa de GLEIF sin web recibe web, email y teléfono con su procedencia', async () => {
    const db = await freshDb();
    const { ingestHit } = await import('@/lib/search/external');
    const { runWorker } = await import('@/lib/jobs/worker');
    const src = (await db.query("SELECT id FROM sources WHERE key = 'gleif'")).rows[0].id;
    const r = await ingestHit(db, { sourceKey: 'gleif', externalId: 'lei:TEST1', name: 'Aceites Sierra Sur Sl', legalName: 'ACEITES SIERRA SUR SL', lei: 'TEST1',
      url: null, domain: null, countryCode: 'ES', city: 'Jaén', snippet: null }, src);
    const job = (await db.query('SELECT type FROM jobs WHERE dedupe_key = $1', [`discover:${r!.id}`])).rows[0];
    expect(job.type).toBe('discover_website');

    const w = await runWorker(db, { timeBudgetMs: 20_000, schedule: false, types: ['discover_website', 'enrich_company'] });
    expect(w.processed.every((p) => p.ok)).toBe(true);
    const c = (await db.query('SELECT name, website, domain, email, phone, website_status, website_discovered_at FROM companies WHERE id = $1', [r!.id])).rows[0];
    expect(c).toMatchObject({ name: 'Aceites Sierra Sur Sl', website: 'https://aceitessierrasur.es/', domain: 'aceitessierrasur.es', email: 'info@aceitessierrasur.es', phone: '+34 953 123 456', website_status: 'ok' });
    expect(c.website_discovered_at).not.toBeNull();
    const prov = (await db.query("SELECT field FROM data_provenance WHERE company_id = $1 AND field IN ('website', 'email', 'phone') ORDER BY field", [r!.id])).rows.map((x: any) => x.field);
    expect(prov).toEqual(['email', 'phone', 'website']);
  });

  it('si no encuentra web lo anota y no lo vuelve a intentar en el lote periódico', async () => {
    const db = await freshDb();
    const { ingestHit } = await import('@/lib/search/external');
    const { runWorker, HANDLERS } = await import('@/lib/jobs/worker');
    const src = (await db.query("SELECT id FROM sources WHERE key = 'gleif'")).rows[0].id;
    const r = await ingestHit(db, { sourceKey: 'gleif', externalId: 'lei:TEST2', name: 'Zzz Inexistente Sl', lei: 'TEST2', url: null, domain: null, countryCode: 'ES', snippet: null }, src);
    await runWorker(db, { timeBudgetMs: 20_000, schedule: false, types: ['discover_website'] });
    const c = (await db.query('SELECT website, website_discovered_at FROM companies WHERE id = $1', [r!.id])).rows[0];
    expect(c.website).toBeNull();
    expect(c.website_discovered_at).not.toBeNull();
    expect(await HANDLERS.discover_missing({ db, job: { id: 0, payload: {} } as any, deadline: Date.now() + 10_000 })).toEqual({ enqueued: 0 });
  });
});
