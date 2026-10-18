-- GlobalTrade Connect · Esquema inicial
-- SQLite (compatible en lo esencial con PostgreSQL: ver README para la migración)

-- ───────────────────────── Catálogos ─────────────────────────

CREATE TABLE countries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  iso_code     TEXT    NOT NULL UNIQUE,          -- ISO 3166-1 alfa-2 (BR, ES…)
  flag_url     TEXT,
  is_priority  INTEGER NOT NULL DEFAULT 0,       -- aparece en portada y accesos rápidos
  sort_order   INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  parent_id   INTEGER REFERENCES categories(id) ON DELETE CASCADE,   -- NULL = categoría principal
  sort_order  INTEGER NOT NULL DEFAULT 100
);
CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE TABLE products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  hs_code      TEXT,                              -- código arancelario SA (opcional)
  UNIQUE (name, category_id)
);

CREATE TABLE certifications (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  slug  TEXT NOT NULL UNIQUE
);

CREATE TABLE languages (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  code  TEXT NOT NULL UNIQUE,                     -- ISO 639-1
  name  TEXT NOT NULL
);

CREATE TABLE business_types (                      -- productor, exportador, importador…
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

CREATE TABLE client_types (                        -- HORECA, retail, supermercados…
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

-- ───────────────────────── Empresas ─────────────────────────

CREATE TABLE companies (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  slug                 TEXT    NOT NULL UNIQUE,
  description          TEXT,
  logo_url             TEXT,
  website              TEXT,
  tax_id               TEXT,                       -- NIF/CNPJ/CUIT/NIT… (no público)
  country_id           INTEGER NOT NULL REFERENCES countries(id),
  region               TEXT,
  city                 TEXT,
  address              TEXT,                       -- dirección aproximada
  coverage_area        TEXT,                       -- zona de cobertura
  company_type         TEXT    NOT NULL,           -- tipo principal (slug de business_types)
  year_founded         INTEGER,
  verification_status  TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (verification_status IN ('verified','pending','unverified')),
  status               TEXT    NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN ('pending_review','approved','rejected')),
  rejection_reason     TEXT,
  is_featured          INTEGER NOT NULL DEFAULT 0,
  export_capacity      INTEGER,                    -- toneladas / año
  production_capacity  TEXT,
  minimum_order        REAL,                       -- kg
  minimum_order_notes  TEXT,                       -- "1 contenedor 20'", "1 palé"…
  commercial_terms     TEXT,                       -- Incoterms, pago, plazos…
  linkedin_url         TEXT,
  instagram_url        TEXT,
  facebook_url         TEXT,
  other_social_url     TEXT,
  is_demo              INTEGER NOT NULL DEFAULT 0, -- datos ficticios de ejemplo
  search_name          TEXT,                       -- nombre normalizado (sin tildes)
  search_text          TEXT,                       -- texto indexado para la búsqueda libre
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_companies_country ON companies(country_id);
CREATE INDEX idx_companies_status  ON companies(status, verification_status);
CREATE INDEX idx_companies_created ON companies(created_at);

CREATE TABLE company_categories (
  company_id   INTEGER NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, category_id)
);
CREATE INDEX idx_cc_category ON company_categories(category_id);

CREATE TABLE company_products (
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  PRIMARY KEY (company_id, product_id)
);

CREATE TABLE company_certifications (
  company_id        INTEGER NOT NULL REFERENCES companies(id)      ON DELETE CASCADE,
  certification_id  INTEGER NOT NULL REFERENCES certifications(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, certification_id)
);

CREATE TABLE company_languages (
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  language_id  INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, language_id)
);

CREATE TABLE company_business_types (              -- una empresa puede ser productora Y exportadora
  company_id        INTEGER NOT NULL REFERENCES companies(id)      ON DELETE CASCADE,
  business_type_id  INTEGER NOT NULL REFERENCES business_types(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, business_type_id)
);

CREATE TABLE company_client_types (
  company_id      INTEGER NOT NULL REFERENCES companies(id)    ON DELETE CASCADE,
  client_type_id  INTEGER NOT NULL REFERENCES client_types(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, client_type_id)
);

CREATE TABLE company_markets (                     -- mercados de exportación / origen de importación
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  country_id  INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  direction   TEXT    NOT NULL CHECK (direction IN ('export','import')),
  PRIMARY KEY (company_id, country_id, direction)
);

CREATE TABLE contacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name       TEXT    NOT NULL,
  job_title       TEXT,
  email           TEXT,
  phone           TEXT,
  whatsapp        TEXT,
  languages       TEXT,                            -- códigos separados por comas: "es,en"
  is_primary      INTEGER NOT NULL DEFAULT 0,
  consent_public  INTEGER NOT NULL DEFAULT 0       -- autoriza mostrar email/teléfono/WhatsApp
);
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_contacts_email   ON contacts(email);

-- ───────────────────────── Leads y solicitudes ─────────────────────────

CREATE TABLE inquiries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inquiry_type      TEXT    NOT NULL DEFAULT 'contact' CHECK (inquiry_type IN ('contact','quote')),
  sender_name       TEXT    NOT NULL,
  sender_company    TEXT,
  sender_country    TEXT,
  email             TEXT    NOT NULL,
  phone             TEXT,
  product_interest  TEXT,
  estimated_volume  TEXT,
  message           TEXT    NOT NULL,
  consent_privacy   INTEGER NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','answered','archived')),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_inquiries_company ON inquiries(company_id, created_at);

CREATE TABLE supplier_requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_name         TEXT NOT NULL,
  email             TEXT NOT NULL,
  company_name      TEXT,
  phone             TEXT,
  product           TEXT NOT NULL,
  category_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  origin_countries  TEXT,                          -- ISO separados por comas
  certifications    TEXT,                          -- slugs separados por comas
  quantity          TEXT,
  target_date       TEXT,
  notes             TEXT,
  consent_privacy   INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','closed')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE data_reports (                        -- "Reportar datos incorrectos"
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reporter_email  TEXT,
  field           TEXT,
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','resolved','dismissed')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE privacy_requests (                    -- RGPD: acceso / rectificación / supresión
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  request_type  TEXT NOT NULL CHECK (request_type IN ('deletion','access','rectification')),
  details       TEXT,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','completed','rejected')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at   TEXT
);

-- ───────────────────────── Usuarios ─────────────────────────

CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'company' CHECK (role IN ('company','admin')),
  company_id     INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE favorites (
  user_id     INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, company_id)
);

-- Bandeja de salida de emails (en local no se envían: se registran aquí)
CREATE TABLE mail_outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  related_type  TEXT,
  related_id    INTEGER,
  sent_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
