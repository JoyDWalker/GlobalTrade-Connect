// Clientes de Supabase Auth. Solo se usa la clave pública (anon/publishable) en el navegador;
// la clave service_role se usa exclusivamente en el servidor (src/lib/auth/admin.ts).
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const supabaseAnonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export async function createSupabaseServer() {
  const store = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { for (const { name, value, options } of list) store.set(name, value, options); }
        catch { /* en Server Components no se pueden escribir cookies: el proxy refresca la sesión */ }
      },
    },
  });
}
