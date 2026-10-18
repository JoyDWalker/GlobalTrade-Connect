import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carga .env (o .env.example como valores de desarrollo). No sobrescribe variables ya definidas.
let envFile = null;
for (const f of ['.env', '.env.example']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) { process.loadEnvFile(p); envFile = f; break; }
}

const env = process.env;

export const config = {
  envFile,
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dbPath: path.resolve(ROOT, env.DB_PATH || 'data/globaltrade.db'),
  uploadsDir: path.join(ROOT, 'uploads'),
  publicDir: path.join(ROOT, 'public'),
  migrationsDir: path.join(ROOT, 'db', 'migrations'),
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret',
  sessionDays: 7,
  adminNotifyEmail: env.ADMIN_NOTIFY_EMAIL || env.ADMIN_EMAIL || 'admin@globaltrade.test',
  seed: {
    adminName: env.ADMIN_NAME || 'Administrador Demo',
    adminEmail: env.ADMIN_EMAIL || 'admin@globaltrade.test',
    adminPassword: env.ADMIN_PASSWORD,
    companyEmail: env.COMPANY_DEMO_EMAIL || 'empresa@globaltrade.test',
    companyPassword: env.COMPANY_DEMO_PASSWORD,
  },
};

export const isHttps = config.baseUrl.startsWith('https://');
