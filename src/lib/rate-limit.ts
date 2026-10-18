// Límite de peticiones con ventana fija almacenado en PostgreSQL (válido en serverless, sin Redis).
import type { Queryable } from './db';
import { one } from './db';

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) { super('Demasiadas solicitudes. Inténtalo más tarde.'); }
}

/** Incrementa el contador de `key` en la ventana actual. Devuelve el uso; lanza RateLimitError si se supera. */
export async function hit(q: Queryable, key: string, limit: number, windowSeconds: number, { throwOnLimit = true } = {}) {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const r = await one<{ count: number }>(q, `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`, [key, windowStart.toISOString()]);
  const count = Number(r!.count);
  if (count > limit && throwOnLimit) {
    throw new RateLimitError(Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now) / 1000));
  }
  return { count, limit, allowed: count <= limit };
}

export async function cleanupRateLimits(q: Queryable) {
  return (await q.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'")).rowCount;
}
