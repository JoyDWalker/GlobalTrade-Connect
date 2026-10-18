import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from '@/components/client';
import { Header } from '@/components/header';
import { authConfigured } from '@/lib/env';

// Renderizado dinámico en todas las páginas: necesario para la CSP con nonce por petición
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'GlobalTrade Connect · Directorio B2B internacional', template: '%s · GlobalTrade Connect' },
  description: 'Encuentra fabricantes, proveedores, importadores, exportadores, distribuidores y prestadores de servicios de cualquier país.',
  icons: { icon: '/img/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isDemo = process.env.APP_ENV !== 'production' && process.env.VERCEL_ENV !== 'production';
  return (
    <html lang="es">
      <body>
        <a className="sr-only" href="#main">Saltar al contenido</a>
        <Providers authEnabled={authConfigured()}>
          {isDemo && <div className="demo-banner">Entorno de desarrollo/pruebas: las empresas marcadas como DEMO son ficticias.</div>}
          <Header />
          <main id="main" tabIndex={-1}>{children}</main>
          <footer className="site-footer">
            <div className="wrap">
              <div className="footer-grid">
                <div><h4>GlobalTrade Connect</h4><p>Plataforma B2B para localizar empresas y oportunidades comerciales en todo el mundo. La información procede de las propias empresas y de fuentes públicas citadas en cada ficha.</p></div>
                <div><h4>Directorio</h4><ul><li><Link href="/buscar">Buscar empresas</Link></li><li><Link href="/buscar?verification=verified">Empresas verificadas</Link></li><li><Link href="/fuentes">Fuentes de datos</Link></li></ul></div>
                <div><h4>Empresas</h4><ul><li><Link href="/registrar">Registra tu empresa</Link></li><li><Link href="/solicitar-proveedores">Solicita proveedores</Link></li><li><Link href="/acceder">Acceso</Link></li></ul></div>
                <div><h4>Legal</h4><ul><li><Link href="/privacidad">Privacidad y cookies</Link></li><li><Link href="/privacidad#derechos">Ejercer derechos RGPD</Link></li><li><Link href="/fuentes#verificacion">Cómo verificamos</Link></li></ul></div>
              </div>
              <div className="footer-bottom">© {new Date().getFullYear()} GlobalTrade Connect. La aparición en el directorio no implica que una empresa esté legalmente registrada o activa salvo que se indique como verificada.</div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
