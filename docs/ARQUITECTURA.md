# Arquitectura

## Decisión de stack

La versión 1 (Node.js sin dependencias + SQLite, etiqueta Git `legacy-v1`) se reescribió en **Next.js 16 (App Router) + TypeScript + PostgreSQL/Supabase** por decisión del propietario, para cumplir los requisitos de producción: base de datos persistente (SQLite en disco local no persiste en Vercel), autenticación gestionada, despliegues automáticos y escalado. Se conservaron el modelo de datos, el diseño (CSS), los flujos (búsqueda, ficha, contacto, registro, administración, RGPD), la exportación CSV/Excel sin dependencias y los datos de demostración.

| Pieza | Elección | Motivo |
|---|---|---|
| Web y API | Next.js 16 App Router, TypeScript | SSR para SEO de fichas; rutas `/api` en el mismo despliegue |
| Datos | PostgreSQL (Supabase) con `pg`, SQL parametrizado | Migraciones SQL versionadas legibles; sin ORM pesado |
| Auth | Supabase Auth (`@supabase/ssr`) | Contraseñas, confirmación de email y recuperación gestionadas |
| Almacenamiento | Supabase Storage (logos) | Mismo proveedor; subida validada en el servidor |
| Cola de tareas | Tabla `jobs` + `FOR UPDATE SKIP LOCKED` | Persistente y concurrente sin Redis (menos coste/servicios) |
| Programación | GitHub Actions (15 min) + Vercel Cron (diario) | Vercel Hobby solo permite 1 cron diario |
| Límites de uso | Tabla `rate_limits` | Funciona en serverless sin Redis |
| Email | Resend (vía API HTTP) o modo `log` | Sin SDK adicional |
| Pruebas | Vitest + PGlite (PostgreSQL embebido) | PostgreSQL real sin Docker, también en CI |

Dependencias de producción: `next`, `react`, `react-dom`, `@supabase/ssr`, `@supabase/supabase-js`, `pg`, `zod`, `server-only`.

## Componentes

```
Navegador ──HTTPS──▶ Vercel (Next.js)
                      ├─ Páginas SSR (búsqueda, fichas, cuenta, admin)
                      ├─ /api/*  (validación zod, permisos en servidor, CSRF por Origin, límites)
                      ├─ /api/search/external  → adaptadores (Brave, Google CSE) con caché, cuotas y presupuesto
                      └─ /api/cron/worker  ◀── GitHub Actions (15 min) / Vercel Cron (diario)
                              │                     └─ worker: web oficial (robots.txt), GLEIF, enlaces, duplicados, emails
                              ▼
                      Supabase: PostgreSQL (RLS activado, acceso solo desde el servidor) · Auth · Storage
```

## Modelo de datos (resumen)

- **Empresas**: `companies` (con `domain`, `tax_id_normalized` y `lei` únicos para deduplicar; `record_status` y `verification_level`; borrado lógico `deleted_at`), `offerings` (productos y servicios libres), `company_categories` (árbol abierto de sectores), `keywords` (texto libre), certificaciones, idiomas, tipos de cliente, mercados, `company_contacts` (con `is_personal`, `consent_public`, `hidden`), `company_members` (titulares).
- **Procedencia**: `sources` (fiabilidad, cuota, coste, licencia), `company_sources` (dónde se vio cada empresa), `data_provenance` (origen de cada dato), `company_changes` (historial), `verification_events`.
- **Búsqueda**: `searches`, `search_results`, `search_cache`, `external_requests` (estado, duración, coste estimado).
- **Usuarios**: `profiles` (rol solo modificable por el servidor), `lists`/`list_items`.
- **Leads**: `inquiries`, `supplier_requests` (con candidatos sugeridos por el worker), `data_reports`, `privacy_requests`.
- **Operación**: `review_tasks` (cola de revisión), `jobs`, `audit_log`, `rate_limits`, `email_outbox`, `app_settings`.

Integridad: los leads usan `ON DELETE RESTRICT` (una empresa con solicitudes no se puede borrar físicamente; se usa borrado lógico); los catálogos usan `RESTRICT` (no se borra un sector en uso); las tablas de relación usan `CASCADE`.

## Motor de búsqueda

1. Validación y normalización (`zod`, minúsculas sin tildes).
2. Interpretación de la consulta: se eliminan palabras vacías, se detectan países («en México» → `MX`) y tipos de empresa («fabricantes» → `fabricante`), y se obtienen raíces de los términos.
3. Búsqueda interna con filtros combinables; los términos se comparan con `search_text` (nombre, descripción, sectores, productos, códigos SA, keywords, certificaciones, ciudad, país) y se exige ~60 % de coincidencia en consultas largas. Orden por relevancia, verificación y estado.
4. Si hay menos resultados que el umbral configurado, la página lanza **en segundo plano** la búsqueda externa: caché (72 h por defecto) → límite diario por usuario/IP → presupuesto diario → cuota de cada fuente → llamada con timeout y reintentos con espera exponencial → normalización (un resultado por dominio, sin marketplaces ni redes sociales) → deduplicación por dominio/identificador externo → alta como **detectada** con procedencia → tarea de revisión y de enriquecimiento.
5. Cada llamada externa queda registrada (estado, HTTP, duración, resultados, coste). Un fallo de una fuente nunca bloquea la página: se muestran los datos almacenados y el estado de cada fuente.

## Fuentes de datos

| Fuente | Tipo | Acceso | Coste aproximado* | Notas |
|---|---|---|---|---|
| Empresa (registro propio) | Declarado | — | 0 | Revisión antes de publicar |
| Brave Search API | Buscador | Clave API | ~5 USD / 1.000 consultas, con crédito mensual | Verificar precio vigente |
| Google Custom Search JSON API | Buscador | Clave + CX | 100/día gratis; 5 USD / 1.000 (máx. 10.000/día) | Cerrada a clientes nuevos; retirada anunciada el 1/1/2027 |
| GLEIF | Registro oficial (LEI) | Abierta | 0 (CC0) | Solo entidades con LEI |
| Web oficial | Metadatos | robots.txt | 0 (tiempo de función) | Solo títulos, descripción, JSON-LD y buzones genéricos |

\* Precios orientativos consultados en octubre de 2026; confírmalos en cada proveedor. Otras fuentes (registros mercantiles nacionales, OpenCorporates, Companies House…) se añaden implementando un adaptador en `src/lib/sources/adapters.ts` y una fila en `sources`.

## Seguridad

- Autorización en el servidor en todas las rutas (`requireUser`, `requireAdmin`, `requireCompanyAccess`); la interfaz solo oculta.
- El rol vive en `profiles.role`, que nunca se toma de los metadatos del usuario; el trigger de alta siempre crea `user`.
- RLS activado en todas las tablas y permisos revocados a `anon`/`authenticated`: la clave pública de Supabase no da acceso a datos.
- SQL siempre parametrizado; nombres de tabla solo desde listas blancas.
- CSRF: comprobación de `Origin` en mutaciones + cookies `SameSite=Lax`.
- CSP con *nonce* por petición, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Anti-spam: campo trampa + token firmado con tiempo mínimo + límites por IP/usuario en PostgreSQL.
- SSRF: el rastreador solo descarga URLs http(s) públicas (resolución DNS y bloqueo de rangos privados, puertos 80/443, ≤ 3 redirecciones validadas, tamaño máximo).
- Subida de logos: tipo real por firma binaria, ≤ 400 KB.
- Logs sin secretos ni datos personales; errores al cliente sin detalles internos (con `requestId`).
- Auditoría de altas, cambios, verificaciones, roles, exportaciones, ajustes, tareas manuales y RGPD.

## RGPD: medidas implementadas y pendientes de revisión jurídica

Implementado: política de privacidad y cookies (solo cookies técnicas de sesión), página de fuentes y verificación, consentimientos no premarcados, publicación de contactos personales solo con autorización, recopilación automática limitada a buzones corporativos genéricos, IP anonimizada (hash) y eliminada a los 30 días, retención de búsquedas 180 días, formulario de acceso/rectificación/supresión/oposición, exportación de datos de una persona y supresión con anonimización desde el panel, reporte de datos incorrectos, ocultación de contactos.

Requiere revisión profesional: identidad del responsable y DPD, base jurídica del interés legítimo para datos empresariales recopilados de fuentes públicas (incluida la evaluación de ponderación), información a los interesados cuyos datos no se obtienen directamente (art. 14), contratos de encargo con los proveedores, transferencias internacionales y plazos de conservación definitivos.

## Costes previsibles (orientativos, octubre 2026)

| Servicio | Arranque | Producción comercial |
|---|---|---|
| Vercel | Hobby gratis (uso no comercial) | Pro ~20 USD/usuario/mes |
| Supabase | Free (sin copias, pausa por inactividad) | Pro ~25 USD/mes (copias diarias) |
| Resend | Gratis con límites diarios/mensuales | ~20 USD/mes según volumen |
| Brave Search API | Crédito mensual | ~5 USD por cada 1.000 búsquedas externas |
| GitHub Actions | Minutos gratuitos incluidos | Según uso (worker cada 15 min ≈ 3.000 ejecuciones/mes de pocos segundos) |
| Dominio | — | ~10-20 USD/año |

El presupuesto diario de APIs (por defecto 2 USD) y los límites por usuario se ajustan en **Admin → Ajustes**; el gasto estimado se ve en **Admin → Resumen** y **Admin → Fuentes**.
