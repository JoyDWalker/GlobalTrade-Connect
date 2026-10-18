'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CompanyCard } from '@/lib/services/companies';
import { apiFetch, download, useSession, useToast } from '@/components/client';
import { Icon } from '@/components/icons';
import { Flag, VerificationBadge } from '@/components/ui';

interface L { id: string; name: string; is_default: boolean; items: number }

export function Lists() {
  const [lists, setLists] = useState<L[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [items, setItems] = useState<(CompanyCard & { note: string | null })[] | null>(null);
  const [newName, setNewName] = useState('');
  const toast = useToast();
  const { refresh } = useSession();
  const loadLists = useCallback(async () => {
    const r = await apiFetch<{ lists: L[] }>('/api/lists');
    setLists(r.lists);
    setCurrent((c) => c ?? r.lists[0]?.id ?? null);
  }, []);
  useEffect(() => { loadLists().catch((e) => toast(e.message, { error: true })); }, [loadLists, toast]);
  useEffect(() => {
    if (!current) return;
    setItems(null);
    apiFetch<{ items: any[] }>(`/api/lists/${current}`).then((r) => setItems(r.items)).catch((e) => toast(e.message, { error: true }));
  }, [current, toast]);
  const list = lists.find((l) => l.id === current);

  async function remove(companyId: string) {
    await apiFetch(`/api/lists/${current}/items/${companyId}`, { method: 'DELETE' });
    setItems((x) => x?.filter((c) => c.id !== companyId) ?? null);
    loadLists(); refresh();
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try { const r = await apiFetch<{ id: string }>('/api/lists', { body: { name: newName } }); setNewName(''); await loadLists(); setCurrent(r.id); }
    catch (err) { toast((err as Error).message, { error: true }); }
  }
  async function del() {
    if (!list || list.is_default || !confirm(`¿Eliminar la lista «${list.name}»?`)) return;
    await apiFetch(`/api/lists/${list.id}`, { method: 'DELETE' });
    setCurrent(null); loadLists(); refresh();
  }
  async function moveTo(companyId: string, listId: string) {
    await apiFetch(`/api/lists/${listId}/items`, { body: { companyIds: [companyId] } });
    toast('Añadida a la lista'); loadLists();
  }

  return (
    <div className="admin-layout" style={{ paddingTop: 0 }}>
      <nav className="admin-nav" aria-label="Listas">
        {lists.map((l) => <a key={l.id} href="#" className={l.id === current ? 'active' : ''} onClick={(e) => { e.preventDefault(); setCurrent(l.id); }}><span>{l.name}</span><span className="count">{l.items}</span></a>)}
        <form onSubmit={create} className="stack" style={{ marginTop: 12 }}>
          <input className="input" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="Nueva lista…" aria-label="Nombre de la nueva lista" />
          <button className="btn btn-outline btn-sm"><Icon name="plus" /> Crear lista</button>
        </form>
      </nav>
      <section>
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{list?.name ?? '…'}</h2><span className="spacer" />
          {items && items.length > 0 && <>
            <button className="btn btn-outline btn-sm" onClick={() => download('/api/companies', { ids: items.map((c) => c.id), format: 'csv' }).catch((e) => toast(e.message, { error: true }))}><Icon name="download" /> CSV</button>
            <button className="btn btn-outline btn-sm" onClick={() => download('/api/companies', { ids: items.map((c) => c.id), format: 'xlsx' }).catch((e) => toast(e.message, { error: true }))}>Excel</button></>}
          {list && !list.is_default && <button className="btn btn-danger btn-sm" onClick={del}><Icon name="trash" /> Eliminar lista</button>}
        </div>
        {!items ? <div className="loading"><div className="spinner" /></div> : items.length === 0 ? (
          <div className="card empty"><Icon name="heart" /><h3>Lista vacía</h3><p>Pulsa el corazón en cualquier ficha para guardarla en Favoritos.</p><Link className="btn btn-primary" href="/buscar">Buscar empresas</Link></div>
        ) : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Empresa</th><th>País</th><th>Estado</th><th></th></tr></thead><tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/empresa/${c.slug}`}><strong>{c.name}</strong></Link><div className="small muted">{c.type_names.join(', ')}</div></td>
                <td><Flag iso={c.country_code} url={c.flag_url} name={c.country_name} /> {c.city ?? c.country_name}</td>
                <td>{c.record_status === 'detected' ? <span className="badge badge-detected">Detectada</span> : <VerificationBadge level={c.verification_level} />}</td>
                <td><div className="actions">
                  {lists.length > 1 && <select className="input" defaultValue="" aria-label="Añadir a otra lista" onChange={(e) => { if (e.target.value) moveTo(c.id, e.target.value); e.target.value = ''; }}>
                    <option value="">Añadir a…</option>{lists.filter((l) => l.id !== current).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(c.id)}>Quitar</button>
                </div></td>
              </tr>))}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}
