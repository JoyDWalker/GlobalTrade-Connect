-- GlobalTrade Connect · esquema principal (PostgreSQL 15+)
-- Compatible con Supabase y con PostgreSQL estándar. Lo específico de Supabase está en 0002.

-- ───────────────────────── Utilidades ─────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ───────────────────────── Configuración ─────────────────────────
CREATE TABLE app_settings (
  key          text PRIMARY KEY,
  value        jsonb NOT NULL,
  description  text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid
);

-- ───────────────────────── Usuarios ─────────────────────────
-- id = auth.users.id en Supabase. El rol SOLO lo cambia el servidor (nunca el propio usuario).
CREATE TABLE profiles (
  id          uuid PRIMARY KEY,
  email       text NOT NULL,
  full_name   text,
  role        text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'company', 'admin')),
  is_blocked  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX profiles_email_key ON profiles (lower(email));
CREATE TRIGGER profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ───────────────────────── Catálogos abiertos ─────────────────────────
CREATE TABLE countries (
  iso_code     char(2) PRIMARY KEY,
  name         text NOT NULL,
  continent    text,
  flag_url     text,
  is_priority  boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 100
);

-- Árbol de sectores/categorías sin límite de profundidad. Las empresas también tienen keywords libres.
CREATE TABLE categories (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  parent_id    bigint REFERENCES categories (id) ON DELETE RESTRICT,
  description  text,
  sort_order   int NOT NULL DEFAULT 100,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX categories_parent_idx ON categories (parent_id);

CREATE TABLE certifications (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug  text NOT NULL UNIQUE,
  name  text NOT NULL
);

CREATE TABLE languages (
  code  text PRIMARY KEY,           -- ISO 639-1
  name  text NOT NULL
);

CREATE TABLE client_types (
  slug  text PRIMARY KEY,
  name  text NOT NULL
);

-- Tipos de actividad (productor, exportador, OEM, logística, software…). Ampliable desde el panel.
CREATE TABLE business_types (
  slug  text PRIMARY KEY,
  name  text NOT NULL,
  sort_order int NOT NULL DEFAULT 100
);

-- ───────────────────────── Fuentes de información ─────────────────────────
CREATE TABLE sources (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key                text NOT NULL UNIQUE,         -- google_cse, brave, gleif, website, self_registered…
  name               text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('search_api', 'registry', 'website', 'directory', 'manual', 'self_registered')),
  base_url           text,
  terms_url          text,
  licence            text,
  reliability        smallint NOT NULL DEFAULT 50 CHECK (reliability BETWEEN 0 AND 100),
  enabled            boolean NOT NULL DEFAULT true,
  daily_quota        int,                          -- peticiones/día que nos permitimos (NULL = sin límite propio)
  cost_per_1000_usd  numeric(10, 4) NOT NULL DEFAULT 0,
  config             jsonb NOT NULL DEFAULT '{}',
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Empresas ─────────────────────────
CREATE TABLE companies (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  legal_name           text,
  description          text,
  main_activity        text,
  country_code         char(2) REFERENCES countries (iso_code) ON DELETE RESTRICT,
  region               text,
  city                 text,
  address              text,                        -- dirección comercial pública
  postal_code          text,
  coverage_area        text,
  website              text,
  domain               text,                        -- dominio normalizado (clave de deduplicación)
  email                text,                        -- email corporativo publicado
  phone                text,                        -- teléfono comercial publicado
  logo_url             text,
  company_types        text[] NOT NULL DEFAULT '{}',
  keywords             text[] NOT NULL DEFAULT '{}',
  year_founded         int CHECK (year_founded BETWEEN 1500 AND 2100),
  employees_range      text,
  export_capacity_tons numeric,
  production_capacity  text,
  minimum_order_kg     numeric,
  minimum_order_notes  text,
  commercial_terms     text,
  social               jsonb NOT NULL DEFAULT '{}', -- {linkedin, instagram, facebook, other}
  tax_id               text,                        -- nunca público
  tax_id_normalized    text,
  lei                  text,                        -- Legal Entity Identifier (GLEIF)
  -- Ciclo de vida del registro:
  --   detected       → encontrada automáticamente en una fuente externa, sin revisar
  --   pending_review → enviada por la empresa o con cambios pendientes de revisión
  --   published      → visible con normalidad
  --   hidden         → oculta por un administrador
  --   rejected       → rechazada
  record_status        text NOT NULL DEFAULT 'pending_review'
                       CHECK (record_status IN ('detected', 'pending_review', 'published', 'hidden', 'rejected')),
  -- Nivel de verificación:
  --   none        → sin contrastar
  --   contrasted  → datos clave coinciden en al menos dos fuentes independientes
  --   verified    → verificada mediante el procedimiento documentado (registro oficial + control de dominio/contacto)
  verification_level   text NOT NULL DEFAULT 'none' CHECK (verification_level IN ('none', 'contrasted', 'verified')),
  verification_method  text,
  verified_at          timestamptz,
  verified_by          uuid REFERENCES profiles (id) ON DELETE SET NULL,
  rejection_reason     text,
  is_featured          boolean NOT NULL DEFAULT false,
  is_demo              boolean NOT NULL DEFAULT false,
  origin               text NOT NULL DEFAULT 'admin' CHECK (origin IN ('self_registered', 'admin', 'external', 'seed')),
  website_status       text NOT NULL DEFAULT 'unknown' CHECK (website_status IN ('unknown', 'ok', 'redirect', 'broken', 'blocked')),
  website_checked_at   timestamptz,
  data_collected_at    timestamptz NOT NULL DEFAULT now(),
  last_checked_at      timestamptz,
  search_text          text NOT NULL DEFAULT '',
  search_vector        tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz                  -- borrado lógico: nunca se pierde el historial
);
CREATE UNIQUE INDEX companies_domain_key  ON companies (domain) WHERE domain IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX companies_tax_key     ON companies (country_code, tax_id_normalized) WHERE tax_id_normalized IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX companies_lei_key     ON companies (lei) WHERE lei IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX companies_search_idx         ON companies USING gin (search_vector);
CREATE INDEX companies_types_idx          ON companies USING gin (company_types);
CREATE INDEX companies_keywords_idx       ON companies USING gin (keywords);
CREATE INDEX companies_status_idx         ON companies (record_status, verification_level) WHERE deleted_at IS NULL;
CREATE INDEX companies_country_idx        ON companies (country_code, city);
CREATE INDEX companies_created_idx        ON companies (created_at DESC);
CREATE INDEX companies_checked_idx        ON companies (last_checked_at NULLS FIRST);
CREATE TRIGGER companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE company_categories (
  company_id   uuid   NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  category_id  bigint NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  PRIMARY KEY (company_id, category_id)
);
CREATE INDEX company_categories_cat_idx ON company_categories (category_id);

-- Productos y servicios en texto libre (no dependen de un catálogo cerrado)
CREATE TABLE offerings (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  kind         text NOT NULL DEFAULT 'product' CHECK (kind IN ('product', 'service')),
  name         text NOT NULL,
  description  text,
  hs_code      text,
  category_id  bigint REFERENCES categories (id) ON DELETE SET NULL
);
CREATE INDEX offerings_company_idx ON offerings (company_id);

CREATE TABLE company_certifications (
  company_id        uuid   NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  certification_id  bigint NOT NULL REFERENCES certifications (id) ON DELETE RESTRICT,
  evidence_url      text,
  PRIMARY KEY (company_id, certification_id)
);

CREATE TABLE company_languages (
  company_id     uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  language_code  text NOT NULL REFERENCES languages (code) ON DELETE RESTRICT,
  PRIMARY KEY (company_id, language_code)
);

CREATE TABLE company_client_types (
  company_id   uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  client_type  text NOT NULL REFERENCES client_types (slug) ON DELETE RESTRICT,
  PRIMARY KEY (company_id, client_type)
);

CREATE TABLE company_markets (
  company_id    uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  country_code  char(2) NOT NULL REFERENCES countries (iso_code) ON DELETE RESTRICT,
  direction     text    NOT NULL CHECK (direction IN ('export', 'import')),
  PRIMARY KEY (company_id, country_code, direction)
);

-- Contactos: se priorizan buzones corporativos. Los personales solo se muestran con consentimiento.
CREATE TABLE company_contacts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  full_name       text,
  job_title       text,
  email           text,
  phone           text,
  whatsapp        text,
  languages       text[] NOT NULL DEFAULT '{}',
  is_primary      boolean NOT NULL DEFAULT false,
  is_personal     boolean NOT NULL DEFAULT true,   -- false = buzón/teléfono corporativo genérico
  consent_public  boolean NOT NULL DEFAULT false,  -- autorización para mostrarlo públicamente
  hidden          boolean NOT NULL DEFAULT false,  -- ocultado (p. ej. tras solicitud RGPD)
  source_id       bigint REFERENCES sources (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_contacts_company_idx ON company_contacts (company_id);
CREATE INDEX company_contacts_email_idx   ON company_contacts (lower(email));

CREATE TABLE company_members (
  company_id  uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX company_members_user_idx ON company_members (user_id);

-- ───────────────────────── Procedencia e historial ─────────────────────────
-- Dónde se ha visto cada empresa (una fila por fuente e identificador externo)
CREATE TABLE company_sources (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id     uuid   NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  source_id      bigint NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
  external_id    text   NOT NULL,
  source_url     text,
  title          text,
  snippet        text,
  raw            jsonb,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);
CREATE INDEX company_sources_company_idx ON company_sources (company_id);

-- Procedencia de cada dato relevante
CREATE TABLE data_provenance (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  field         text NOT NULL,
  value         text,
  source_id     bigint REFERENCES sources (id) ON DELETE SET NULL,
  source_url    text,
  status        text NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'pending_review', 'confirmed', 'rejected')),
  collected_at  timestamptz NOT NULL DEFAULT now(),
  checked_at    timestamptz
);
CREATE INDEX data_provenance_company_idx ON data_provenance (company_id, field);

CREATE TABLE company_changes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id     uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  changed_by     uuid REFERENCES profiles (id) ON DELETE SET NULL,
  change_source  text NOT NULL CHECK (change_source IN ('owner', 'admin', 'worker', 'external', 'system')),
  changes        jsonb NOT NULL,                    -- {campo: {from, to}}
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_changes_company_idx ON company_changes (company_id, created_at DESC);

CREATE TABLE verification_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  kind        text NOT NULL,                        -- registry_lookup, link_check, manual_review, owner_claim…
  result      text NOT NULL CHECK (result IN ('match', 'partial', 'no_match', 'ok', 'error', 'info')),
  details     jsonb NOT NULL DEFAULT '{}',
  source_id   bigint REFERENCES sources (id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES profiles (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_events_company_idx ON verification_events (company_id, created_at DESC);

-- ───────────────────────── Búsquedas ─────────────────────────
CREATE TABLE searches (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  query             text,
  query_normalized  text,
  filters           jsonb NOT NULL DEFAULT '{}',
  user_id           uuid REFERENCES profiles (id) ON DELETE SET NULL,
  ip_hash           text,
  internal_results  int NOT NULL DEFAULT 0,
  external_status   text,                           -- not_requested, cached, ok, partial, failed, quota, disabled
  external_results  int NOT NULL DEFAULT 0,
  duration_ms       int,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX searches_query_idx ON searches (query_normalized, created_at DESC);
CREATE INDEX searches_created_idx ON searches (created_at DESC);

CREATE TABLE search_results (
  search_id   bigint NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
  company_id  uuid   NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  rank        int    NOT NULL,
  origin      text   NOT NULL CHECK (origin IN ('internal', 'external')),
  PRIMARY KEY (search_id, company_id)
);

CREATE TABLE search_cache (
  cache_key   text PRIMARY KEY,
  source_id   bigint NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  query       text NOT NULL,
  results     jsonb NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX search_cache_expires_idx ON search_cache (expires_at);

-- Registro de cada llamada a una fuente externa (estado, duración, coste estimado)
CREATE TABLE external_requests (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id    bigint NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  purpose      text NOT NULL CHECK (purpose IN ('search', 'enrich', 'verify', 'link_check')),
  query        text,
  status       text NOT NULL CHECK (status IN ('ok', 'error', 'timeout', 'quota_exceeded', 'rate_limited', 'blocked', 'disabled', 'cached')),
  http_status  int,
  attempts     int NOT NULL DEFAULT 1,
  duration_ms  int,
  results      int NOT NULL DEFAULT 0,
  cost_usd     numeric(10, 4) NOT NULL DEFAULT 0,
  error        text,
  job_id       bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX external_requests_source_idx ON external_requests (source_id, created_at DESC);

-- ───────────────────────── Listas y favoritos ─────────────────────────
CREATE TABLE lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE TABLE list_items (
  list_id     uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, company_id)
);

-- ───────────────────────── Leads y solicitudes ─────────────────────────
CREATE TABLE inquiries (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id        uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  sender_user_id    uuid REFERENCES profiles (id) ON DELETE SET NULL,
  inquiry_type      text NOT NULL DEFAULT 'contact' CHECK (inquiry_type IN ('contact', 'quote')),
  sender_name       text NOT NULL,
  sender_company    text,
  sender_country    text,
  email             text NOT NULL,
  phone             text,
  product_interest  text,
  estimated_volume  text,
  message           text NOT NULL,
  consent_privacy   boolean NOT NULL,
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'answered', 'archived')),
  ip_hash           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inquiries_company_idx ON inquiries (company_id, created_at DESC);

CREATE TABLE supplier_requests (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id               uuid REFERENCES profiles (id) ON DELETE SET NULL,
  user_name             text NOT NULL,
  email                 text NOT NULL,
  company_name          text,
  phone                 text,
  product               text NOT NULL,
  category_id           bigint REFERENCES categories (id) ON DELETE SET NULL,
  origin_countries      text[] NOT NULL DEFAULT '{}',
  certifications        text[] NOT NULL DEFAULT '{}',
  quantity              text NOT NULL,
  target_date           date,
  notes                 text,
  consent_privacy       boolean NOT NULL,
  status                text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'closed')),
  suggested_company_ids uuid[] NOT NULL DEFAULT '{}', -- preparado por el worker para el administrador
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE data_reports (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  reporter_email  text,
  field           text,
  message         text NOT NULL,
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'resolved', 'dismissed')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE privacy_requests (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL,
  request_type  text NOT NULL CHECK (request_type IN ('deletion', 'access', 'rectification', 'objection')),
  details       text,
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'completed', 'rejected')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES profiles (id) ON DELETE SET NULL
);

-- ───────────────────────── Revisión administrativa ─────────────────────────
CREATE TABLE review_tasks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    uuid REFERENCES companies (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('new_detected', 'self_registered', 'duplicate_candidate', 'broken_link',
                  'stale_data', 'registry_evidence', 'verification_request', 'correction_request', 'data_report', 'owner_update')),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  priority      smallint NOT NULL DEFAULT 50,
  details       jsonb NOT NULL DEFAULT '{}',
  dedupe_key    text,
  requested_by  uuid REFERENCES profiles (id) ON DELETE SET NULL,
  resolved_by   uuid REFERENCES profiles (id) ON DELETE SET NULL,
  resolution    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
CREATE UNIQUE INDEX review_tasks_open_key ON review_tasks (dedupe_key) WHERE status = 'open' AND dedupe_key IS NOT NULL;
CREATE INDEX review_tasks_status_idx ON review_tasks (status, priority DESC, created_at);

-- ───────────────────────── Tareas asíncronas (cola persistente) ─────────────────────────
CREATE TABLE jobs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  priority      smallint NOT NULL DEFAULT 50,
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 3,
  run_at        timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  result        jsonb,
  dedupe_key    text,
  created_by    uuid REFERENCES profiles (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
-- Evita encolar dos veces la misma tarea mientras está pendiente o en curso
CREATE UNIQUE INDEX jobs_active_dedupe_key ON jobs (dedupe_key) WHERE status IN ('queued', 'running') AND dedupe_key IS NOT NULL;
CREATE INDEX jobs_ready_idx ON jobs (status, run_at, priority DESC);

-- ───────────────────────── Auditoría, límites y correo ─────────────────────────
CREATE TABLE audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     uuid,
  actor_email  text,
  action       text NOT NULL,
  entity_type  text,
  entity_id    text,
  details      jsonb NOT NULL DEFAULT '{}',
  ip_hash      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_entity_idx  ON audit_log (entity_type, entity_id);

CREATE TABLE rate_limits (
  key           text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         int NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE email_outbox (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_email      text NOT NULL,
  subject       text NOT NULL,
  body_text     text NOT NULL,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'logged')),
  attempts      int NOT NULL DEFAULT 0,
  provider_id   text,
  last_error    text,
  related_type  text,
  related_id    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
CREATE INDEX email_outbox_status_idx ON email_outbox (status, created_at);
