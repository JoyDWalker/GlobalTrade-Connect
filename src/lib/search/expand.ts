// Ampliación de la búsqueda por producto o sector: sector, términos relacionados, tipos de empresa y
// consultas optimizadas para buscadores ("dulces" → caramelos, gominolas, "fábrica de golosinas España"…).
// Con ANTHROPIC_API_KEY la genera Claude (JSON validado con esquema); sin clave, sin presupuesto o si la IA
// falla, se amplía con el catálogo de sectores. El resultado se guarda en caché por producto y país.
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Queryable } from '../db';
import { many, one } from '../db';
import { env } from '../env';
import { log } from '../logger';
import { normalize } from '../text';

export interface Expansion {
  origin: 'ai' | 'catalog';
  sector: string | null;
  categorySlug: string | null;
  relatedTerms: string[];
  companyTypes: string[];
  queries: string[];
}

export interface ExpandInput {
  product: string;              // términos útiles de la consulta ("dulces", "paneles solares")
  types: string[];              // tipos de empresa pedidos en la consulta (slugs de business_types)
  country: string | null;       // ISO-3166 alfa-2
  countryName: string | null;
  maxQueries: number;
  allowAi: boolean;             // false si la IA está desactivada o se agotó el presupuesto diario
}

const AiOutput = z.object({
  is_product_query: z.boolean().describe('false si la consulta no es un producto o sector (p. ej. el nombre de una empresa concreta)'),
  sector: z.string().describe('Sector principal en español, p. ej. "Alimentación / confitería"'),
  category_slug: z.string().describe('Slug de la categoría del catálogo que mejor encaja, o cadena vacía'),
  related_terms: z.array(z.string()).describe('Productos relacionados y sinónimos comerciales'),
  company_types: z.array(z.string()).describe('Slugs de tipos de empresa relevantes del catálogo'),
  queries: z.array(z.string()).describe('Consultas para un buscador web que encuentren empresas, no artículos ni tiendas online'),
});
export type AiOutput = z.infer<typeof AiOutput>;

export interface AiResult { output: AiOutput | null; stopReason: string | null; model: string; inputTokens: number; outputTokens: number }
/** Llamada a la IA; inyectable para pruebas. */
export type AiCaller = (system: string, user: string, timeoutMs: number) => Promise<AiResult>;

// USD por millón de tokens (entrada, salida). Los tokens de razonamiento se facturan como salida.
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5],
};
const costUsd = (model: string, input: number, output: number) => {
  const [i, o] = PRICES[model] ?? [5, 25];
  return (input * i + output * o) / 1e6;
};

export const aiConfigured = () => Boolean(env().ANTHROPIC_API_KEY);

const claude: AiCaller = async (system, user, timeoutMs) => {
  const client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, timeout: timeoutMs, maxRetries: 1 });
  const model = env().AI_MODEL;
  const r = await client.beta.messages.parse({
    model, max_tokens: 4000, system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'low', format: betaZodOutputFormat(AiOutput) },
    // Si el modelo declina por precaución, la API repite la petición con un modelo alternativo
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
  });
  return {
    output: r.stop_reason === 'refusal' ? null : r.parsed_output ?? null, stopReason: r.stop_reason,
    model: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens,
  };
};

const cacheKey = (i: ExpandInput) => crypto.createHash('sha256')
  .update(`${normalize(i.product)}|${i.country ?? ''}|${[...i.types].sort().join(',')}|${i.maxQueries}`).digest('hex');

/** Quita duplicados (sin tildes ni mayúsculas), vacíos y textos demasiado largos. */
function clean(list: string[], max: number, maxLen = 150) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.replace(/\s+/g, ' ').trim();
    const k = normalize(s);
    if (s.length < 2 || s.length > maxLen || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

type Catalog = { categories: { slug: string; name: string; parent_slug: string | null }[]; types: { slug: string; name: string }[] };
async function loadCatalog(q: Queryable): Promise<Catalog> {
  const [categories, types] = await Promise.all([
    many<{ slug: string; name: string; parent_slug: string | null }>(q, 'SELECT c.slug, c.name, p.slug AS parent_slug FROM categories c LEFT JOIN categories p ON p.id = c.parent_id ORDER BY c.sort_order'),
    many<{ slug: string; name: string }>(q, 'SELECT slug, name FROM business_types ORDER BY sort_order'),
  ]);
  return { categories, types };
}

function systemPrompt(cat: Catalog) {
  return `Ayudas a un buscador B2B a encontrar empresas (fabricantes, productores, mayoristas, distribuidores, importadores, exportadores, proveedores auxiliares) relacionadas con un producto o sector.

Dada una consulta, devuelve:
- sector: el sector principal, en español.
- category_slug: el slug de la categoría del catálogo que mejor encaja (lo más específica posible), o "" si ninguna encaja.
- related_terms: hasta 12 productos relacionados y sinónimos comerciales, en español (p. ej. para "dulces": caramelos, gominolas, golosinas, chocolate, galletas, confitería).
- company_types: los slugs de tipos de empresa relevantes del catálogo.
- queries: consultas para un buscador web, cortas (3-7 palabras), que devuelvan webs de empresas y no artículos, noticias, marketplaces ni tiendas online para consumidores. Combina tipo de empresa + producto + país (p. ej. "fábrica de gominolas España", "distribuidor mayorista de golosinas", "empresa importadora de caramelos"). Escríbelas en español; incluye también alguna en inglés y, si el país tiene otro idioma oficial, en ese idioma.
- is_product_query: false si la consulta es el nombre de una empresa concreta o no describe un producto o sector.

Si la consulta indica tipos de empresa, céntrate en ellos. Usa solo slugs que aparezcan en el catálogo.

Catálogo de categorías (slug: nombre):
${cat.categories.map((c) => `${c.slug}: ${c.name}`).join('\n')}

Tipos de empresa (slug: nombre):
${cat.types.map((t) => `${t.slug}: ${t.name}`).join('\n')}`;
}

/** Expansión sin IA: categoría del catálogo que coincide con la consulta, sus subcategorías y plantillas de consulta. */
export function catalogExpansion(i: ExpandInput, cat: Catalog): Expansion {
  const stem = (w: string) => w.replace(/(es|s)$/, '');
  const product = stem(normalize(i.product));
  const words = normalize(i.product).split(' ').filter((w) => w.length > 2).map(stem);
  // Puntuación: nombre igual al producto > alguna palabra igual > contiene la palabra; a igualdad, el nombre más corto
  const score = (name: string) => {
    const n = normalize(name);
    if (stem(n) === product) return 3;
    const parts = n.split(/[\s-]+/).map(stem);
    if (words.some((w) => parts.includes(w))) return 2;
    return words.some((w) => n.includes(w)) ? 1 : 0;
  };
  const hit = cat.categories.map((c) => ({ c, s: Math.max(score(c.name), score(c.slug.replace(/-/g, ' '))) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.c.name.length - b.c.name.length)[0]?.c;
  const children = hit ? cat.categories.filter((c) => c.parent_slug === hit.slug).map((c) => c.name) : [];
  const parent = hit?.parent_slug ? cat.categories.find((c) => c.slug === hit.parent_slug) : null;
  const terms = clean([i.product, ...(hit && normalize(hit.name) !== normalize(i.product) ? [hit.name] : []), ...children], 12);
  const typeNames = i.types.length ? cat.types.filter((t) => i.types.includes(t.slug)).map((t) => t.name.toLowerCase()) : ['fabricante', 'distribuidor mayorista', 'importador', 'exportador', 'proveedor'];
  const where = i.countryName ? ` ${i.countryName}` : '';
  const queries: string[] = [];
  for (const t of terms.slice(0, 2)) for (const ty of typeNames) queries.push(`${ty} de ${t.toLowerCase()}${where}`);
  return {
    origin: 'catalog', sector: hit ? (parent ? `${parent.name} / ${hit.name}` : hit.name) : null, categorySlug: hit?.slug ?? null,
    relatedTerms: terms.slice(1), companyTypes: i.types, queries: clean(queries, i.maxQueries),
  };
}

async function logAi(q: Queryable, r: { model: string; status: 'ok' | 'error' | 'refusal' | 'invalid'; inputTokens?: number; outputTokens?: number; durationMs: number; error?: string }) {
  await q.query(`INSERT INTO ai_requests (purpose, model, status, input_tokens, output_tokens, cost_usd, duration_ms, error) VALUES ('expand', $1, $2, $3, $4, $5, $6, $7)`,
    [r.model, r.status, r.inputTokens ?? 0, r.outputTokens ?? 0, costUsd(r.model, r.inputTokens ?? 0, r.outputTokens ?? 0), r.durationMs, r.error?.slice(0, 500) ?? null]);
}

/**
 * Amplía la consulta. Nunca lanza: ante cualquier fallo devuelve la expansión por catálogo.
 * Devuelve null si la consulta no es un producto o sector (p. ej. el nombre de una empresa).
 */
export async function expandQuery(q: Queryable, i: ExpandInput, { ai = claude, timeoutMs = 20_000 }: { ai?: AiCaller; timeoutMs?: number } = {}): Promise<Expansion | null> {
  const key = cacheKey(i);
  try {
    const useAi = i.allowAi && (ai !== claude || aiConfigured());
    // La expansión hecha con IA se reutiliza siempre; la de catálogo solo si ahora tampoco se puede usar la IA
    const cached = await one<{ result: any; origin: string }>(q, 'SELECT result, origin FROM query_expansions WHERE cache_key = $1 AND expires_at > now()', [key]);
    if (cached && (cached.origin === 'ai' || !useAi)) return (typeof cached.result === 'string' ? JSON.parse(cached.result) : cached.result) as Expansion | null;

    const cat = await loadCatalog(q);
    let exp: Expansion | null = null;
    let model: string | null = null;
    if (useAi) {
      const started = Date.now();
      const user = `Consulta: ${i.product}${i.types.length ? `\nTipos de empresa pedidos: ${i.types.join(', ')}` : ''}\nPaís: ${i.countryName ?? 'cualquiera (prioriza España y habla hispana)'}\nNúmero máximo de consultas: ${i.maxQueries}`;
      try {
        const r = await ai(systemPrompt(cat), user, timeoutMs);
        model = r.model;
        if (!r.output) {
          await logAi(q, { model: r.model, status: r.stopReason === 'refusal' ? 'refusal' : 'invalid', inputTokens: r.inputTokens, outputTokens: r.outputTokens, durationMs: Date.now() - started });
        } else {
          await logAi(q, { model: r.model, status: 'ok', inputTokens: r.inputTokens, outputTokens: r.outputTokens, durationMs: Date.now() - started });
          const o = r.output;
          const slugs = new Set(cat.categories.map((c) => c.slug));
          const typeSlugs = new Set(cat.types.map((t) => t.slug));
          exp = !o.is_product_query ? null : {
            origin: 'ai', sector: o.sector.trim() || null, categorySlug: slugs.has(o.category_slug) ? o.category_slug : null,
            relatedTerms: clean(o.related_terms.filter((t) => normalize(t) !== normalize(i.product)), 15, 60),
            companyTypes: [...new Set(o.company_types.filter((t) => typeSlugs.has(t)))],
            queries: clean(o.queries, i.maxQueries),
          };
          // Sin consultas útiles: se completa con el catálogo
          if (exp && !exp.queries.length) exp = { ...catalogExpansion(i, cat), sector: exp.sector, relatedTerms: exp.relatedTerms };
          if (!o.is_product_query) {
            await q.query(`INSERT INTO query_expansions (cache_key, product, country_code, origin, model, result, expires_at) VALUES ($1,$2,$3,'ai',$4,'null', now() + interval '30 days')
              ON CONFLICT (cache_key) DO UPDATE SET origin = 'ai', model = EXCLUDED.model, result = EXCLUDED.result, created_at = now(), expires_at = EXCLUDED.expires_at`, [key, i.product, i.country, model]);
            return null;
          }
        }
      } catch (e) {
        log.warn('Expansión con IA no disponible; se usa el catálogo', { error: (e as Error).message });
        await logAi(q, { model: env().AI_MODEL, status: 'error', durationMs: Date.now() - started, error: (e as Error).message });
      }
    }
    if (!exp) exp = catalogExpansion(i, cat);
    await q.query(`INSERT INTO query_expansions (cache_key, product, country_code, origin, model, result, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(days => $7))
      ON CONFLICT (cache_key) DO UPDATE SET origin = EXCLUDED.origin, model = EXCLUDED.model, result = EXCLUDED.result, created_at = now(), expires_at = EXCLUDED.expires_at`,
    [key, i.product, i.country, exp.origin, exp.origin === 'ai' ? model : null, JSON.stringify(exp), exp.origin === 'ai' ? 30 : 1]);
    return exp;
  } catch (e) {
    log.warn('No se pudo ampliar la consulta', { error: e });
    return null;
  }
}
