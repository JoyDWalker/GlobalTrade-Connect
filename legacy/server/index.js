import http from 'node:http';
import { config } from './config.js';
import { openDb, migrate } from './db.js';
import { userFromRequest } from './auth.js';
import { FileResponse, Router, SECURITY_HEADERS, readJson, sendFile, sendJson, serveStatic } from './http.js';
import { HttpError } from './util.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';
import { seed } from '../db/seed.js';

const db = openDb();
const applied = migrate(db);
if (applied.length) console.log(`Migraciones aplicadas: ${applied.join(', ')}`);
seed(db, { log: () => {} });   // solo siembra si la base de datos está vacía

const router = new Router();
registerPublicRoutes(router, db);
registerAdminRoutes(router, db);

async function handleApi(req, res, url) {
  const match = router.match(req.method, url.pathname);
  if (!match) throw new HttpError(404, 'Ruta no encontrada');
  const ctx = {
    req, res, url, params: match.params, query: url.searchParams, body: {},
    ip: req.socket.remoteAddress || 'unknown', user: userFromRequest(db, req),
  };
  if (req.method !== 'GET') {
    // Mitigación CSRF: las mutaciones solo se aceptan desde fetch() del propio front (cabecera personalizada + JSON)
    if (req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Petición no permitida');
    if (!String(req.headers['content-type'] || '').startsWith('application/json') && req.headers['content-length'] !== '0') {
      throw new HttpError(415, 'Se esperaba JSON');
    }
    ctx.body = await readJson(req);
    if (typeof ctx.body !== 'object' || ctx.body === null || Array.isArray(ctx.body)) throw new HttpError(400, 'Cuerpo no válido');
  }
  let result;
  for (const h of match.handlers) result = await h(ctx);
  if (result instanceof FileResponse) return sendFile(res, result);
  sendJson(res, 200, result ?? { ok: true });
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido');
    if (url.pathname.startsWith('/uploads/')) {
      if (serveStatic(req, res, config.uploadsDir, url.pathname.slice('/uploads/'.length), { cache: 'public, max-age=86400' })) return;
      throw new HttpError(404, 'No encontrado');
    }
    if (url.pathname !== '/' && serveStatic(req, res, config.publicDir, decodeURIComponent(url.pathname))) return;
    if (/\.[a-z0-9]+$/i.test(url.pathname)) throw new HttpError(404, 'No encontrado');
    serveStatic(req, res, config.publicDir, 'index.html');   // SPA
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, details: e.details });
    console.error(e);
    sendJson(res, 500, { error: 'Error interno del servidor' });
  }
});

server.listen(config.port, () => {
  console.log(`\n  GlobalTrade Connect → ${config.baseUrl}`);
  console.log(`  Configuración: ${config.envFile || 'variables de entorno'} · BD: ${config.dbPath}\n`);
  if (config.envFile === '.env.example') console.log('  ⚠  Usando .env.example (valores de desarrollo). Copia a .env para personalizar.\n');
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
