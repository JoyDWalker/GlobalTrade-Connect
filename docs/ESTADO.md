# Estado del proyecto (19 de octubre de 2026)

> **Producción**: https://global-trade-connect-three.vercel.app (Vercel + Supabase). /api/health: base de datos conectada, 2 migraciones aplicadas. Fuentes externas activas: GLEIF y Wikidata (gratuitas). Brave Search: pendiente de clave.

Se distingue entre **implementado y probado en local**, **configurado pero no verificado contra el servicio real** y **pendiente**.

## Webs, emails y teléfonos de empresas detectadas (19/10/2026)

- Problema observado en producción: las empresas que llegan desde GLEIF (la mayoría) no traen web, así que no había ninguna web que visitar para sacar email y teléfono. Las de Wikidata sí (p. ej. Ybarra: web y teléfono).
- Nueva tarea `discover_website`: para cada empresa sin web busca su web oficial en este orden: Wikidata por código LEI (gratis) → dominios probables construidos con el nombre (`nombre.es`, `nombre.com`…, gratis) → Brave Search si hay `BRAVE_SEARCH_API_KEY` (≈1 consulta por empresa, respeta el presupuesto diario). Una web solo se acepta si su contenido menciona a la empresa (y se descartan dominios aparcados); después se leen portada y página de contacto para guardar email y teléfono con su procedencia.
- Se lanza al guardar resultados externos, tras cada búsqueda (también para empresas ya guardadas sin web), al abrir una ficha sin contacto y cada hora en lote (`discover_missing`, requiere el cron activo). Cada empresa se intenta una vez (`website_discovered_at`, migración 0004).
- Las fichas sin contacto muestran el aviso «Estamos buscando…» y un enlace para buscarla en la web.
- Ajustes: Admin → Ajustes → «Búsqueda de webs y contactos».
- Cobertura esperable: sin Brave, solo empresas cuyo dominio coincide con su nombre o que están en Wikidata; con Brave la cobertura sube mucho.

## Implementado y probado (en local y en pruebas automatizadas)

- Reescritura en Next.js 16 + TypeScript + PostgreSQL conservando el modelo, diseño, flujos y datos de demostración de la versión 1 (`legacy-v1` en Git).
- Esquema PostgreSQL con 2 migraciones versionadas (checksum, bloqueo, guarda contra migraciones destructivas), RLS en todas las tablas, índices de búsqueda, deduplicación por dominio, NIF y LEI, borrado lógico.
- Búsqueda en lenguaje natural con filtros (sector, país, región, ciudad, tipo, certificación, idioma, cliente, verificación, fuente, capacidad, pedido mínimo), orden, paginación, exportación CSV/Excel de selección o resultados.
- Búsqueda externa en segundo plano con caché, cuotas, presupuesto, límites por usuario/IP, reintentos, timeouts y tolerancia a fallos (probada con fuentes simuladas).
- Fichas con procedencia por fuente y por dato, fechas de recopilación y comprobación, estados detectada/pendiente/contrastada/verificada.
- Contacto y cotización, solicitud de proveedores, reporte de datos, reclamación de fichas, solicitudes de verificación/corrección.
- Registro y edición de empresas por sus titulares con historial de cambios; listas de favoritos privadas.
- Panel de administración: resumen y costes, cola de revisión, empresas (publicar/rechazar/ocultar/verificar/contrastar/destacar/consultar registro/enriquecer), solicitudes y RGPD (exportar y suprimir), usuarios y roles, tareas (manuales y estado), fuentes y cuotas, ajustes, catálogos, auditoría y emails.
- Worker con cola persistente: enriquecimiento web (robots.txt, anti-SSRF), verificación GLEIF, enlaces, datos antiguos, duplicados, candidatos para solicitudes, emails, limpieza; recuperación de tareas interrumpidas.
- Seguridad: autorización en servidor, CSRF por Origin, CSP con nonce, cabeceras, anti-spam, logs redactados, auditoría, validación de entorno.
- Procedimiento seguro de primer administrador (`npm run admin:grant`).
- **39 pruebas automatizadas superadas**, `tsc` sin errores, `next build` correcto, versión de producción probada en local (hidratación con CSP), interfaz revisada en escritorio y móvil.

## Configurado pero no verificado contra servicios reales

| Elemento | Estado |
|---|---|
| Supabase Auth (registro, login, recuperación, callback) | Código listo; sin proyecto Supabase todavía no se ha probado de extremo a extremo |
| Supabase Storage (logos) | Código listo; requiere bucket `logos` y *service role key* |
| Brave Search API / Google CSE | Adaptadores listos y probados con respuestas simuladas; sin claves reales |
| GLEIF y descarga de webs reales | Implementado; probado con datos simulados (las pruebas no usan red) |
| Resend | Implementado; sin clave, los emails se registran (modo `log`) |
| Vercel (build, cron, funciones) | `vercel.json` y migración en build preparados; no desplegado |
| GitHub Actions (CI, cron 15 min, copias, verificación post-despliegue) | Workflows escritos; no ejecutados (no hay repositorio remoto todavía) |

## Estado de producción

- **URL pública**: no hay todavía. Falta crear las cuentas/proyectos de Supabase y Vercel y el repositorio de GitHub.
- **Base de datos de producción, migraciones, despliegue automático, tareas programadas, copias y monitorización**: preparados, **no activos**.
- **Dominio propio**: no registrado ni conectado (procedimiento en docs/DESPLIEGUE.md §7).

## Pendiente para publicar

1. Repositorio en GitHub (privado recomendado) y `git push`.
2. Proyectos Supabase de producción y staging; bucket `logos`; URLs de Auth.
3. Proyecto en Vercel con las variables de entorno de Production y Preview.
4. Secretos y variables de GitHub Actions.
5. Registro del primer administrador y `npm run admin:grant`.
6. Opcional: Resend con dominio verificado, Brave Search API, webhook de alertas, dominio propio.

## Costes recurrentes previsibles

Ver docs/ARQUITECTURA.md («Costes previsibles»). Para un uso comercial: Vercel Pro y Supabase Pro (~45 USD/mes) más el consumo de APIs de búsqueda y email.

## Riesgos y cuestiones abiertas

- Google Custom Search JSON API: retirada anunciada para el 1/1/2027; no contar con ella a largo plazo.
- La cobertura mundial depende de fuentes de pago o de acuerdos con registros/directorios; no se garantiza que toda búsqueda devuelva empresas reales.
- Revisión jurídica de los textos legales y de la base jurídica para datos recopilados de fuentes públicas (RGPD art. 6.1.f y 14).
- La base local PGlite es solo para desarrollo.
