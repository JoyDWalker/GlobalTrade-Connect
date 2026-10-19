-- Expansión de búsquedas por producto/sector con IA.
-- query_expansions: caché de la expansión por producto y país (no se paga dos veces la misma).
-- ai_requests: registro de cada llamada a la IA; su coste cuenta en el presupuesto diario de APIs.
CREATE TABLE query_expansions (
  cache_key     text PRIMARY KEY,
  product       text NOT NULL,
  country_code  text,
  origin        text NOT NULL CHECK (origin IN ('ai', 'catalog')),
  model         text,
  result        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX query_expansions_expires_idx ON query_expansions (expires_at);

CREATE TABLE ai_requests (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purpose        text NOT NULL CHECK (purpose IN ('expand')),
  model          text NOT NULL,
  status         text NOT NULL CHECK (status IN ('ok', 'error', 'refusal', 'invalid')),
  input_tokens   int NOT NULL DEFAULT 0,
  output_tokens  int NOT NULL DEFAULT 0,
  cost_usd       numeric(10, 4) NOT NULL DEFAULT 0,
  duration_ms    int,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_requests_created_idx ON ai_requests (created_at DESC);

-- Solo el servidor accede (igual que el resto de tablas internas)
ALTER TABLE query_expansions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;

UPDATE app_settings SET value = value || '{"ai_expansion": true, "max_queries": 6}'::jsonb, updated_at = now() WHERE key = 'external_search';
