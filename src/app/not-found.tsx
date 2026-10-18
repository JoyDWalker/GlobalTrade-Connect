import Link from 'next/link';

export default function NotFound() {
  return <div className="wrap empty"><h1>Página no encontrada</h1><p>La página o empresa que buscas no existe o ya no está disponible.</p><Link className="btn btn-primary" href="/buscar">Buscar empresas</Link></div>;
}
