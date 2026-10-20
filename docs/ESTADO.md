# Estado del proyecto (20 de octubre de 2026)

> **Producción**: https://global-trade-connect-three.vercel.app (Vercel + Supabase). /api/health: base de datos conectada, 8 migraciones aplicadas. Fuentes externas activas: GLEIF, Wikidata/QLever y OpenStreetMap (gratuitas). Brave Search: pendiente de clave.

Se distingue entre **implementado y probado en local**, **configurado pero no verificado contra el servicio real** y **pendiente**.

## Implementado y probado (en local y en pruebas automatizadas)

- Reescritura en Next.js 16 + TypeScript + PostgreSQL conservando el modelo, diseño, flujos y datos de demostración de la versión 1 (`legacy-v1` en Git).
- Esquema PostgreSQL con 8 migraciones versionadas (checksum, bloqueo, guarda contra migraciones destructivas), RLS en todas las tablas, índices de búsqueda, deduplicación por dominio, NIF y LEI, borrado lógico.
- Búsqueda en lenguaje natural con filtros (sector, país, región, ciudad, tipo, certificación, idioma, cliente, verificación, fuente, capacidad, pedido mínimo), orden, paginación, exportación CSV/Excel de selección o resultados.
- Búsqueda externa en segundo plano con caché, cuotas, presupuesto, límites por usuario/IP, reintentos, timeouts y tolerancia a fallos (probada con fuentes simuladas).
- Fichas con procedencia por fuente y por dato, fechas de recopilación y comprobación, estados detectada/pendiente/contrastada/verificada.
- Contacto y cotización, solicitud de proveedores, reporte de datos, reclamación de fichas, solicitudes de verificación/corrección.
- Registro y edición de empresas por sus titulares con historial de cambios; listas de favoritos privadas.
- Panel de administración: resumen y costes, cola de revisión, empresas (publicar/rechazar/ocultar/verificar/contrastar/destacar/consultar registro/enriquecer), solicitudes y RGPD (exportar y suprimir), usuarios y roles, tareas (manuales y estado), fuentes y cuotas, ajustes, catálogos, auditoría y emails.
- Worker con cola persistente: enriquecimiento web (robots.txt, anti-SSRF), verificación GLEIF, enlaces, datos antiguos, duplicados, candidatos para solicitudes, emails, limpieza; recuperación de tareas interrumpidas.
- Seguridad: autorización en servidor, CSRF por Origin, CSP con nonce, cabeceras, anti-spam, logs redactados, auditoría, validación de entorno.
- Procedimiento seguro de primer administrador (`npm run admin:grant`).
- **67 pruebas automatizadas superadas**, `tsc` sin errores, `next build` correcto, versión de producción probada en local (hidratación con CSP), interfaz revisada en escritorio y móvil.

## En producción

- **URL**: https://global-trade-connect-three.vercel.app (Vercel + Supabase), despliegue automático desde `main`.
- `/api/health`: base de datos conectada y 8 migraciones aplicadas.
- Fuentes gratuitas activas: GLEIF, Wikidata/QLever (importación de empresas), OpenStreetMap y webs oficiales.
- Supabase Auth en uso; el propietario recibe el rol de administrador al iniciar sesión.

## Configurado pero no verificado contra servicios reales

| Elemento | Estado |
|---|---|
| Serper.dev / Brave Search API / Google CSE | Adaptadores probados con respuestas simuladas; sin claves reales |
| Claude (expansión de búsquedas con IA) | Opcional; sin `ANTHROPIC_API_KEY` se usa el catálogo de sectores |
| Resend | Sin clave, los emails se registran (modo `log`) |
| Supabase Storage (logos) | Requiere bucket `logos` y *service role key* |
| GitHub Actions (cron cada 15 min, copias de seguridad) | Workflows escritos; desactivados hasta definir sus secretos |

## Pendiente

1. **`CRON_SECRET`** en Vercel y en GitHub (más `PRODUCTION_URL` y `SCHEDULED_TASKS_ENABLED=true`): sin ella el worker programado está desactivado y la importación solo avanza desde el panel o con el cron diario de Vercel.
2. **`APP_SECRET`** propia (ahora se deriva automáticamente).
3. Copias de seguridad diarias (`PRODUCTION_DATABASE_URL`, `BACKUP_PASSPHRASE`, `BACKUPS_ENABLED=true`).
4. Opcional: Resend con dominio verificado, Serper.dev o Brave Search API, clave de Anthropic, webhook de alertas, dominio propio.

## Costes recurrentes previsibles

Ver docs/ARQUITECTURA.md («Costes previsibles»). Para un uso comercial: Vercel Pro y Supabase Pro (~45 USD/mes) más el consumo de APIs de búsqueda y email.

## Riesgos y cuestiones abiertas

- Google Custom Search JSON API: retirada anunciada para el 1/1/2027; no contar con ella a largo plazo.
- La cobertura mundial depende de fuentes de pago o de acuerdos con registros/directorios; no se garantiza que toda búsqueda devuelva empresas reales.
- Revisión jurídica de los textos legales y de la base jurídica para datos recopilados de fuentes públicas (RGPD art. 6.1.f y 14).
- La base local PGlite es solo para desarrollo.
