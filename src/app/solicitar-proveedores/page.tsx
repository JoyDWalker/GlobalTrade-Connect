import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import { getMeta } from '@/lib/meta';
import { SupplierRequestForm } from './form';

export const metadata: Metadata = { title: 'Solicitar proveedores' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  return (
    <div className="wrap">
      <div className="page-head form-narrow"><h1>Solicita proveedores</h1>
        <p>Cuéntanos qué producto o servicio necesitas. Nuestro equipo revisará la solicitud y te propondrá empresas adecuadas. Sin coste ni compromiso.</p></div>
      <div className="form-narrow"><SupplierRequestForm meta={await getMeta(getDb())} product={product?.slice(0, 200) ?? ''} /></div>
    </div>
  );
}
