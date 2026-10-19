// Worker: tareas programadas y procesamiento de la cola dentro de un presupuesto de tiempo
// (compatible con funciones serverless de duración limitada y con un proceso independiente).
import os from 'node:os';
import type { Db } from '../db';
import { many, one } from '../db';
import { alert, log } from '../logger';
import { getSetting } from '../settings';
import { canonicalName, normalize, normalizeDomain } from '../text';
import { flushOutbox } from '../email';
import { cleanupRateLimits } from '../rate-limit';
import { checkLink, fetchSiteInfo, gleifLookup } from '../sources/adapters';
import { SourceError } from '../sources/http';
import { refreshSearchText, searchCompanies } from '../services/companies';
import { searchParamsSchema } from '../validation';
import { runExternalSearch } from '../search/external';
import { claimNext, completeJob, enqueue, enqueueOncePerPeriod, failJob, recoverStuck, type Job } from './queue';

type Ctx = { db: Db; job: Job; deadline: number };
type Handler = (ctx: Ctx) => Promise<unknown>;

const sourceId = async (db: Db, key: string) => Number((await one<{ id: number }>(db, 'SELECT id FROM sources WHERE key = $1', [key]))?.id ?? 0) || null;

async function openTask(db: Db, companyId: string | null, kind: string, details: Record<string, unknown>, dedupeKey: string, priority = 50) {
  await db.query(`INSERT INTO review_tasks (company_id, kind, priority, details, dedupe_key) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (dedupe_key) WHERE status = 'open' AND dedupe_key IS NOT NULL DO NOTHING`, [companyId, kind, priority, JSON.stringify(details), dedupeKey]);
}

export const HANDLERS: Record<string, Handler> = {
  /** Completa una ficha con los metadatos públicos de su web oficial (sin sobrescribir datos declarados). */
  async enrich_company({ db, job }) {
    const c = await one<any>(db, 'SELECT id, name, website, description, email, phone, legal_name, address, city, region, postal_code, logo_url, origin, record_status FROM companies WHERE id = $1 AND deleted_at IS NULL', [job.payload.companyId]);
    if (!c?.website) return { skipped: 'sin web' };
    const src = await sourceId(db, 'website');
    const started = Date.now();
    try {
      const info = await fetchSiteInfo(c.website);
      await db.query(`INSERT INTO external_requests (source_id, purpose, query, status, http_status, duration_ms, results, job_id) VALUES ($1,'enrich',$2,'ok',$3,$4,1,$5)`,
        [src, c.website, info.status, Date.now() - started, job.id]);
      const updates: Record<string, string> = {};
      const fill = (field: string, value: string | null | undefined) => { if (value && !c[field]) updates[field] = value.slice(0, field === 'description' ? 1000 : 200); };
      // Para empresas detectadas, el nombre de la web es más fiable que el título del buscador
      if (c.origin === 'external' && info.name && info.name.length >= 2) updates.name = info.name.slice(0, 150);
      fill('legal_name', info.legalName); fill('description', info.description); fill('email', info.emails[0]); fill('phone', info.phones[0]);
      fill('address', info.address?.street); fill('city', info.address?.city); fill('region', info.address?.region); fill('postal_code', info.address?.postalCode);
      if (info.logo && !c.logo_url && /^https:\/\//.test(info.logo)) updates.logo_url = info.logo;
      await db.tx(async (q) => {
        const keys = Object.keys(updates);
        await q.query(`UPDATE companies SET website_status = $2, website_checked_at = now(), last_checked_at = now()${keys.map((k, i) => `, ${k} = $${i + 3}`).join('')} WHERE id = $1`,
          [c.id, info.redirected && normalizeDomain(info.finalUrl) !== normalizeDomain(c.website) ? 'redirect' : 'ok', ...keys.map((k) => updates[k])]);
        for (const k of keys) {
          await q.query(`INSERT INTO data_provenance (company_id, field, value, source_id, source_url, status) VALUES ($1,$2,$3,$4,$5,$6)`,
            [c.id, k, updates[k], src, info.finalUrl, c.origin === 'external' ? 'detected' : 'pending_review']);
        }
        if (keys.length) await q.query("INSERT INTO company_changes (company_id, change_source, changes) VALUES ($1, 'worker', $2)",
          [c.id, JSON.stringify(Object.fromEntries(keys.map((k) => [k, { from: c[k] ?? null, to: updates[k] }])))]);
        await q.query("INSERT INTO verification_events (company_id, kind, result, details, source_id) VALUES ($1, 'link_check', 'ok', $2, $3)",
          [c.id, JSON.stringify({ url: info.finalUrl, status: info.status }), src]);
        await refreshSearchText(q, c.id);
      });
      return { updated: Object.keys(updates) };
    } catch (e) {
      const se = e as SourceError;
      await db.query(`INSERT INTO external_requests (source_id, purpose, query, status, http_status, duration_ms, error, job_id) VALUES ($1,'enrich',$2,$3,$4,$5,$6,$7)`,
        [src, c.website, se.kind === 'timeout' ? 'timeout' : se.kind === 'blocked' ? 'blocked' : 'error', se.httpStatus ?? null, Date.now() - started, se.message, job.id]);
      await db.query('UPDATE companies SET website_status = $2, website_checked_at = now() WHERE id = $1', [c.id, se.kind === 'blocked' ? 'blocked' : 'broken']);
      if (se.kind === 'blocked') return { skipped: se.message };     // robots.txt o dirección no pública: no se reintenta
      throw e;
    }
  },

  /** Verificación en registro abierto (GLEIF). Añade evidencias; "verificada" la decide un administrador. */
  async verify_registry({ db, job }) {
    const c = await one<any>(db, 'SELECT id, name, legal_name, country_code, verification_level, lei FROM companies WHERE id = $1 AND deleted_at IS NULL', [job.payload.companyId]);
    if (!c) return { skipped: 'no existe' };
    const src = await sourceId(db, 'gleif');
    const started = Date.now();
    const { records, httpStatus, attempts } = await gleifLookup(c.legal_name || c.name, c.country_code);
    await db.query(`INSERT INTO external_requests (source_id, purpose, query, status, http_status, attempts, duration_ms, results, job_id) VALUES ($1,'verify',$2,'ok',$3,$4,$5,$6,$7)`,
      [src, c.legal_name || c.name, httpStatus, attempts, Date.now() - started, records.length, job.id]);
    const target = canonicalName(c.legal_name || c.name);
    const match = records.find((r) => canonicalName(r.legalName) === target && (!c.country_code || r.country === c.country_code));
    const partial = !match && records.find((r) => canonicalName(r.legalName).includes(target) || target.includes(canonicalName(r.legalName)));
    const result = match ? 'match' : partial ? 'partial' : 'no_match';
    await db.query('INSERT INTO verification_events (company_id, kind, result, details, source_id) VALUES ($1, $2, $3, $4, $5)',
      [c.id, 'registry_lookup', result, JSON.stringify({ registry: 'GLEIF', candidates: records.slice(0, 3) }), src]);
    const best = match || partial;
    if (best) {
      for (const [field, value] of [['legal_name', best.legalName], ['lei', best.lei], ['registry_status', best.status], ['registry_address', [best.address, best.postalCode, best.city].filter(Boolean).join(', ')]]) {
        await db.query("INSERT INTO data_provenance (company_id, field, value, source_id, source_url, status) VALUES ($1,$2,$3,$4,$5,'pending_review')", [c.id, field, value, src, best.url]);
      }
      await openTask(db, c.id, 'registry_evidence', { result, lei: best.lei, legalName: best.legalName, status: best.status, url: best.url }, `registry:${c.id}:${best.lei}`, match ? 60 : 40);
    }
    // Coincidencia exacta de nombre legal y país en un registro oficial independiente → información contrastada
    if (match && match.status === 'ACTIVE' && c.verification_level === 'none') {
      await db.query("UPDATE companies SET verification_level = 'contrasted', verification_method = $2, lei = coalesce(lei, $3) WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM companies WHERE lei = $3 AND id <> $1 AND deleted_at IS NULL)",
        [c.id, `Nombre legal y país coinciden con GLEIF (LEI ${match.lei})`, match.lei]);
    }
    return { result, candidates: records.length };
  },

  /** Comprueba enlaces de webs no revisadas recientemente. */
  async check_links({ db, deadline }) {
    const cfg = await getSetting(db, 'worker');
    const rows = await many<{ id: string; website: string; website_status: string }>(db, `SELECT id, website, website_status FROM companies
      WHERE deleted_at IS NULL AND website IS NOT NULL AND is_demo = false AND (website_checked_at IS NULL OR website_checked_at < now() - make_interval(days => $1))
      ORDER BY website_checked_at NULLS FIRST LIMIT $2`, [cfg.link_check_after_days, cfg.batch_size * 3]);
    let broken = 0;
    for (const r of rows) {
      if (Date.now() > deadline - 9000) break;
      const res = await checkLink(r.website);
      await db.query('UPDATE companies SET website_status = $2, website_checked_at = now() WHERE id = $1', [r.id, res.status]);
      if (res.status === 'broken') {
        broken++;
        await openTask(db, r.id, 'broken_link', { url: r.website, httpStatus: res.httpStatus, error: (res as any).error }, `broken:${r.id}`, 40);
      }
    }
    return { checked: rows.length, broken };
  },

  /** Programa la actualización de fichas antiguas. */
  async flag_stale({ db }) {
    const cfg = await getSetting(db, 'worker');
    const rows = await many<{ id: string }>(db, `SELECT id FROM companies WHERE deleted_at IS NULL AND website IS NOT NULL AND is_demo = false
      AND record_status IN ('published', 'detected') AND (last_checked_at IS NULL OR last_checked_at < now() - make_interval(days => $1))
      ORDER BY last_checked_at NULLS FIRST LIMIT $2`, [cfg.stale_after_days, cfg.batch_size * 5]);
    let n = 0;
    for (const r of rows) if (await enqueue(db, 'enrich_company', { companyId: r.id }, { dedupeKey: `enrich:${r.id}`, priority: 20 })) n++;
    return { enqueued: n };
  },

  /** Detecta posibles duplicados (mismo nombre canónico y país) y los envía a revisión. */
  async detect_duplicates({ db }) {
    const rows = await many<{ id: string; name: string; country_code: string | null }>(db, 'SELECT id, name, country_code FROM companies WHERE deleted_at IS NULL');
    const groups = new Map<string, string[]>();
    for (const r of rows) {
      const k = `${r.country_code ?? '??'}:${canonicalName(r.name)}`;
      if (canonicalName(r.name).length < 4) continue;
      groups.set(k, [...(groups.get(k) ?? []), r.id]);
    }
    let found = 0;
    for (const [key, ids] of groups) {
      if (ids.length < 2) continue;
      found++;
      const sorted = [...ids].sort();
      await openTask(db, sorted[0], 'duplicate_candidate', { key, company_ids: sorted }, `dup:${sorted.join(',')}`, 50);
    }
    return { groups: found };
  },

  /** Prepara candidatos para las solicitudes de proveedores pendientes. */
  async process_supplier_requests({ db }) {
    const rows = await many<{ id: number; product: string; origin_countries: string[]; certifications: string[] }>(db,
      "SELECT id, product, origin_countries, certifications FROM supplier_requests WHERE status = 'new' AND cardinality(suggested_company_ids) = 0 LIMIT 20");
    for (const r of rows) {
      const res = await searchCompanies(db, searchParamsSchema.parse({ q: r.product, country: r.origin_countries, cert: r.certifications, pageSize: 10 }));
      const fallback = res.total ? res : await searchCompanies(db, searchParamsSchema.parse({ q: r.product, pageSize: 10 }));
      await db.query('UPDATE supplier_requests SET suggested_company_ids = $2 WHERE id = $1', [r.id, fallback.items.map((c) => c.id)]);
    }
    return { processed: rows.length };
  },

  /** Descubrimiento de empresas con las consultas configuradas por el administrador. */
  async discovery({ db, job }) {
    const queries: string[] = job.payload.query ? [job.payload.query] : await getSetting(db, 'discovery_queries');
    const out: Record<string, unknown> = {};
    for (const query of queries.slice(0, 5)) {
      const r = await runExternalSearch(db, { query, country: job.payload.country ?? null, actorKey: 'worker', isUser: true, jobId: job.id, force: Boolean(job.payload.force) });
      out[query] = { status: r.status, new: r.newCompanies, sources: r.sources.map((s) => `${s.key}:${s.status}`) };
    }
    return out;
  },

  async send_emails({ db }) { return flushOutbox(db); },

  /** Limpieza y retención de datos. */
  async cleanup({ db }) {
    const cache = (await db.query('DELETE FROM search_cache WHERE expires_at < now()')).rowCount
      + (await db.query('DELETE FROM query_expansions WHERE expires_at < now()')).rowCount;
    const searches = (await db.query("UPDATE searches SET ip_hash = NULL WHERE created_at < now() - interval '30 days' AND ip_hash IS NOT NULL")).rowCount;
    const oldSearches = (await db.query("DELETE FROM searches WHERE created_at < now() - interval '180 days'")).rowCount;
    const jobs = (await db.query("DELETE FROM jobs WHERE status IN ('succeeded', 'cancelled') AND finished_at < now() - interval '30 days'")).rowCount;
    const inquiriesIp = (await db.query("UPDATE inquiries SET ip_hash = NULL WHERE created_at < now() - interval '30 days' AND ip_hash IS NOT NULL")).rowCount;
    return { cache, searches, oldSearches, jobs, inquiriesIp, rateLimits: await cleanupRateLimits(db) };
  },
};

/** Encola las tareas periódicas (idempotente por periodo). */
export async function scheduleRecurring(db: Db, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  const created = [
    await enqueueOncePerPeriod(db, 'send_emails', now.toISOString().slice(0, 15)),     // cada 10 min
    await enqueueOncePerPeriod(db, 'process_supplier_requests', hour),
    await enqueueOncePerPeriod(db, 'check_links', hour),
    await enqueueOncePerPeriod(db, 'flag_stale', day),
    await enqueueOncePerPeriod(db, 'detect_duplicates', day),
    await enqueueOncePerPeriod(db, 'cleanup', day),
  ];
  if ((await getSetting(db, 'discovery_queries')).length) created.push(await enqueueOncePerPeriod(db, 'discovery', day));
  return created.filter(Boolean).length;
}

export interface RunResult { scheduled: number; recovered: number; processed: { id: number; type: string; ok: boolean; ms: number; error?: string }[] }

/** Ejecuta tareas hasta agotar el presupuesto de tiempo, con varias en paralelo. Seguro con varias instancias a la vez. */
export async function runWorker(db: Db, { timeBudgetMs, schedule = true, workerId = `${os.hostname()}:${process.pid}`, maxJobs = 100, concurrency, types }: { timeBudgetMs?: number; schedule?: boolean; workerId?: string; maxJobs?: number; concurrency?: number; types?: string[] } = {}): Promise<RunResult> {
  const cfg = await getSetting(db, 'worker');
  const budget = timeBudgetMs ?? cfg.time_budget_ms;
  const deadline = Date.now() + budget;
  const recovered = await recoverStuck(db, cfg.stuck_after_minutes);
  if (recovered) log.warn('Tareas interrumpidas recuperadas', { recovered });
  const scheduled = schedule ? await scheduleRecurring(db) : 0;
  const processed: RunResult['processed'] = [];
  let claimed = 0;
  const lane = async () => {
    while (Date.now() < deadline - 5000 && claimed < maxJobs) {
      claimed++;
      const job = await claimNext(db, workerId, types);
      if (!job) { claimed--; return; }
      const started = Date.now();
      const handler = HANDLERS[job.type];
      try {
        if (!handler) throw new Error(`Tipo de tarea desconocido: ${job.type}`);
        const result = await Promise.race([
          handler({ db, job, deadline }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Tiempo máximo de la tarea agotado')), Math.max(1000, deadline - Date.now()))),
        ]);
        await completeJob(db, job.id, result);
        processed.push({ id: job.id, type: job.type, ok: true, ms: Date.now() - started });
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        const final = await failJob(db, job, msg);
        processed.push({ id: job.id, type: job.type, ok: false, ms: Date.now() - started, error: msg });
        log.warn('Tarea fallida', { job: job.id, type: job.type, attempts: job.attempts, final, error: msg });
        if (final) await alert(`Tarea ${job.type} #${job.id} fallida definitivamente`, { error: msg });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency ?? cfg.concurrency ?? 1) }, lane));
  return { scheduled, recovered, processed };
}

export const JOB_TYPES = Object.keys(HANDLERS);
export const normalizeQueryForJob = (s: string) => normalize(s).slice(0, 200);
