-- Descubrimiento de la web oficial de empresas detectadas sin web (p. ej. las que vienen de GLEIF).
-- Solo añade una columna y un índice (migración no destructiva).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website_discovered_at timestamptz;
CREATE INDEX IF NOT EXISTS companies_missing_website_idx ON companies (created_at DESC)
  WHERE website IS NULL AND website_discovered_at IS NULL AND deleted_at IS NULL;
