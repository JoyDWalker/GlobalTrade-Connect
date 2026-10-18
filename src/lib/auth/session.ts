// Usuario actual y comprobación de permisos EN EL SERVIDOR (la interfaz solo oculta, no protege).
import { cache } from 'react';
import type { Queryable } from '../db';
import { getDb, many, one } from '../db';
import { authConfigured, env } from '../env';
import { log } from '../logger';

export type Role = 'user' | 'company' | 'admin';
export interface SessionUser { id: string; email: string; full_name: string | null; role: Role; is_blocked: boolean; companyIds: string[] }

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

let testUser: SessionUser | null | undefined;
/** Solo pruebas automatizadas. */
export function setTestUser(u: SessionUser | null | undefined) { testUser = u; }

async function loadProfile(q: Queryable, id: string, email: string, fullName?: string | null): Promise<SessionUser> {
  let p = await one<{ id: string; email: string; full_name: string | null; role: Role; is_blocked: boolean }>(q, 'SELECT id, email, full_name, role, is_blocked FROM profiles WHERE id = $1', [id]);
  if (!p) {
    // Respaldo si el trigger de Supabase no creó el perfil. El rol siempre es 'user'.
    p = await one(q, `INSERT INTO profiles (id, email, full_name, role) VALUES ($1, $2, $3, 'user')
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email RETURNING id, email, full_name, role, is_blocked`, [id, email, fullName ?? null]);
  }
  const companies = await many<{ company_id: string }>(q, 'SELECT company_id FROM company_members WHERE user_id = $1', [id]);
  return { ...p!, companyIds: companies.map((c) => c.company_id) };
}

/**
 * Modo de desarrollo sin Supabase: DEV_FAKE_AUTH_EMAIL actúa como ese usuario (que debe existir en profiles).
 * Bloqueado salvo en APP_ENV=development y sin Supabase configurado.
 */
async function devUser(): Promise<SessionUser | null> {
  const email = process.env.DEV_FAKE_AUTH_EMAIL;
  if (!email) return null;
  if (env().APP_ENV !== 'development' || authConfigured()) {
    log.error('DEV_FAKE_AUTH_EMAIL ignorado: solo se permite en desarrollo local sin Supabase');
    return null;
  }
  const p = await one<{ id: string }>(getDb(), 'SELECT id FROM profiles WHERE lower(email) = lower($1)', [email]);
  return p ? loadProfile(getDb(), p.id, email) : null;
}

/** Usuario de la petición actual o null. Validado contra Supabase Auth (getUser), no solo leyendo la cookie. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (testUser !== undefined) return testUser;
  if (!authConfigured()) return devUser();
  try {
    const { createSupabaseServer } = await import('./supabase');
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email) return null;
    const u = await loadProfile(getDb(), data.user.id, data.user.email, data.user.user_metadata?.full_name);
    return u.is_blocked ? null : u;
  } catch (e) {
    log.warn('No se pudo validar la sesión', { error: e });
    return null;
  }
});

export async function requireUser() {
  const u = await getSessionUser();
  if (!u) throw new AuthError(401, 'Inicia sesión para continuar');
  return u;
}

export async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== 'admin') throw new AuthError(403, 'Acceso solo para administradores');
  return u;
}

/** Propietario/editor de la empresa o administrador. */
export async function requireCompanyAccess(companyId: string) {
  const u = await requireUser();
  if (u.role !== 'admin' && !u.companyIds.includes(companyId)) throw new AuthError(403, 'No tienes acceso a esta empresa');
  return u;
}

export const canManageCompany = (u: SessionUser | null, companyId: string) => Boolean(u && (u.role === 'admin' || u.companyIds.includes(companyId)));
