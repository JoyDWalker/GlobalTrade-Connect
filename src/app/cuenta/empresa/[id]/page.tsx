import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getMeta } from '@/lib/meta';
import { canManageCompany, getSessionUser } from '@/lib/auth/session';
import { companyDetail } from '@/lib/services/companies';
import { OwnerEdit } from './owner-edit';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/acceder?next=/cuenta/empresa/${id}`);
  if (!z.string().uuid().safeParse(id).success || !canManageCompany(user, id)) notFound();
  const db = getDb();
  const c = await companyDetail(db, { id }, { privateView: true });
  if (!c || c.deleted_at) notFound();
  return (
    <div className="wrap">
      <p style={{ marginTop: 16 }}><Link href="/cuenta">← Mi cuenta</Link></p>
      <div className="page-head form-narrow" style={{ paddingTop: 0 }}><h1>Editar {c.name}</h1>
        <p className="muted">Los cambios se publican y quedan registrados en el historial. Si cambias el nombre, la web o el identificador fiscal, la verificación previa se retira hasta una nueva revisión.</p></div>
      <div className="form-narrow"><OwnerEdit meta={await getMeta(db)} company={c} /></div>
    </div>
  );
}
