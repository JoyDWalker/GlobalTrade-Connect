import { describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers';
import { runExternalSearch } from '@/lib/search/external';
import type { SearchAdapter } from '@/lib/sources/adapters';
import { webResultsToHits } from '@/lib/sources/adapters';
import { SourceError } from '@/lib/sources/http';
import { searchCompanies } from '@/lib/services/companies';
import { searchParamsFromUrl } from '@/lib/validation';

const fakeAdapter = (key: string, impl: SearchAdapter['search']): SearchAdapter => ({ key, isConfigured: () => true, search: impl });
const okHits = (key: string) => vi.fn(async () => ({
  hits: webResultsToHits(key, [
    { title: 'Envases Sostenibles del Norte | Fabricante de envases compostables', url: 'https://www.envases-norte.example/es', snippet: 'Fabricante de envases compostables para café' },
    { title: 'Envases en Amazon', url: 'https://www.amazon.com/s?k=envases', snippet: 'marketplace' },
    { title: 'Otra página de la misma empresa', url: 'https://envases-norte.example/contacto' },
  ], 'MX'),
  httpStatus: 200, attempts: 1, billableRequests: 1,
}));

describe('búsqueda externa', () => {
  it('normaliza, filtra marketplaces, deduplica por dominio y guarda como "detectada" con procedencia', async () => {
    const db = await freshDb();
    const search = okHits('brave');
    const query = 'busco fabricantes de envases compostables en México';
    const r = await runExternalSearch(db, { query, actorKey: 'ip1', isUser: false }, [fakeAdapter('brave', search)]);
    expect(r.status).toBe('ok');
    expect(r.newCompanies).toBe(1);
    expect(r.items[0].record_status).toBe('detected');
    expect(r.items[0].domain).toBe('envases-norte.example');
    const prov = await db.query('SELECT field, status FROM data_provenance WHERE company_id = $1 ORDER BY field', [r.items[0].id]);
    expect(prov.rows.map((x: any) => x.field)).toEqual(['country_code', 'name', 'website']);
    const task = await db.query('SELECT kind FROM review_tasks WHERE company_id = $1', [r.items[0].id]);
    expect(task.rows[0].kind).toBe('new_detected');
    const job = await db.query('SELECT type FROM jobs WHERE dedupe_key = $1', [`enrich:${r.items[0].id}`]);
    expect(job.rows[0].type).toBe('enrich_company');

    // Segunda vez: caché, sin llamar a la API y sin duplicar la empresa
    const r2 = await runExternalSearch(db, { query, actorKey: 'ip1', isUser: false }, [fakeAdapter('brave', search)]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(r2.sources[0].status).toBe('cached');
    expect(r2.newCompanies).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM companies')).rows[0].n).toBe(1);
    // La empresa guardada aparece después en la búsqueda interna aunque la consulta indique un tipo
    const internal = await searchCompanies(db, searchParamsFromUrl(new URLSearchParams({ q: query })));
    expect(internal.items.map((c) => c.domain)).toContain('envases-norte.example');
  });

  it('guarda el email y el teléfono que aporta la fuente y los completa si ya existía', async () => {
    const db = await freshDb();
    const { ingestHit } = await import('@/lib/search/external');
    const src = (await db.query("SELECT id FROM sources WHERE key = 'wikidata'")).rows[0].id;
    const r = await ingestHit(db, { sourceKey: 'wikidata', externalId: 'wikidata:Q1', name: 'Acme', url: 'https://acme.example', domain: 'acme.example', snippet: null, email: 'info@acme.example', phone: '+34 900 000 000' }, src);
    const c = (await db.query('SELECT email, phone FROM companies WHERE id = $1', [r!.id])).rows[0];
    expect(c).toEqual({ email: 'info@acme.example', phone: '+34 900 000 000' });
    const prov = (await db.query("SELECT field FROM data_provenance WHERE company_id = $1 AND field IN ('email', 'phone')", [r!.id])).rows;
    expect(prov).toHaveLength(2);
  });

  it('si la fuente falla, no lanza y los datos guardados siguen disponibles', async () => {
    const db = await freshDb({ demo: true });
    const failing = fakeAdapter('brave', async () => { throw new SourceError('timeout', 'Tiempo de espera agotado'); });
    const r = await runExternalSearch(db, { query: 'café verde Colombia', actorKey: 'ip2', isUser: false }, [failing]);
    expect(r.status).toBe('failed');
    expect(r.sources[0].status).toBe('timeout');
    const logged = await db.query('SELECT status FROM external_requests ORDER BY id DESC LIMIT 1');
    expect(logged.rows[0].status).toBe('timeout');
    const stored = await searchCompanies(db, searchParamsFromUrl(new URLSearchParams('q=café verde Colombia')));
    expect(stored.total).toBeGreaterThan(0);
  });

  it('respeta la cuota diaria de la fuente y el límite por usuario', async () => {
    const db = await freshDb();
    await db.query("UPDATE sources SET daily_quota = 1 WHERE key = 'brave'");
    const search = okHits('brave');
    await runExternalSearch(db, { query: 'envases compostables', actorKey: 'u1', isUser: true }, [fakeAdapter('brave', search)]);
    const r = await runExternalSearch(db, { query: 'otra consulta diferente', actorKey: 'u1', isUser: true }, [fakeAdapter('brave', search)]);
    expect(r.sources[0].status).toBe('quota_exceeded');
    expect(search).toHaveBeenCalledTimes(1);

    await db.query(`UPDATE app_settings SET value = jsonb_set(value, '{external_per_day_anon}', '1') WHERE key = 'limits'`);
    await runExternalSearch(db, { query: 'x1 envases', actorKey: 'anon-9', isUser: false }, [fakeAdapter('brave', search)]);
    const limited = await runExternalSearch(db, { query: 'x2 envases', actorKey: 'anon-9', isUser: false }, [fakeAdapter('brave', search)]);
    expect(limited.status).toBe('skipped');
    expect(limited.reason).toMatch(/límite diario/);
  });

  it('sin fuentes configuradas lo indica sin error', async () => {
    const db = await freshDb();
    const r = await runExternalSearch(db, { query: 'maquinaria industrial', actorKey: 'a', isUser: false }, [{ key: 'brave', isConfigured: () => false, search: vi.fn() }]);
    expect(r.status).toBe('skipped');
    expect(r.sources.find((s) => s.key === 'brave')?.status).toBe('not_configured');
  });
});
