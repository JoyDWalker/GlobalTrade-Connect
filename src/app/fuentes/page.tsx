import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getDb, many } from '@/lib/db';

export const metadata: Metadata = { title: 'Fuentes de datos y verificación' };

const KIND: Record<string, string> = { search_api: 'API de búsqueda', registry: 'Registro oficial / datos abiertos', website: 'Sitio web de la empresa', directory: 'Directorio', manual: 'Equipo', self_registered: 'La propia empresa' };

export default async function Page() {
  await connection();
  const sources = await many(getDb(), "SELECT name, kind, terms_url, licence, notes, enabled FROM sources WHERE key <> 'seed_demo' ORDER BY reliability DESC");
  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="page-head"><h1>Fuentes de datos y verificación</h1>
        <p className="muted">Qué información mostramos, de dónde procede y qué significa cada estado.</p></div>
      <article className="card card-pad prose">
        <h2>Fuentes</h2>
        <ul>{sources.map((s) => <li key={s.name}><strong>{s.name}</strong> ({KIND[s.kind] ?? s.kind}){!s.enabled && ' · desactivada'}. {s.notes}{s.licence ? ` Licencia: ${s.licence}.` : ''}{s.terms_url && <> <a href={s.terms_url} target="_blank" rel="noopener noreferrer">Condiciones</a>.</>}</li>)}</ul>
        <p>Usamos APIs oficiales cuando existen y respetamos sus condiciones, cuotas y el archivo robots.txt de cada web. No eludimos sistemas de acceso, CAPTCHA ni restricciones técnicas. La cobertura depende de la disponibilidad de cada fuente: no todas las búsquedas devuelven resultados en todos los sectores y países.</p>
        <p>Cada ficha muestra sus fuentes, la fecha en que se recopiló cada dato y su última comprobación (sección «Procedencia y verificación»).</p>
        <h2 id="verificacion">Estados de una empresa</h2>
        <dl className="kv">
          <dt>Detectada · sin revisar</dt><dd>Encontrada automáticamente en una fuente pública. Nadie ha confirmado sus datos.</dd>
          <dt>Pendiente de revisión</dt><dd>Enviada por la empresa o con cambios que el equipo aún no ha revisado. No es pública.</dd>
          <dt>Publicada · sin verificar</dt><dd>Revisada por el equipo para su publicación, sin comprobación de identidad legal.</dd>
          <dt>Información contrastada</dt><dd>El nombre legal y el país coinciden en al menos dos fuentes independientes (por ejemplo, la propia empresa y el registro mundial GLEIF de entidades legales).</dd>
          <dt>Verificada</dt><dd>Un administrador ha completado el procedimiento: (1) la entidad consta en un registro oficial o mercantil, (2) el dominio web o el email corporativo pertenece a la empresa (p. ej. respuesta desde un email del dominio), y (3) se ha comprobado un medio de contacto. El método aplicado se indica en la ficha.</dd>
        </dl>
        <p>Que una empresa tenga web o aparezca en una fuente pública no demuestra por sí solo que esté legalmente registrada o siga activa. Las certificaciones las declara la empresa: pide siempre el certificado vigente.</p>
        <h2>Datos personales</h2>
        <p>Priorizamos datos empresariales. La recopilación automática solo guarda buzones corporativos genéricos. Puedes pedir que se oculten o eliminen tus datos desde la <a href="/privacidad#derechos">página de privacidad</a>.</p>
      </article>
    </div>
  );
}
