import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getMeta } from '@/lib/meta';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await getMeta(getDb()), { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
}
