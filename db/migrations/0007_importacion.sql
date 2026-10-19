-- Importación automática y gratuita de empresas reales (Wikidata), país por país y en tandas.
-- Guarda por dónde va cada país para continuar en la siguiente ejecución del worker.
CREATE TABLE import_cursors (
  source        text NOT NULL,
  country_code  text NOT NULL REFERENCES countries (iso_code) ON DELETE CASCADE,
  last_key      bigint NOT NULL DEFAULT 0,
  done          boolean NOT NULL DEFAULT false,
  imported      int NOT NULL DEFAULT 0,
  failures      int NOT NULL DEFAULT 0,
  last_error    text,
  updated_at    timestamptz,
  PRIMARY KEY (source, country_code)
);
ALTER TABLE import_cursors ENABLE ROW LEVEL SECURITY;
