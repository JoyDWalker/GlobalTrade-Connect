import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers';

// La clave debe existir antes de la primera lectura del entorno (env() se cachea por proceso)
vi.hoisted(() => { process.env.FIRECRAWL_API_KEY = 'fc-test'; });

// Sin red: la web "se pinta con JavaScript" (la descarga directa llega vacía) y Firecrawl devuelve la versión renderizada
vi.mock('@/lib/sources/adapters', async (orig) => {
  const real = await orig<typeof import('@/lib/sources/adapters')>();
  const site = (html: string, url: string) => ({ ...real.parseSite(html, url), finalUrl: url, status: 200, redirected: false });
  return {
    ...real,
    fetchSiteInfo: vi.fn(async (url: string) => site('<html><head><title>Cargando…</title></head><body><div id="root"></div></body></html>', url)),
    firecrawlSiteInfo: vi.fn(async (url: string) => ({
      info: site(`<html><head><title>Conservas Ría Baja</title></head><body><main>Conservas artesanas de pescado desde 1950. Fábrica en Vigo.
        Escríbenos a <a href="mailto:ventas@riabaja.example">ventas@riabaja.example</a> · Tel. +34 986 000 111</main></body></html>`, url),
      credits: 2, httpStatus: 200,
    })),
  };
});

afterEach(() => vi.unstubAllGlobals());

describe('adaptador de búsqueda Firecrawl', () => {
  it('convierte los resultados en empresas y factura los créditos usados', async () => {
    const { firecrawl } = await import('@/lib/sources/adapters');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true, creditsUsed: 2,
      data: { web: [
        { title: 'Conservas Ría Baja | Conservas artesanas', url: 'https://www.riabaja.example/productos', description: 'Fábrica en Vigo' },
        { title: 'Conservas Ría Baja en LinkedIn', url: 'https://www.linkedin.com/company/riabaja' },
      ] },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await firecrawl.search('"Conservas Ría Baja" Vigo', { limit: 8, country: 'ES', timeoutMs: 8000 });
    expect(r.billableRequests).toBe(2);
    expect(r.hits).toHaveLength(1);                      // las redes sociales se descartan
    expect(r.hits[0]).toMatchObject({ sourceKey: 'firecrawl', domain: 'riabaja.example', name: 'Conservas Ría Baja', countryCode: 'ES' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.firecrawl.dev/v2/search');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fc-test');
    expect(JSON.parse(String(init.body))).toMatchObject({ query: '"Conservas Ría Baja" Vigo', limit: 8, country: 'ES' });
  });

  it('sin créditos (HTTP 402) avisa de cuota agotada', async () => {
    const { firecrawl } = await import('@/lib/sources/adapters');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"success":false,"error":"Insufficient credits"}', { status: 402 })));
    await expect(firecrawl.search('x', { limit: 5, timeoutMs: 1000 })).rejects.toMatchObject({ kind: 'quota_exceeded' });
  });

  it('detecta las páginas que llegan vacías', async () => {
    const { looksEmpty } = await import('@/lib/sources/adapters');
    expect(looksEmpty({ text: 'Cargando…', emails: [], phones: [] })).toBe(true);
    expect(looksEmpty({ text: 'Cargando…', emails: [], phones: ['+34 986 000 111'] })).toBe(false);
    expect(looksEmpty({ text: 'x '.repeat(400), emails: [], phones: [] })).toBe(false);
  });
});

describe('enrich_company con una web que necesita JavaScript', () => {
  it('lee la web con Firecrawl, guarda email y teléfono y anota el coste', async () => {
    const db = await freshDb();
    const { runWorker } = await import('@/lib/jobs/worker');
    const { enqueue } = await import('@/lib/jobs/queue');
    const { firecrawlSiteInfo } = await import('@/lib/sources/adapters');
    const id = (await db.query(`INSERT INTO companies (name, slug, website, domain, country_code, origin, record_status)
      VALUES ('Conservas Ría Baja', 'conservas-ria-baja', 'https://riabaja.example/', 'riabaja.example', 'ES', 'external', 'detected') RETURNING id`)).rows[0].id;
    await enqueue(db, 'enrich_company', { companyId: id });

    const w = await runWorker(db, { timeBudgetMs: 20_000, schedule: false, types: ['enrich_company'] });
    expect(w.processed.every((p) => p.ok)).toBe(true);
    expect(firecrawlSiteInfo).toHaveBeenCalledWith('https://riabaja.example/');
    const c = (await db.query('SELECT email, phone FROM companies WHERE id = $1', [id])).rows[0];
    expect(c).toEqual({ email: 'ventas@riabaja.example', phone: '+34 986 000 111' });
    const req = (await db.query(`SELECT r.status, r.cost_usd FROM external_requests r JOIN sources s ON s.id = r.source_id WHERE s.key = 'firecrawl'`)).rows;
    expect(req).toHaveLength(1);
    expect(req[0].status).toBe('ok');
    expect(Number(req[0].cost_usd)).toBeCloseTo(0.005);   // 2 créditos × 2,5 USD/1.000
  });

  it('no gasta créditos si la fuente está desactivada', async () => {
    const db = await freshDb();
    const { runWorker } = await import('@/lib/jobs/worker');
    const { enqueue } = await import('@/lib/jobs/queue');
    const { firecrawlSiteInfo } = await import('@/lib/sources/adapters');
    vi.mocked(firecrawlSiteInfo).mockClear();
    await db.query("UPDATE sources SET enabled = false WHERE key = 'firecrawl'");
    const id = (await db.query(`INSERT INTO companies (name, slug, website, domain, country_code, origin, record_status)
      VALUES ('Conservas Ría Baja', 'conservas-ria-baja', 'https://riabaja.example/', 'riabaja.example', 'ES', 'external', 'detected') RETURNING id`)).rows[0].id;
    await enqueue(db, 'enrich_company', { companyId: id });
    await runWorker(db, { timeBudgetMs: 20_000, schedule: false, types: ['enrich_company'] });
    expect(firecrawlSiteInfo).not.toHaveBeenCalled();
  });
});
