-- Empresas sin web conocida: fecha del último intento de encontrar su web y teléfono por nombre
-- (Google Maps vía Serper y buscador web), para no repetirlo en cada ejecución del worker.
ALTER TABLE companies ADD COLUMN contacts_searched_at timestamptz;
CREATE INDEX companies_missing_contacts_idx ON companies (contacts_searched_at NULLS FIRST) WHERE deleted_at IS NULL AND email IS NULL AND phone IS NULL;
