import { NextResponse } from 'next/server';
import { formToken } from '@/lib/api';

export const dynamic = 'force-dynamic';
export function GET() {
  return NextResponse.json({ token: formToken() }, { headers: { 'Cache-Control': 'no-store' } });
}
