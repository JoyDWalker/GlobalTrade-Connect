'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS: [string, string][] = [
  ['/admin', 'Resumen'], ['/admin/revision', 'Revisión'], ['/admin/seguimiento', 'Seguimiento'], ['/admin/empresas', 'Empresas'], ['/admin/solicitudes', 'Solicitudes'],
  ['/admin/usuarios', 'Usuarios'], ['/admin/tareas', 'Tareas y búsquedas'], ['/admin/fuentes', 'Fuentes y costes'], ['/admin/ajustes', 'Ajustes'],
  ['/admin/catalogos', 'Catálogos'], ['/admin/auditoria', 'Auditoría'], ['/admin/emails', 'Emails'],
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="admin-nav" aria-label="Administración">
      {ITEMS.map(([href, label]) => <Link key={href} href={href} className={(href === '/admin' ? path === href : path.startsWith(href)) ? 'active' : ''}><span>{label}</span></Link>)}
    </nav>
  );
}
