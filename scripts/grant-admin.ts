// Crea el primer administrador de forma segura.
// 1) La persona se registra normalmente en la web (su contraseña la gestiona Supabase Auth) y confirma su email.
// 2) Desde un entorno de confianza con acceso a DATABASE_URL de ese entorno:
//      npm run admin:grant -- persona@empresa.com          (conceder)
//      npm run admin:grant -- persona@empresa.com --revoke (retirar)
// No hay contraseñas fijas en el código ni forma de autopromocionarse desde la aplicación.
import './load-env';
import { createPgDb, one } from '../src/lib/db';
import { audit } from '../src/lib/audit';

const email = process.argv.slice(2).find((a) => a.includes('@'));
const revoke = process.argv.includes('--revoke');
if (!email) {
  console.error('Uso: npm run admin:grant -- email@dominio.com [--revoke]');
  process.exit(1);
}
const db = createPgDb();
try {
  const p = await one<{ id: string; role: string }>(db, 'SELECT id, role FROM profiles WHERE lower(email) = lower($1)', [email]);
  if (!p) throw new Error('No existe ningún usuario con ese email. Debe registrarse y confirmar su email primero.');
  const role = revoke ? 'user' : 'admin';
  await db.query('UPDATE profiles SET role = $2 WHERE id = $1', [p.id, role]);
  await audit(db, { id: null, email: 'cli' }, revoke ? 'user.revoke_admin_cli' : 'user.grant_admin_cli', { type: 'user', id: p.id }, { from: p.role, to: role });
  console.log(`${email}: ${p.role} → ${role}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
