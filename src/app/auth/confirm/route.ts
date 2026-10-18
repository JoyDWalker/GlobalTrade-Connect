// Confirmación por token_hash (plantillas de email de Supabase que usan {{ .TokenHash }}).
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/auth/supabase';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = url.searchParams.get('next') ?? '/cuenta';
  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/cuenta';
  if (token_hash && type) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(type === 'recovery' ? '/cuenta/contrasena' : safe, url.origin));
  }
  return NextResponse.redirect(new URL('/acceder?error=El%20enlace%20no%20es%20v%C3%A1lido%20o%20ha%20caducado', url.origin));
}
