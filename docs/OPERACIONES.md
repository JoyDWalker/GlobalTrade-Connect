# Operaciones: monitorización, copias, recuperación y seguridad

## Disponibilidad: qué se mide

| Capa | Cómo se comprueba | Si falla |
|---|---|---|
| Aplicación | `GET /api/health` (cada 15 min desde GitHub Actions y tras cada despliegue) | El job falla y GitHub avisa por email; revisa los logs de Vercel |
| Base de datos | `/api/health` → `database.ok` y latencia | 503; revisa el estado de Supabase (status.supabase.com) |
| Migraciones | `/api/health` → `migrations.pending` | Estado `degraded`; aplica `npm run db:migrate` |
| Worker | `/api/health` → `worker.failed/stuck/last_ok` y **Admin → Tareas** | Alertas al webhook en fallos definitivos |
| Fuentes externas | **Admin → Fuentes** (último éxito, último error, errores 30 días) | La búsqueda sigue con datos almacenados |
| Servicios de terceros | Paneles de estado de Vercel, Supabase, Resend, Brave | Ninguno garantiza disponibilidad absoluta; consulta sus SLA según el plan |

Para alertas inmediatas define `ALERT_WEBHOOK_URL` (Slack, Discord o Teams). Se envían cuando una tarea falla definitivamente, el worker programado falla o se agota el presupuesto diario de APIs. Puedes añadir un monitor externo (UptimeRobot, Better Stack…) sobre `/api/health`.

## Logs

- Vercel → proyecto → **Logs** (filtra por `level":"error"` o por `requestId`). Cada error de la API devuelve un `requestId` para localizarlo.
- Railway → servicio → **Logs**.
- Los logs son JSON y se redactan automáticamente contraseñas, tokens, claves, cookies, emails y teléfonos.
- Para conservar logs más tiempo, configura un *Log Drain* en Vercel hacia tu proveedor (Better Stack, Datadog, Axiom…).

## Copias de seguridad

1. **Supabase**: el plan Pro incluye copias diarias (con retención según plan) y opcionalmente PITR. El plan gratuito no ofrece copias descargables: no lo uses en producción sin la copia propia.
2. **Copia propia** (`.github/workflows/backup.yml`): `pg_dump` diario del esquema `public`, cifrado con GPG AES-256 y guardado 30 días como artefacto privado del repositorio. Actívalo con la variable `BACKUPS_ENABLED=true` y los secretos `PRODUCTION_DATABASE_URL` y `BACKUP_PASSPHRASE`.
3. Prueba la restauración al menos una vez al trimestre en un proyecto de staging.

### Restaurar una copia propia

```bash
# 1. Descarga el artefacto desde GitHub → Actions → "Copia de seguridad" → ejecución → Artifacts
gpg --decrypt -o backup.dump globaltrade-AAAAMMDDTHHMMSSZ.dump.gpg
# 2. Restaura en una base VACÍA (proyecto nuevo de Supabase o staging), nunca encima de producción:
pg_restore --no-owner --no-privileges --dbname "$DESTINO_DATABASE_URL" backup.dump
# 3. Verifica (npm run db:migrate debe decir "Esquema al día") y apunta DATABASE_URL al nuevo proyecto.
```

Los usuarios de Supabase Auth (`auth.users`) no se incluyen en esta copia: protégelos con las copias de Supabase. Si restauras solo `public` en un proyecto nuevo, los usuarios deberán volver a registrarse y los perfiles se reasociarán por email.

## Reversión de un despliegue

- **Código**: Vercel → Deployments → elige la última versión correcta → **Instant Rollback** (o *Promote to Production*). No requiere recompilar.
- **Base de datos**: las migraciones siguen el patrón *expandir → migrar → contraer*: una migración nueva solo añade columnas/tablas compatibles con la versión anterior, de modo que revertir el código no rompe nada. Las migraciones destructivas se bloquean por defecto y deben ir en un despliegue posterior, cuando ya no se usen las columnas.
- Si una migración dañó datos, restaura la copia de Supabase (PITR o diaria) en un proyecto nuevo y compara antes de sustituir.

## Recuperación ante fallos

| Situación | Acción |
|---|---|
| La web devuelve errores 5xx | Revisa logs por `requestId`; si empezó con un despliegue, Instant Rollback |
| `/api/health` → base de datos caída | Comprueba Supabase (estado, cuota de conexiones, proyecto pausado en el plan gratuito) |
| Tareas atascadas | Se recuperan solas tras `stuck_after_minutes`; en **Admin → Tareas** puedes reintentar o cancelar |
| Una fuente externa falla | El buscador sigue con datos almacenados; desactívala en **Admin → Fuentes** si el error persiste |
| Gasto anómalo en APIs | Baja el presupuesto diario y los límites en **Admin → Ajustes**; desactiva la fuente |
| Abuso/scraping | Reduce los límites por IP en **Admin → Ajustes**; bloquea cuentas en **Admin → Usuarios**; activa el firewall de Vercel |

## Rotación de secretos

Si una clave se expone (o de forma periódica):

| Secreto | Cómo rotarlo |
|---|---|
| Contraseña de la base de datos | Supabase → Database → *Reset database password* → actualiza `DATABASE_URL` en Vercel y `PRODUCTION_DATABASE_URL` en GitHub → redespliega |
| `SUPABASE_SERVICE_ROLE_KEY` / claves API | Supabase → API Keys → crea una nueva / rota el JWT secret → actualiza Vercel → redespliega → revoca la anterior |
| `APP_SECRET` | Genera uno nuevo y redespliega (invalida los formularios abiertos en ese momento) |
| `CRON_SECRET` | Cambia el valor en Vercel y en GitHub a la vez |
| `RESEND_API_KEY`, `SERPER_API_KEY`, `BRAVE_SEARCH_API_KEY`, `GOOGLE_CSE_API_KEY`, `ANTHROPIC_API_KEY` | Crea una clave nueva en el panel del proveedor, actualiza Vercel, redespliega y elimina la antigua |
| `BACKUP_PASSPHRASE` | Cambia el secreto; las copias antiguas siguen necesitando la contraseña anterior (guárdala hasta que caduquen) |

**Si un secreto llegó a subirse a Git**, eliminarlo del último commit no basta: sigue en el historial y en copias/forks. Revócalo inmediatamente en el proveedor y genera uno nuevo; después, si quieres limpiar el historial, usa `git filter-repo` o BFG y fuerza el push (coordínalo con quien tenga clones). El CI incluye una búsqueda básica de patrones de claves.

## Mantenimiento periódico

- Semanal: **Admin → Revisión** (altas, detectadas, duplicados, reportes), **Admin → Solicitudes** (RGPD con plazo de un mes).
- Mensual: revisar costes en **Admin → Fuentes** y en los paneles de los proveedores; actualizar dependencias (`npm outdated`) mediante pull request.
- Trimestral: prueba de restauración; revisión de usuarios administradores y de la política de privacidad.
