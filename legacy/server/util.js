import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

export const normalize = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const slugify = (s) =>
  normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'empresa';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const hmac = (s, secret) => crypto.createHmac('sha256', secret).update(s).digest('base64url');

export const nowIso = () => new Date().toISOString();

const EMAIL_RE = /^[^\s@<>()[\]\,;:"]+@[^\s@<>()[\]\,;:"]+\.[a-z]{2,}$/i;

/** Validador sencillo: acumula errores por campo y lanza 422 al final. */
export class Validator {
  constructor(body) { this.body = body || {}; this.errors = {}; }
  fail(field, msg) { if (!this.errors[field]) this.errors[field] = msg; return null; }
  str(field, { required = false, max = 500, min = 0, label } = {}) {
    let v = this.body[field];
    if (v === undefined || v === null) v = '';
    if (typeof v !== 'string' && typeof v !== 'number') return this.fail(field, 'Valor no válido');
    v = String(v).replace(/\u0000/g, '').trim();
    if (!v) return required ? this.fail(field, `${label || 'Este campo'} es obligatorio`) : null;
    if (v.length < min) return this.fail(field, `Mínimo ${min} caracteres`);
    if (v.length > max) return this.fail(field, `Máximo ${max} caracteres`);
    return v;
  }
  email(field, opts = {}) {
    const v = this.str(field, { max: 254, ...opts });
    if (v && !EMAIL_RE.test(v)) return this.fail(field, 'Email no válido');
    return v ? v.toLowerCase() : v;
  }
  phone(field, opts = {}) {
    const v = this.str(field, { max: 40, ...opts });
    if (v && !/^[+()\d\s.-]{6,40}$/.test(v)) return this.fail(field, 'Teléfono no válido');
    return v;
  }
  url(field, opts = {}) {
    let v = this.str(field, { max: 300, ...opts });
    if (!v) return v;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try { const u = new URL(v); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw 0; return u.toString(); }
    catch { return this.fail(field, 'URL no válida'); }
  }
  int(field, { required = false, min = -Infinity, max = Infinity } = {}) {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') return required ? this.fail(field, 'Obligatorio') : null;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return this.fail(field, 'Debe ser un número entero');
    if (n < min || n > max) return this.fail(field, `Debe estar entre ${min} y ${max}`);
    return n;
  }
  num(field, { min = 0, max = 1e12 } = {}) {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) return this.fail(field, 'Número no válido');
    return n;
  }
  oneOf(field, values, { required = false, def = null } = {}) {
    const v = this.body[field];
    if (v === undefined || v === null || v === '') return required ? this.fail(field, 'Obligatorio') : def;
    if (!values.includes(v)) return this.fail(field, 'Valor no permitido');
    return v;
  }
  ids(field, { required = false, max = 100 } = {}) {
    let v = this.body[field];
    if (v === undefined || v === null || v === '') v = [];
    if (!Array.isArray(v)) return this.fail(field, 'Debe ser una lista') || [];
    const out = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, max);
    if (required && !out.length) { this.fail(field, 'Selecciona al menos una opción'); }
    return out;
  }
  bool(field) { const v = this.body[field]; return v === true || v === 1 || v === '1' || v === 'true' || v === 'on'; }
  mustAccept(field, msg = 'Debes aceptar la política de privacidad') {
    if (!this.bool(field)) this.fail(field, msg);
    return true;
  }
  done() { if (Object.keys(this.errors).length) throw new HttpError(422, 'Revisa los campos marcados', this.errors); }
}
