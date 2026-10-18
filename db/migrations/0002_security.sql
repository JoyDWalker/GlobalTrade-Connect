-- Seguridad y extras de Supabase.
-- Modelo: el navegador NUNCA consulta tablas directamente; todo pasa por el servidor de Next.js, que se conecta
-- con un rol de servidor y aplica la autorización. Por eso se activa RLS en todas las tablas sin políticas para
-- los roles anon/authenticated (denegación por defecto vía la API REST de Supabase), y se revocan sus permisos.

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
  END IF;
END $$;

-- Supabase Auth: perfil automático al registrarse (siempre con rol 'user'; el rol nunca se toma de los metadatos)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth')
     AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN

    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
      BEGIN
        INSERT INTO public.profiles (id, email, full_name, role)
        VALUES (NEW.id, NEW.email, left(coalesce(NEW.raw_user_meta_data->>'full_name', ''), 120), 'user')
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
        RETURN NEW;
      END $body$;
    $f$;
    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC';

    -- Al borrar la cuenta en Auth se borra el perfil (las solicitudes quedan con user_id NULL)
    EXECUTE 'ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_fk FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE NOT VALID';
  END IF;
END $$;

-- Búsqueda difusa por trigramas cuando la extensión está disponible (Supabase la incluye)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXECUTE 'CREATE INDEX IF NOT EXISTS companies_search_trgm_idx ON public.companies USING gin (search_text gin_trgm_ops)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS companies_name_trgm_idx ON public.companies USING gin (lower(name) gin_trgm_ops)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm no disponible: se usa solo búsqueda por texto completo';
END $$;
