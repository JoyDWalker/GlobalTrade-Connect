// HTTP saliente: tiempo máximo, reintentos con espera progresiva y protección SSRF.
import dns from 'node:dns/promises';
import net from 'node:net';

export type SourceErrorKind = 'timeout' | 'http' | 'rate_limited' | 'quota_exceeded' | 'blocked' | 'network' | 'invalid';
export class SourceError extends Error {
  constructor(public kind: SourceErrorKind, message: string, public httpStatus?: number) { super(message); }
}

export const BOT_UA = 'GlobalTradeConnectBot/2.0 (+https://github.com/; directorio B2B; respeta robots.txt)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOptions extends RequestInit { timeoutMs?: number; retries?: number; backoffMs?: number }

/** fetch con timeout y reintentos (errores de red, 429 y 5xx). Devuelve también el nº de intentos. */
export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<{ res: Response; attempts: number }> {
  const { timeoutMs = 8000, retries = 2, backoffMs = 400, ...init } = opts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt <= retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : backoffMs * 2 ** (attempt - 1) + Math.random() * 100);
        continue;
      }
      return { res, attempts: attempt };
    } catch (e) {
      lastError = e;
      const timeout = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError';
      if (attempt > retries) throw new SourceError(timeout ? 'timeout' : 'network', timeout ? `Tiempo de espera agotado (${timeoutMs} ms)` : `Error de red: ${(e as Error).message}`);
      await sleep(backoffMs * 2 ** (attempt - 1) + Math.random() * 100);
    }
  }
  throw new SourceError('network', String(lastError));
}

// ───────── SSRF: solo se descargan webs públicas ─────────
function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

export async function assertPublicUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SourceError('invalid', 'URL no válida'); }
  if (!/^https?:$/.test(url.protocol)) throw new SourceError('invalid', 'Solo se permiten URLs http(s)');
  if (url.port && !['80', '443'].includes(url.port)) throw new SourceError('blocked', 'Puerto no permitido');
  if (url.username || url.password) throw new SourceError('blocked', 'URL con credenciales');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw new SourceError('network', 'El dominio no resuelve'); })).map((a) => a.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new SourceError('blocked', 'Dirección no pública');
  return url;
}

/** Descarga una página pública siguiendo como máximo 3 redirecciones, cada una validada. */
export async function fetchPublicPage(raw: string, { timeoutMs = 8000, maxBytes = 1_500_000 } = {}) {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current);
    const { res } = await fetchWithRetry(url.toString(), {
      timeoutMs, retries: 1, redirect: 'manual',
      headers: { 'User-Agent': BOT_UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'es,en;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); break; }
      chunks.push(value);
    }
    return { url: url.toString(), status: res.status, redirected: hop > 0, contentType: res.headers.get('content-type') ?? '', body: Buffer.concat(chunks).toString('utf8') };
  }
  throw new SourceError('blocked', 'Demasiadas redirecciones');
}
