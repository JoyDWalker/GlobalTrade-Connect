import { describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers';
import { catalogExpansion, expandQuery, type AiCaller, type AiOutput } from '@/lib/search/expand';
import { runExternalSearch } from '@/lib/search/external';
import { webResultsToHits, type SearchAdapter } from '@/lib/sources/adapters';

const dulces: AiOutput = {
  is_product_query: true, sector: 'Alimentación / confitería', category_slug: 'chocolate',
  related_terms: ['caramelos', 'gominolas', 'golosinas', 'Caramelos', 'dulces', 'chocolate'],
  company_types: ['fabricante', 'mayorista', 'inventado'],
  queries: ['fábrica de dulces España', 'distribuidor mayorista de golosinas', 'Fábrica de dulces España', 'empresa importadora de caramelos', 'fabricante de gominolas', 'mayorista de chocolate y snacks', 'candy wholesaler Spain', 'otra más'],
};
const fakeAi = (output: AiOutput | null, stopReason = 'end_turn') => vi.fn<AiCaller>(async () => ({ output, stopReason, model: 'claude-opus-5-5', inputTokens: 2000, outputTokens: 500 }));
const input = { product: 'dulces', types: [], country: 'ES', countryName: 'España', maxQueries: 5, allowAi: true };

describe('expansión de la búsqueda por producto', () => {
  it('con IA: valida y limpia la respuesta, registra el coste y la guarda en caché', async () => {
    const db = await freshDb();
    const ai = fakeAi(dulces);
    const e = await expandQuery(db, input, { ai });
    expect(e?.origin).toBe('ai');
    expect(e?.sector).toBe('Alimentación / confitería');
    expect(e?.categorySlug).toBe('chocolate');
    expect(e?.companyTypes).toEqual(['fabricante', 'mayorista']);           // sin slugs inventados
    expect(e?.relatedTerms).toEqual(['caramelos', 'gominolas', 'golosinas', 'chocolate']); // sin duplicados ni el propio producto
    expect(e?.queries).toHaveLength(5);                                     // máximo pedido y sin duplicados
    expect(new Set(e?.queries.map((q) => q.toLowerCase())).size).toBe(5);
    const log = (await db.query('SELECT status, cost_usd FROM ai_requests')).rows[0];
    expect(log.status).toBe('ok');
    expect(Number(log.cost_usd)).toBeCloseTo((2000 * 4 + 500 * 20) / 1e6, 4);
    // Segunda vez: desde caché, sin llamar a la IA
    expect(await expandQuery(db, input, { ai })).toEqual(e);
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('si la IA falla o declina, usa el catálogo; si no es un producto, no amplía', async () => {
    const db = await freshDb();
    const failing = vi.fn<AiCaller>(async () => { throw new Error('API caída'); });
    const e = await expandQuery(db, { ...input, product: 'aceite de oliva' }, { ai: failing });
    expect(e?.origin).toBe('catalog');
    expect(e?.queries.some((q) => q.includes('aceite de oliva'))).toBe(true);
    expect((await db.query("SELECT status FROM ai_requests")).rows[0].status).toBe('error');

    const refused = await expandQuery(db, { ...input, product: 'cafe' }, { ai: fakeAi(null, 'refusal') });
    expect(refused?.origin).toBe('catalog');
    expect(refused?.categorySlug).toBe('cafe');
    expect(refused?.relatedTerms).toContain('Café verde');

    const company = await expandQuery(db, { ...input, product: 'nestle' }, { ai: fakeAi({ ...dulces, is_product_query: false }) });
    expect(company).toBeNull();
  });

  it('sin permiso para la IA (presupuesto o ajuste) no la llama', async () => {
    const db = await freshDb();
    const ai = fakeAi(dulces);
    const e = await expandQuery(db, { ...input, allowAi: false }, { ai });
    expect(ai).not.toHaveBeenCalled();
    expect(e?.origin).toBe('catalog');
  });

  it('el catálogo usa los tipos pedidos y el país', () => {
    const cat = { categories: [{ slug: 'licores', name: 'Licores', parent_slug: null }], types: [{ slug: 'importador', name: 'Importador' }] };
    const e = catalogExpansion({ ...input, product: 'licor', types: ['importador'] }, cat);
    expect(e.categorySlug).toBe('licores');
    expect(e.queries).toEqual(['importador de licor España', 'importador de licores España']);
  });

  it('la búsqueda externa envía la consulta original y las generadas, y une los resultados', async () => {
    const db = await freshDb();
    const search = vi.fn<SearchAdapter['search']>(async (q) => ({
      hits: webResultsToHits('serper', [{ title: `Empresa ${q}`, url: `https://${q.replace(/[^a-z]/gi, '').toLowerCase()}.example` }], 'ES'),
      httpStatus: 200, attempts: 1, billableRequests: 1,
    }));
    const r = await runExternalSearch(db, { query: 'dulces en España', actorKey: 'x', isUser: false },
      [{ key: 'serper', isConfigured: () => true, search }], { ai: fakeAi(dulces) });
    expect(r.expansion?.origin).toBe('ai');
    expect(r.expansion?.queries[0]).toBe('dulces España empresa');
    expect(search).toHaveBeenCalledTimes(6);                     // max_queries por defecto
    expect(r.sources[0]).toMatchObject({ key: 'serper', status: 'ok', results: 6 });
    expect(r.newCompanies).toBe(6);
  });
});
