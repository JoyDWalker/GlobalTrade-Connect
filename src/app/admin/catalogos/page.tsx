'use client';
import { useState } from 'react';
import { apiFetch, useToast } from '@/components/client';
import { Icon } from '@/components/icons';
import { Loading, useAdmin } from '../hooks';

const TYPES: [string, string][] = [['categories', 'Sectores y categorías'], ['countries', 'Países'], ['certifications', 'Certificaciones'], ['languages', 'Idiomas'], ['business-types', 'Tipos de actividad'], ['client-types', 'Tipos de cliente']];
const LABEL: Record<string, string> = { name: 'Nombre', slug: 'Slug', parent_id: 'Padre', sort_order: 'Orden', is_active: 'Activa', iso_code: 'ISO', continent: 'Continente', flag_url: 'Bandera (URL)', is_priority: 'Prioritario', code: 'Código' };

export default function Page() {
  const [type, setType] = useState('categories');
  const { data, error, reload } = useAdmin<any>(`/api/admin/taxonomy/${type}`);
  const toast = useToast();
  const values = (tr: HTMLElement) => Object.fromEntries([...tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name]')].map((el) => [el.name, el.type === 'checkbox' ? (el as HTMLInputElement).checked : el.value]));
  const call = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg); reload(); } catch (e: any) { toast(e.details ? Object.values(e.details).join(' · ') : e.message, { error: true }); }
  };
  const cell = (f: string, v: any, isNew: boolean, pk: string) => {
    if (f === 'parent_id') return <select className="input" name={f} defaultValue={v ?? ''}><option value="">— Raíz —</option>{data.items.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
    if (f === 'is_priority' || f === 'is_active') return <input type="checkbox" name={f} defaultChecked={isNew ? f === 'is_active' : Boolean(v)} />;
    return <input className="input" name={f} defaultValue={v ?? (f === 'sort_order' ? 100 : '')} readOnly={!isNew && f === pk} type={f === 'sort_order' ? 'number' : 'text'} />;
  };
  return (
    <>
      <h1>Catálogos</h1>
      <p className="muted">Amplía sectores, países o certificaciones sin tocar el código. Las empresas también pueden usar palabras clave y productos libres, así que no es necesario crear una categoría para cada nicho. Los elementos en uso no se pueden borrar.</p>
      <div className="tabs">{TYPES.map(([k, l]) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>)}</div>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap"><table className="table"><thead><tr>{data.fields.map((f: string) => <th key={f}>{LABEL[f] ?? f}</th>)}<th /></tr></thead><tbody>
          <tr>{data.fields.map((f: string) => <td key={f}>{cell(f, null, true, data.pk)}</td>)}
            <td><button className="btn btn-primary btn-sm" onClick={(e) => call(() => apiFetch(`/api/admin/taxonomy/${type}`, { body: values(e.currentTarget.closest('tr')!) }), 'Añadido')}><Icon name="plus" /> Añadir</button></td></tr>
          {data.items.map((it: any) => (
            <tr key={it[data.pk]}>{data.fields.map((f: string) => <td key={f}>{cell(f, it[f], false, data.pk)}</td>)}
              <td><div className="actions">
                <button className="btn btn-outline btn-sm" onClick={(e) => call(() => apiFetch(`/api/admin/taxonomy/${type}/${encodeURIComponent(it[data.pk])}`, { method: 'PUT', body: values(e.currentTarget.closest('tr')!) }), 'Guardado')}>Guardar</button>
                <button className="btn btn-danger btn-sm" aria-label="Eliminar" onClick={() => confirm('¿Eliminar?') && call(() => apiFetch(`/api/admin/taxonomy/${type}/${encodeURIComponent(it[data.pk])}`, { method: 'DELETE' }), 'Eliminado')}><Icon name="trash" /></button>
              </div></td></tr>))}
        </tbody></table></div>
      )}
    </>
  );
}
