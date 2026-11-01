// Analítica de producto con PostHog (región UE). Sin token no se carga nada.
// Modo sin cookies: no guarda nada en el navegador, así que no necesita banner de consentimiento (RGPD).
import posthog from 'posthog-js';

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (token) {
  posthog.init(token, {
    api_host: '/ingest',
    ui_host: 'https://eu.posthog.com',
    defaults: '2026-05-30',
    cookieless_mode: 'always',
    person_profiles: 'never',
  });
}
