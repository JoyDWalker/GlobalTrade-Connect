'use client';
import Link from 'next/link';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="wrap empty"><h1>Algo ha fallado</h1>
      <p>No hemos podido cargar esta página. Inténtalo de nuevo en unos segundos.{error.digest ? ` (Ref. ${error.digest})` : ''}</p>
      <div className="row" style={{ justifyContent: 'center' }}><button className="btn btn-primary" onClick={reset}>Reintentar</button><Link className="btn btn-outline" href="/">Inicio</Link></div>
    </div>
  );
}
