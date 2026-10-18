import Link from 'next/link';
import type { Metadata } from 'next';
import { PrivacyForm } from './privacy-form';

export const metadata: Metadata = { title: 'Privacidad y cookies' };

export default function Page() {
  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="page-head"><h1>Política de privacidad y cookies</h1>
        <p className="muted">Texto base que describe el funcionamiento real del servicio. Debe completarlo y revisarlo un profesional jurídico antes de operar comercialmente (datos del responsable, DPD, transferencias internacionales).</p></div>
      <div className="profile-layout" style={{ marginTop: 0 }}>
        <article className="card card-pad prose">
          <h2>1. Responsable</h2>
          <p>[Razón social, NIF, domicilio y email de contacto del titular. Pendiente de completar por el propietario del servicio.]</p>
          <h2>2. Qué datos tratamos y por qué</h2>
          <ul>
            <li><strong>Datos empresariales</strong> (nombre, actividad, web, dirección comercial, email y teléfono corporativos): para mostrar el directorio. Proceden de la propia empresa o de fuentes públicas que se citan en cada ficha (<Link href="/fuentes">ver fuentes</Link>). Base: interés legítimo en facilitar relaciones comerciales B2B (art. 6.1.f RGPD) o consentimiento de la empresa.</li>
            <li><strong>Contactos personales</strong> de empresas: solo se publican con autorización expresa. Los recopilados automáticamente se limitan a buzones corporativos genéricos (info@, ventas@…).</li>
            <li><strong>Solicitudes de contacto, cotización y proveedores</strong>: para hacerlas llegar a la empresa destinataria o al equipo. Base: tu consentimiento y la aplicación de medidas precontractuales.</li>
            <li><strong>Cuenta de usuario</strong>: email y nombre; la contraseña la gestiona nuestro proveedor de autenticación y nunca la conocemos.</li>
            <li><strong>Datos técnicos</strong>: dirección IP convertida en un código irreversible (hash) para limitar abusos; se elimina a los 30 días.</li>
          </ul>
          <h2>3. Destinatarios y encargados</h2>
          <p>Las solicitudes solo se comunican a la empresa destinataria. Proveedores que tratan datos por nuestra cuenta: alojamiento web (Vercel), base de datos y autenticación (Supabase), envío de email (Resend) y, si se activan, APIs de búsqueda. Algunos pueden implicar transferencias internacionales amparadas por cláusulas contractuales tipo o marcos de adecuación. [Revisar con asesoría.]</p>
          <h2>4. Conservación</h2>
          <ul>
            <li>Fichas de empresa: mientras estén activas; las eliminadas se ocultan y pueden purgarse a petición.</li>
            <li>Solicitudes de contacto y proveedores: hasta 24 meses.</li>
            <li>Registros de búsqueda: 180 días (sin IP a partir de 30 días).</li>
            <li>Registros de auditoría de seguridad: 24 meses.</li>
          </ul>
          <h2 id="derechos">5. Tus derechos</h2>
          <p>Puedes solicitar acceso, rectificación, supresión, oposición, limitación y portabilidad con el formulario de esta página. Si eres una persona que aparece como contacto en una ficha, puedes pedir que se oculten tus datos. Responderemos en el plazo de un mes. También puedes reclamar ante la autoridad de control (en España, la AEPD).</p>
          <h2>6. Datos incorrectos</h2>
          <p>Cada ficha tiene un enlace «Reportar datos incorrectos». Revisamos los reportes y corregimos u ocultamos la información.</p>
          <h2 id="cookies">7. Cookies</h2>
          <p>Solo usamos cookies técnicas necesarias para mantener la sesión cuando inicias sesión (cookies de Supabase Auth). No usamos cookies de analítica ni de publicidad, por lo que no se solicita consentimiento de cookies. Si en el futuro se añaden, se pedirá consentimiento previo.</p>
          <h2>8. Seguridad</h2>
          <p>Conexiones cifradas (HTTPS/TLS), control de acceso por roles en el servidor, registro de acciones sensibles y copias de seguridad cifradas.</p>
        </article>
        <aside><div className="card card-pad" id="formulario"><h2>Ejercer mis derechos</h2><PrivacyForm /></div></aside>
      </div>
    </div>
  );
}
