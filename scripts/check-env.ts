// npm run check:env — valida la configuración sin arrancar la app. No imprime valores secretos.
import './load-env';
import { env } from '../src/lib/env';

try {
  const e = env();
  console.log(`Entorno: ${e.APP_ENV}`);
  for (const k of ['DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET',
    'BRAVE_SEARCH_API_KEY', 'GOOGLE_CSE_API_KEY', 'GOOGLE_CSE_ENGINE_ID', 'RESEND_API_KEY', 'ADMIN_NOTIFY_EMAIL', 'ALERT_WEBHOOK_URL'] as const) {
    console.log(`  ${k.padEnd(32)} ${e[k] ? 'definida' : '—'}`);
  }
  console.log(`  ${'DATABASE_SSL'.padEnd(32)} ${e.DATABASE_SSL}`);
  console.log(`  ${'EMAIL_PROVIDER'.padEnd(32)} ${e.EMAIL_PROVIDER}`);
  console.log('Configuración válida.');
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
