# Estado del proyecto (18 de octubre de 2026)

Se distingue entre **implementado y probado en local**, **configurado pero no verificado contra el servicio real** y **pendiente**.

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
