// Búsqueda en fuentes externas autorizadas: caché, cuotas, presupuesto, reintentos y tolerancia a fallos.
// Nunca lanza: devuelve el estado por fuente para que la interfaz siga mostrando los datos almacenados.
import crypto from 'node:crypto';
import type { Db, Queryable } from '../db';
import { many, one } from '../db';
import { log, alert } from '../logger';
import { getSetting } from '../settings';
import { hit } from '../rate-limit';
import { normalize } from '../text';
import { companyCards, countryNameMap, findDuplicate, refreshSearchText, type CompanyCard } from '../services/companies';
import { enqueue } from '../jobs/queue';
import type { CompanyHit, SearchAdapter } from '../sources/adapters';
import { SEARCH_ADAPTERS } from '../sources/registry';
import { SourceError } from '../sources/http';
import { parseQuery } from './query';

export type SourceStatus = 'ok' | 'cached' | 'error' | 'timeout' | 'quota_exceeded' | 'rate_limited' | 'disabled' | 'not_configured' | 'budget_exceeded';
export interface ExternalOutcome {
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  reason?: string;
  sources: { key: string; name: string; status: SourceStatus; results: number; message?: string }[];
  newCompanies: number;
  items: CompanyCard[];
}

export interface ExternalRequest { query: string; country?: string | null; actorKey: string; isUser: boolean; jobId?: number | null; force?: boolean }

const cacheKey = (source: string, query: string, country?: string | null) =>
  crypto.createHash('sha256').update(`${source}|${normalize(query)}|${country ?? ''}`).digest('hex');

async function spentTodayUsd(q: Queryable) {
  const r = await one<{ usd: string }>(q, "SELECT coalesce(sum(cost_usd), 0) AS usd FROM external_requests WHERE created_at >= date_trunc('day', now())");
  return Number(r?.usd ?? 0);
}

async function usedToday(q: Queryable, sourceId: number) {
  const r = await one<{ n: string }>(q, `SELECT count(*) AS n FROM external_requests WHERE source_id = $1 AND created_at >= date_trunc('day', now())
    AND status IN ('ok', 'error', 'timeout', 'rate_limited')`, [sourceId]);
  return Number(r?.n ?? 0);
}

async function logRequest(q: Queryable, r: { sourceId: number; purpose: string; query: string; status: string; httpStatus?: number | null; attempts?: number; durationMs: number; results?: number; costUsd?: number; error?: string | null; jobId?: number | null }) {
  await q.query(`INSERT INTO external_requests (source_id, purpose, query, status, http_status, attempts, duration_ms, results, cost_usd, error, job_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [r.sourceId, r.purpose, r.query.slice(0, 300), r.status, r.httpStatus ?? null, r.attempts ?? 1, r.durationMs, r.results ?? 0, r.costUsd ?? 0, r.error?.slice(0, 500) ?? null, r.jobId ?? null]);
}

/**
 * Inserta o actualiza una empresa detectada. Deduplica por dominio (y nombre+país como aviso).
 * Devuelve el id y si es nueva. Los datos quedan como "detectados", con su procedencia.
 */
export async function ingestHit(db: Db, h: CompanyHit, sourceId: number): Promise<{ id: string; created: boolean } | null> {
  if (!h.name || h.name.length < 2) return null;
  const srcUrl = h.url ?? ((h.raw as any)?.url as string | undefined) ?? null;
  return db.tx(async (q) => {
    const existing = await one<{ company_id: string }>(q, 'SELECT company_id FROM company_sources WHERE source_id = $1 AND external_id = $2', [sourceId, h.externalId]);
    const dup = existing ? { existing: { id: existing.company_id } } : await findDuplicate(q, { domain: h.domain, lei: h.lei ?? null });
    if (dup) {
      const id = dup.existing.id;
      await q.query(`INSERT INTO company_sources (company_id, source_id, external_id, source_url, title, snippet, raw) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (source_id, external_id) DO UPDATE SET last_seen_at = now(), snippet = EXCLUDED.snippet, title = EXCLUDED.title`,
      [id, sourceId, h.externalId, srcUrl, h.name, h.snippet, JSON.stringify(h.raw ?? null)]);
      return { id, created: false };
    }
    const slugBase = normalize(h.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'empresa';
    let slug = slugBase;
    for (let i = 2; await one(q, 'SELECT 1 FROM companies WHERE slug = $1', [slug]); i++) slug = `${slugBase}-${i}`;
    const country = h.countryCode && (await one(q, 'SELECT 1 FROM countries WHERE iso_code = $1', [h.countryCode])) ? h.countryCode : null;
    const row = await one<{ id: string }>(q, `INSERT INTO companies (slug, name, legal_name, lei, city, address, website, domain, country_code, record_status, verification_level, origin, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'detected','none','external',NULL) RETURNING id`, [slug, h.name, h.legalName ?? null, h.lei ?? null, h.city ?? null, h.address ?? null, h.url, h.domain, country]);
    const id = row!.id;
    await q.query(`INSERT INTO company_sources (company_id, source_id, external_id, source_url, title, snippet, raw) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, sourceId, h.externalId, srcUrl, h.name, h.snippet, JSON.stringify(h.raw ?? null)]);
    for (const [field, value] of [['name', h.name], ['legal_name', h.legalName], ['lei', h.lei], ['city', h.city], ['address', h.address], ['website', h.url], ['country_code', country]] as const) {
      if (value) await q.query("INSERT INTO data_provenance (company_id, field, value, source_id, source_url, status) VALUES ($1,$2,$3,$4,$5,'detected')", [id, field, value, sourceId, srcUrl]);
    }
    await refreshSearchText(q, id);
    // El snippet ayuda a encontrarla, pero no se presenta como descripción verificada
    if (h.snippet) await q.query("UPDATE companies SET search_text = search_text || ' ' || $2 WHERE id = $1", [id, normalize(h.snippet)]);
    await q.query(`INSERT INTO review_tasks (company_id, kind, priority, details, dedupe_key) VALUES ($1, 'new_detected', 20, $2, $3)
      ON CONFLICT (dedupe_key) WHERE status = 'open' AND dedupe_key IS NOT NULL DO NOTHING`, [id, JSON.stringify({ source: h.sourceKey, url: h.url }), `new_detected:${id}`]);
    await enqueue(q, 'enrich_company', { companyId: id }, { dedupeKey: `enrich:${id}`, priority: 40 });
    return { id, created: true };
  });
}

async function runAdapter(db: Db, adapter: SearchAdapter, src: { id: number; name: string; daily_quota: number | null; cost_per_1000_usd: string }, req: ExternalRequest, query: string, limit: number, timeoutMs: number, cacheHours: number) {
  const key = cacheKey(adapter.key, query, req.country);
  if (!req.force) {
    const cached = await one<{ results: any }>(db, 'SELECT results FROM search_cache WHERE cache_key = $1 AND expires_at > now()', [key]);
    if (cached) {
      const hits = (typeof cached.results === 'string' ? JSON.parse(cached.results) : cached.results) as CompanyHit[];
      await logRequest(db, { sourceId: src.id, purpose: 'search', query, status: 'cached', durationMs: 0, results: hits.length, jobId: req.jobId });
      return { status: 'cached' as const, hits };
    }
  }
  if (src.daily_quota != null && (await usedToday(db, src.id)) >= src.daily_quota) {
    await logRequest(db, { sourceId: src.id, purpose: 'search', query, status: 'quota_exceeded', durationMs: 0, jobId: req.jobId });
    return { status: 'quota_exceeded' as const, hits: [], message: 'Cuota diaria de la fuente alcanzada' };
  }
  const started = Date.now();
  try {
    const r = await adapter.search(query, { limit, country: req.country, timeoutMs });
    const cost = (Number(src.cost_per_1000_usd) / 1000) * r.billableRequests;
    await logRequest(db, { sourceId: src.id, purpose: 'search', query, status: 'ok', httpStatus: r.httpStatus, attempts: r.attempts, durationMs: Date.now() - started, results: r.hits.length, costUsd: cost, jobId: req.jobId });
    await db.query(`INSERT INTO search_cache (cache_key, source_id, query, results, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(hours => $5))
      ON CONFLICT (cache_key) DO UPDATE SET results = EXCLUDED.results, fetched_at = now(), expires_at = EXCLUDED.expires_at`,
    [key, src.id, query, JSON.stringify(r.hits), cacheHours]);
    return { status: 'ok' as const, hits: r.hits };
  } catch (e) {
    const se = e instanceof SourceError ? e : new SourceError('network', (e as Error).message);
    const status: SourceStatus = se.kind === 'timeout' ? 'timeout' : se.kind === 'quota_exceeded' ? 'quota_exceeded' : se.kind === 'rate_limited' ? 'rate_limited' : 'error';
    await logRequest(db, { sourceId: src.id, purpose: 'search', query, status, httpStatus: se.httpStatus, durationMs: Date.now() - started, error: se.message, jobId: req.jobId });
    log.warn('Fuente externa con error', { source: adapter.key, status, error: se.message });
    return { status, hits: [], message: se.message };
  }
}

export async function runExternalSearch(db: Db, req: ExternalRequest, adapters: SearchAdapter[] = SEARCH_ADAPTERS): Promise<ExternalOutcome> {
  const empty = (status: ExternalOutcome['status'], reason: string, sources: ExternalOutcome['sources'] = []): ExternalOutcome => ({ status, reason, sources, newCompanies: 0, items: [] });
  try {
    const cfg = await getSetting(db, 'external_search');
    const limits = await getSetting(db, 'limits');
    if (!cfg.enabled) return empty('skipped', 'La búsqueda externa está desactivada');
    const parsed = parseQuery(req.query, await countryNameMap(db));
    if (!parsed.terms.length) return empty('skipped', 'Consulta demasiado genérica para buscar fuera');
    const country = req.country ?? parsed.countries[0] ?? null;

    // Límite por usuario/IP (un usuario no puede agotar la cuota de todos)
    const usage = await hit(db, `ext:${req.actorKey}`, req.isUser ? limits.external_per_day_user : limits.external_per_day_anon, 86400, { throwOnLimit: false });
    if (!usage.allowed) return empty('skipped', 'Has alcanzado tu límite diario de búsquedas externas');

    const srcRows = await many<{ id: number; key: string; name: string; enabled: boolean; daily_quota: number | null; cost_per_1000_usd: string; reliability: number }>(db,
      "SELECT id, key, name, enabled, daily_quota, cost_per_1000_usd, reliability FROM sources WHERE key = ANY($1::text[]) ORDER BY reliability DESC", [adapters.map((a) => a.key)]);
    const results: ExternalOutcome['sources'] = [];
    const tasks: Promise<{ src: (typeof srcRows)[number]; status: SourceStatus; hits: CompanyHit[]; message?: string }>[] = [];
    const overBudget = (await spentTodayUsd(db)) >= limits.daily_budget_usd;
    if (overBudget) alert('Presupuesto diario de APIs de búsqueda alcanzado', { budget: limits.daily_budget_usd }).catch(() => {});
    // Para las APIs externas se envían los términos útiles + tipos (sin palabras vacías)
    const countryName = country ? (await one<{ name: string }>(db, 'SELECT name FROM countries WHERE iso_code = $1', [country]))?.name : null;
    const apiQuery = [...parsed.terms, ...parsed.types, countryName].filter(Boolean).join(' ') + (parsed.types.length ? '' : ' empresa');

    for (const src of srcRows) {
      const adapter = adapters.find((a) => a.key === src.key);
      if (!adapter) continue;
      if (!src.enabled) { results.push({ key: src.key, name: src.name, status: 'disabled', results: 0 }); continue; }
      if (!adapter.isConfigured()) { results.push({ key: src.key, name: src.name, status: 'not_configured', results: 0 }); continue; }
      if (overBudget && Number(src.cost_per_1000_usd) > 0) { results.push({ key: src.key, name: src.name, status: 'budget_exceeded', results: 0 }); continue; }
      const q = adapter.queryStyle === 'plain' ? parsed.phrase || parsed.words.join(' ') : apiQuery;
      tasks.push(runAdapter(db, adapter, src, { ...req, country }, q, cfg.max_results_per_source, cfg.timeout_ms, cfg.cache_hours).then((r) => ({ src, ...r })));
    }

    // Tiempo máximo global: lo que no termine a tiempo se descarta (los registros quedan para la próxima vez)
    const deadline = new Promise<'deadline'>((r) => setTimeout(() => r('deadline'), cfg.timeout_ms + 3000));
    const settled = await Promise.race([Promise.allSettled(tasks), deadline]);
    const done = settled === 'deadline' ? [] : settled;
    if (settled === 'deadline') log.warn('Búsqueda externa: tiempo global agotado', { query: req.query });

    const ids: string[] = [];
    let newCompanies = 0;
    for (const s of done) {
      if (s.status !== 'fulfilled') continue;
      const { src, status, hits, message } = s.value;
      let count = 0;
      for (const h of hits) {
        try {
          const r = await ingestHit(db, { ...h, countryCode: h.countryCode ?? country }, src.id);
          if (r) { count++; if (!ids.includes(r.id)) ids.push(r.id); if (r.created) newCompanies++; }
        } catch (e) {
          log.warn('No se pudo guardar un resultado externo', { source: src.key, error: e });
        }
      }
      results.push({ key: src.key, name: src.name, status, results: count, message });
    }
    if (settled === 'deadline') for (const src of srcRows) if (!results.some((r) => r.key === src.key)) results.push({ key: src.key, name: src.name, status: 'timeout', results: 0 });

    const usable = results.filter((r) => r.status === 'ok' || r.status === 'cached');
    const attempted = results.filter((r) => !['disabled', 'not_configured'].includes(r.status));
    const status: ExternalOutcome['status'] = !attempted.length ? 'skipped' : usable.length === attempted.length ? 'ok' : usable.length ? 'partial' : 'failed';
    const items = (await companyCards(db, ids)).filter((c) => c.record_status === 'published' || c.record_status === 'detected');
    return {
      status, sources: results, newCompanies, items,
      reason: !attempted.length ? 'No hay fuentes externas configuradas. Se muestran solo los datos almacenados.' : status === 'failed' ? 'Las fuentes externas no están disponibles ahora. Se muestran los datos almacenados.' : undefined,
    };
  } catch (e) {
    log.error('Error inesperado en la búsqueda externa', { error: e });
    return empty('failed', 'Error al consultar fuentes externas. Se muestran los datos almacenados.');
  }
}
