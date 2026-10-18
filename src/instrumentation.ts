// Arranque del servidor: valida la configuración y registra errores no controlados como logs estructurados.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { env } = await import('./lib/env');
  const { log } = await import('./lib/logger');
  try {
    const e = env();
    log.info('Servidor iniciado', { appEnv: e.APP_ENV, auth: Boolean(e.NEXT_PUBLIC_SUPABASE_URL), mailer: e.EMAIL_PROVIDER, searchApis: { brave: Boolean(e.BRAVE_SEARCH_API_KEY), google: Boolean(e.GOOGLE_CSE_API_KEY && e.GOOGLE_CSE_ENGINE_ID) } });
  } catch (err) {
    log.error('Configuración inválida al arrancar', { error: err });
    if (process.env.APP_ENV === 'production' || process.env.VERCEL_ENV === 'production') throw err;
  }
}

export async function onRequestError(error: unknown, request: { path: string; method: string }, context: { routerKind: string; routePath: string; routeType: string }) {
  const { log } = await import('./lib/logger');
  log.error('Error en una petición', { error, path: request.path, method: request.method, route: context.routePath, type: context.routeType });
}
