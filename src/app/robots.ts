import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const production = (process.env.APP_ENV ?? process.env.VERCEL_ENV) === 'production';
  return {
    rules: production
      ? [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin', '/cuenta', '/favoritos'] }]
      : [{ userAgent: '*', disallow: '/' }],
    sitemap: production ? `${site}/sitemap.xml` : undefined,
  };
}
