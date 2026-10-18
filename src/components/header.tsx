'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Icon } from './icons';
import { useSession, useToast } from './client';

export function supabaseBrowser() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

export function Header() {
  const path = usePathname();
  const router = useRouter();
  const { user, saved, refresh, authEnabled } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => { setOpen(false); setMenu(false); }, [path]);
  const active = (p: string) => (path.startsWith(p) ? 'active' : '');

  async function logout() {
    if (authEnabled) await supabaseBrowser().auth.signOut();
    await refresh();
    toast('Sesión cerrada');
    router.push('/');
    router.refresh();
  }

  return (
    <header className="site-header">
      <div className="wrap">
        <Link className="brand" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/favicon.svg" alt="" />
          <span>GlobalTrade Connect<small>Directorio B2B internacional</small></span>
        </Link>
        <button className="menu-toggle" aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="menu" /></button>
        <nav className={`main-nav ${open ? 'open' : ''}`}>
          <Link className={active('/buscar')} href="/buscar">Buscar empresas</Link>
          <Link className={active('/solicitar-proveedores')} href="/solicitar-proveedores">Solicitar proveedores</Link>
          <Link className={active('/registrar')} href="/registrar">Registra tu empresa</Link>
          <div className="nav-right">
            <Link className={active('/favoritos')} href="/favoritos">Favoritos{saved.size ? <span className="fav-count">{saved.size}</span> : null}</Link>
            {user ? (
              <div className={`user-menu ${menu ? 'open' : ''}`}>
                <button className="navlink" aria-haspopup="true" aria-expanded={menu} onClick={() => setMenu(!menu)}>{(user.full_name || user.email).split(/[\s@]/)[0]} ▾</button>
                <div className="dropdown">
                  {user.role === 'admin' && <Link href="/admin">Panel de administración</Link>}
                  <Link href="/cuenta">Mi cuenta</Link>
                  <Link href="/favoritos">Mis listas</Link>
                  <button onClick={logout}>Cerrar sesión</button>
                </div>
              </div>
            ) : <Link className={active('/acceder')} href="/acceder">Acceder</Link>}
          </div>
        </nav>
      </div>
    </header>
  );
}
