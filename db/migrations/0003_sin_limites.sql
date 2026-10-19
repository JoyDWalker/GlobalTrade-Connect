-- Límites amplios para las fuentes gratuitas: el límite diario solo protege frente a abusos.
-- Las fuentes de pago siguen sujetas al presupuesto diario (limits.daily_budget_usd).
UPDATE app_settings SET value = value || '{"searches_per_hour_anon": 600, "searches_per_hour_user": 2000, "external_per_day_anon": 2000, "external_per_day_user": 10000}'::jsonb, updated_at = now() WHERE key = 'limits';
UPDATE app_settings SET value = value || '{"min_internal_results": 40, "max_results_per_source": 20}'::jsonb, updated_at = now() WHERE key = 'external_search';
UPDATE app_settings SET value = value || '{"concurrency": 6}'::jsonb, updated_at = now() WHERE key = 'worker';
UPDATE sources SET daily_quota = NULL WHERE key IN ('gleif', 'wikidata', 'website');
