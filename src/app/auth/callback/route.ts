// Intercambio del código PKCE de Supabase (confirmación de email, recuperación de contraseña).
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/auth/supabase';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/cuenta';
  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/cuenta';
  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safe, url.origin));
  }
  return NextResponse.redirect(new URL('/acceder?error=El%20enlace%20no%20es%20v%C3%A1lido%20o%20ha%20caducado', url.origin));
}
