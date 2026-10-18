import type { MetadataRoute } from 'next';
import { getDb, many } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const rows = await many<{ slug: string; updated_at: string }>(getDb(),
    "SELECT slug, updated_at FROM companies WHERE deleted_at IS NULL AND record_status = 'published' AND NOT is_demo ORDER BY updated_at DESC LIMIT 45000").catch(() => []);
  return [
    { url: site, changeFrequency: 'daily', priority: 1 },
    { url: `${site}/buscar`, changeFrequency: 'daily' },
    ...rows.map((r) => ({ url: `${site}/empresa/${r.slug}`, lastModified: new Date(r.updated_at) })),
  ];
}
