// Arranque del servidor: valida la configuración y registra errores no controlados como logs estructurados.
// Si la configuración es inválida no se detiene el proceso: /api/health informa del problema (sin valores)
// y las rutas que necesitan la configuración fallan de forma controlada.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { configProblems, env } = await import('./lib/env');
  const { log } = await import('./lib/logger');
  const problems = configProblems();
  if (problems.length) {
    log.error('Configuración inválida al arrancar', { problems });
    return;
  }
  const e = env();
  log.info('Servidor iniciado', { appEnv: e.APP_ENV, auth: Boolean(e.NEXT_PUBLIC_SUPABASE_URL), mailer: e.EMAIL_PROVIDER, searchApis: { brave: Boolean(e.BRAVE_SEARCH_API_KEY), google: Boolean(e.GOOGLE_CSE_API_KEY && e.GOOGLE_CSE_ENGINE_ID) } });
}

export async function onRequestError(error: unknown, request: { path: string; method: string }, context: { routerKind: string; routePath: string; routeType: string }) {
  const { log } = await import('./lib/logger');
  log.error('Error en una petición', { error, path: request.path, method: request.method, route: context.routePath, type: context.routeType });
}
