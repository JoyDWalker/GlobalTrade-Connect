// Protección básica anti-spam: honeypot + token con marca de tiempo firmada + límite por IP.
import { config } from './config.js';
import { HttpError, hmac } from './util.js';

const MIN_SECONDS = 3;          // un humano tarda al menos esto en rellenar un formulario
const MAX_AGE = 4 * 3600;       // el token caduca a las 4 horas

export function formToken() {
  const ts = Math.floor(Date.now() / 1000).toString();
  return `${ts}.${hmac(ts, config.sessionSecret)}`;
}

export function checkSpam(body) {
  if (body?.hp_field) throw new HttpError(400, 'Solicitud rechazada');      // campo trampa oculto
  const [ts, sig] = String(body?.form_token || '').split('.');
  if (!ts || !sig || hmac(ts, config.sessionSecret) !== sig) throw new HttpError(400, 'Formulario caducado. Recarga la página.');
  const age = Date.now() / 1000 - Number(ts);
  if (age < MIN_SECONDS) throw new HttpError(429, 'Has enviado el formulario demasiado rápido. Inténtalo de nuevo.');
  if (age > MAX_AGE) throw new HttpError(400, 'Formulario caducado. Recarga la página.');
  const text = `${body.message || ''} ${body.notes || ''}`;
  if ((text.match(/https?:\/\//g) || []).length > 3) throw new HttpError(400, 'El mensaje contiene demasiados enlaces');
}

const buckets = new Map();
export function rateLimit(ip, key, max = 8, windowMs = 10 * 60 * 1000) {
  const k = `${key}:${ip}`;
  const now = Date.now();
  const arr = (buckets.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Demasiadas solicitudes. Inténtalo más tarde.');
  arr.push(now);
  buckets.set(k, arr);
}
setInterval(() => { const now = Date.now(); for (const [k, a] of buckets) if (!a.some((t) => now - t < 3600e3)) buckets.delete(k); }, 600e3).unref();
