// Envoltorio común para las rutas /api: errores homogéneos, CSRF por Origin, IP anonimizada y request id.
import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { env } from './env';
import { log } from './logger';
import { hashIp } from './text';
import { fieldErrors } from './validation';
import { AuthError } from './auth/session';
import { RateLimitError } from './rate-limit';
import { DuplicateCompanyError } from './services/companies';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string>) { super(message); }
}

export interface ApiCtx<P = Record<string, string>> { req: NextRequest; params: P; ip: string; ipHash: string; requestId: string }

export function clientIp(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '0.0.0.0';
}

function checkOrigin(req: NextRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host) throw new HttpError(403, 'Origen de la petición no permitido');
  try { if (new URL(origin).host !== host) throw 0; } catch { throw new HttpError(403, 'Origen de la petición no permitido'); }
}

export function api<P = Record<string, string>>(handler: (ctx: ApiCtx<P>) => Promise<Response | unknown>, opts: { skipOriginCheck?: boolean } = {}) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    const requestId = crypto.randomUUID();
    try {
      if (!opts.skipOriginCheck) checkOrigin(req);
      const ip = clientIp(req);
      const result = await handler({ req, params: (await context?.params) ?? ({} as P), ip, ipHash: hashIp(ip, env().APP_SECRET), requestId });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      return errorResponse(e, requestId, req);
    }
  };
}

export function errorResponse(e: unknown, requestId: string, req?: Request) {
  const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    NextResponse.json({ ...body, requestId }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
  if (e instanceof ZodError) return json(422, { error: 'Revisa los campos marcados', details: fieldErrors(e) });
  if (e instanceof HttpError) return json(e.status, { error: e.message, details: e.details });
  if (e instanceof AuthError) return json(e.status, { error: e.message });
  if (e instanceof RateLimitError) return json(429, { error: e.message }, { 'Retry-After': String(e.retryAfterSeconds) });
  if (e instanceof DuplicateCompanyError) return json(409, { error: e.message, existing: { slug: e.existing.slug, name: e.existing.name } });
  log.error('Error no controlado en la API', { requestId, path: req ? new URL(req.url).pathname : undefined, error: e });
  return json(500, { error: 'Error interno. Inténtalo de nuevo más tarde.' });
}

export async function readJson(req: Request, limit = 1_500_000) {
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, 'Petición demasiado grande');
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'JSON no válido'); }
}

export function fileResponse(content: string | Buffer, filename: string, type: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return new Response(typeof content === 'string' ? content : new Uint8Array(content), {
    headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'no-store' },
  });
}

// ───────── Anti-spam: campo trampa + token con marca de tiempo firmada ─────────
const sign = (ts: string) => crypto.createHmac('sha256', env().APP_SECRET).update(`form:${ts}`).digest('base64url');
export const formToken = () => { const ts = String(Math.floor(Date.now() / 1000)); return `${ts}.${sign(ts)}`; };
export function checkSpam(body: any) {
  if (body?.hp_field) throw new HttpError(400, 'Solicitud rechazada');
  const [ts, sig] = String(body?.form_token ?? '').split('.');
  if (!ts || !sig || sign(ts) !== sig) throw new HttpError(400, 'El formulario ha caducado. Recarga la página.');
  const age = Date.now() / 1000 - Number(ts);
  if (age < 3) throw new HttpError(429, 'Has enviado el formulario demasiado rápido. Inténtalo de nuevo.');
  if (age > 6 * 3600) throw new HttpError(400, 'El formulario ha caducado. Recarga la página.');
  const text = `${body.message ?? ''} ${body.notes ?? ''}`;
  if ((text.match(/https?:\/\//g) ?? []).length > 3) throw new HttpError(400, 'El mensaje contiene demasiados enlaces');
}
