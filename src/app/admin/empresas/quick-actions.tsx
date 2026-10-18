'use client';
import { useState } from 'react';
import { apiFetch, Field, Modal, useToast } from '@/components/client';

export function CompanyQuickActions({ c, onDone }: { c: { id: string; name: string; slug: string; record_status: string; verification_level: string; is_featured: boolean }; onDone: () => void }) {
  const toast = useToast();
  const [ask, setAsk] = useState<null | 'reject' | 'verify' | 'contrast'>(null);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    try { const r = await apiFetch<{ message?: string }>(`/api/admin/companies/${c.id}/actions`, { body: { action, ...extra } }); toast(r.message ?? 'Hecho'); setAsk(null); onDone(); }
    catch (e) { toast((e as Error).message, { error: true }); }
  };
  return (
    <div className="actions">
      {c.record_status !== 'published' && c.record_status !== 'hidden' && <button className="btn btn-primary btn-sm" onClick={() => act('publish')}>Publicar</button>}
      {c.record_status === 'hidden' && <button className="btn btn-outline btn-sm" onClick={() => act('restore')}>Restaurar</button>}
      {c.record_status !== 'rejected' && c.record_status !== 'published' && <button className="btn btn-danger btn-sm" onClick={() => setAsk('reject')}>Rechazar</button>}
      {c.record_status === 'published' && <button className="btn btn-ghost btn-sm" onClick={() => act('hide')}>Ocultar</button>}
      {c.verification_level !== 'verified' ? <button className="btn btn-outline btn-sm" onClick={() => setAsk('verify')}>Verificar</button> : <button className="btn btn-ghost btn-sm" onClick={() => act('unverify')}>Quitar verificación</button>}
      {c.verification_level === 'none' && <button className="btn btn-ghost btn-sm" onClick={() => setAsk('contrast')}>Contrastada</button>}
      <button className="btn btn-ghost btn-sm" onClick={() => act(c.is_featured ? 'unfeature' : 'feature')}>{c.is_featured ? 'No destacar' : 'Destacar'}</button>
      <button className="btn btn-ghost btn-sm" title="Consultar el registro GLEIF" onClick={() => act('registry_check')}>Registro</button>
      <button className="btn btn-ghost btn-sm" title="Actualizar desde la web oficial" onClick={() => act('enrich')}>Web</button>
      {ask && (
        <Modal title={ask === 'reject' ? `Rechazar ${c.name}` : ask === 'verify' ? `Verificar ${c.name}` : `Marcar como contrastada: ${c.name}`} onClose={() => setAsk(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('v') ?? '').trim(); act(ask, ask === 'reject' ? { reason: v } : { method: v }); }}>
            {ask === 'reject'
              ? <Field label="Motivo (se envía al titular)" required><textarea className="input" name="v" maxLength={500} /></Field>
              : <Field label="Procedimiento realizado" required hint={ask === 'verify' ? 'Ej.: Registro Mercantil (n.º …) + respuesta desde email del dominio + llamada al teléfono publicado' : 'Ej.: nombre legal y país coinciden con GLEIF'}><textarea className="input" name="v" maxLength={300} /></Field>}
            <div className="row" style={{ justifyContent: 'flex-end' }}><button className={`btn ${ask === 'reject' ? 'btn-danger' : 'btn-primary'}`}>Confirmar</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
