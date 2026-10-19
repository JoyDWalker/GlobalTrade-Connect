-- Seguimiento comercial privado del administrador: estado de contacto, etiquetas, próxima acción y notas.
-- Nunca se muestra en la web pública ni se exporta en los listados públicos.
CREATE TABLE company_followups (
  company_id       uuid PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pendiente'
                   CHECK (status IN ('pendiente', 'contactado', 'en_conversacion', 'interesado', 'cliente', 'no_interesado', 'descartado')),
  tags             text[] NOT NULL DEFAULT '{}',
  next_action      text,
  next_action_at   date,
  last_contact_at  timestamptz,
  updated_by       uuid REFERENCES profiles (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_followups_status_idx ON company_followups (status, next_action_at);
CREATE INDEX company_followups_tags_idx ON company_followups USING gin (tags);

CREATE TABLE company_notes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'nota' CHECK (kind IN ('nota', 'llamada', 'email', 'reunion')),
  body        text NOT NULL,
  created_by  uuid REFERENCES profiles (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_notes_company_idx ON company_notes (company_id, created_at DESC);

ALTER TABLE company_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_notes ENABLE ROW LEVEL SECURITY;

-- La búsqueda en fuentes externas (de pago) queda reservada a administradores
UPDATE app_settings SET value = value || '{"admins_only": true}'::jsonb, updated_at = now() WHERE key = 'external_search';
