import crypto from 'node:crypto';
import { config, isHttps } from './config.js';
import { HttpError, sha256 } from './util.js';

const COOKIE = 'gt_session';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

export function passwordProblems(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (pw.length > 200) return 'La contraseña es demasiado larga';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Incluye letras y números';
  return null;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const cookie = (value, maxAge) =>
  `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${isHttps ? '; Secure' : ''}`;

export function createSession(db, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5).toISOString();
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), userId, expires);
  res.setHeader('Set-Cookie', cookie(token, config.sessionDays * 86400));
}

export function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.setHeader('Set-Cookie', cookie('', 0));
}

export function userFromRequest(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db.get(
    `SELECT u.id, u.name, u.email, u.role, u.company_id, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`, sha256(token));
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) { db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token)); return null; }
  delete row.expires_at;
  return row;
}

export const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Inicia sesión para continuar'); };
export const requireAdmin = (ctx) => {
  requireUser(ctx);
  if (ctx.user.role !== 'admin') throw new HttpError(403, 'Acceso solo para administradores');
};
