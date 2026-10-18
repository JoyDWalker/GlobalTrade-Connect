# GlobalTrade Connect

Plataforma B2B internacional para encontrar empresas, proveedores, fabricantes, importadores, exportadores, distribuidores y prestadores de servicios de cualquier sector y país.

- **Búsqueda universal** en lenguaje natural («fabricantes de envases compostables en México») sobre la base de datos propia, con filtros combinables y, cuando hay pocos resultados, consulta en segundo plano a **fuentes externas autorizadas** (Brave Search API, Google Custom Search para cuentas existentes) sin bloquear la interfaz.
- **Fichas con procedencia**: cada dato indica su fuente, fecha de recopilación, última comprobación y estado (*detectada*, *pendiente de revisión*, *contrastada*, *verificada*).
- **Worker** con cola persistente en PostgreSQL: enriquecimiento desde la web oficial (respetando robots.txt), verificación en el registro mundial **GLEIF**, comprobación de enlaces, detección de duplicados, preparación de solicitudes y envío de emails.
- Cuentas con **Supabase Auth**, roles (visitante, usuario, empresa, administrador) comprobados en el servidor, listas de favoritos, exportación CSV/Excel, panel de administración, auditoría y herramientas RGPD.

| Documento | Contenido |
|---|---|
| [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) | Supabase, Vercel, GitHub, variables, dominio propio, alternativa Railway |
| [docs/OPERACIONES.md](docs/OPERACIONES.md) | Logs, monitorización, copias de seguridad, restauración, reversión, rotación de secretos |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Arquitectura, modelo de datos, motor de búsqueda, fuentes, seguridad, RGPD y costes |
| [docs/ESTADO.md](docs/ESTADO.md) | Informe del estado real del proyecto |

---

## 1. Requisitos

- Node.js **22.12 o superior** y npm.
- Git.
- Para producción: cuentas en **GitHub**, **Supabase** y **Vercel** (o Railway). Opcional: Resend (email), Brave Search API.

No hace falta Docker: para desarrollo local se incluye un PostgreSQL embebido (PGlite).

## 2. Instalación local

```bash
git clone https://github.com/TU_USUARIO/globaltrade-connect.git
cd globaltrade-connect
npm install
cp .env.example .env.local
```

Edita `.env.local` y rellena al menos `APP_SECRET` (32+ caracteres aleatorios):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Base de datos local (sin Docker)

En una terminal deja corriendo PostgreSQL embebido (datos en `./.pglite`):

```bash
npm run db:local
```

En otra terminal aplica las migraciones y carga los catálogos y las empresas de demostración (ficticias):

```bash
npm run db:migrate
npm run db:seed -- --demo
npm run dev
```

Abre http://localhost:3000. También puedes apuntar `DATABASE_URL` a cualquier PostgreSQL 15+ (por ejemplo, una base de desarrollo en Supabase con `DATABASE_SSL=require`).

### Acceso en local

- **Con Supabase** (recomendado): rellena `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` de un proyecto de desarrollo, regístrate en `/registro` y concédete el rol de administrador (sección 6).
- **Sin Supabase**: `DEV_FAKE_AUTH_EMAIL=tu@email` hace que la app actúe como ese usuario (debe existir en la tabla `profiles`). Solo funciona con `APP_ENV=development` y sin Supabase configurado; en cualquier otro caso se ignora.

## 3. Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Compilación y servidor de producción (el build aplica migraciones solo en producción) |
| `npm test` | Pruebas automatizadas (PostgreSQL embebido, sin red) |
| `npm run typecheck` | Comprobación de tipos |
| `npm run db:local` | PostgreSQL local embebido en el puerto 54329 |
| `npm run db:migrate [-- --dry-run]` | Aplica (o lista) migraciones pendientes |
| `npm run db:seed [-- --demo]` | Catálogos; con `--demo`, 24 empresas ficticias (bloqueado en producción) |
| `npm run admin:grant -- email [--revoke]` | Concede o retira el rol de administrador |
| `npm run worker [-- --once]` | Worker independiente (Railway/VPS) |
| `npm run check:env` | Valida la configuración sin mostrar secretos |

## 4. Variables de entorno

Todas están en [.env.example](.env.example) con su descripción. Resumen:

| Variable | Obligatoria | Uso |
|---|---|---|
| `APP_ENV` | sí (Vercel la deduce) | `development`, `preview` o `production` |
| `NEXT_PUBLIC_SITE_URL` | sí | URL pública canónica (enlaces en emails, sitemap, redirecciones de Auth) |
| `DATABASE_URL` | sí | Cadena de conexión PostgreSQL. En Vercel + Supabase: *transaction pooler* (puerto 6543) |
| `DATABASE_SSL` | sí en prod. | `require` o `verify-full` (con `DATABASE_CA_CERT`). `disable` solo en local |
| `DB_POOL_MAX` | no | Conexiones por instancia (3-5 en serverless) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sí en prod. | Supabase Auth (clave pública) |
| `SUPABASE_SERVICE_ROLE_KEY` | recomendada | Solo servidor: logos (Storage) y borrado de cuentas (RGPD) |
| `BRAVE_SEARCH_API_KEY` | no | Búsqueda externa (de pago) |
| `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_ENGINE_ID` | no | Solo cuentas existentes; Google anuncia su retirada el 1/1/2027 |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFY_EMAIL` | recomendadas | Correo transaccional |
| `APP_SECRET` | sí | Firma de formularios y anonimización de IPs |
| `CRON_SECRET` | sí en prod. | Protege `/api/cron/worker` |
| `ALERT_WEBHOOK_URL` | no | Alertas a Slack/Discord/Teams |
| `LOG_LEVEL` | no | Nivel de logs |

La app valida la configuración al arrancar y se niega a funcionar en producción sin las variables críticas o con la base de datos sin cifrar. Ninguna clave privada usa el prefijo `NEXT_PUBLIC_`.

## 5. Base de datos y migraciones

- Esquema en [db/migrations](db/migrations): `0001_core.sql` (tablas, índices, restricciones) y `0002_security.sql` (RLS en todas las tablas, revocación de permisos a `anon`/`authenticated`, trigger de perfiles de Supabase Auth, índices de trigramas).
- Cada migración se aplica una sola vez, en una transacción, con *checksum* (editar una ya aplicada es un error) y bloqueo para evitar ejecuciones simultáneas.
- Las migraciones con `DROP`, `TRUNCATE`, `DELETE FROM` o `ALTER … DROP` se bloquean salvo que el archivo se llame `NNNN_nombre.destructive.sql` **y** se ejecute con `ALLOW_DESTRUCTIVE_MIGRATIONS=true`.
- Para cambios nuevos crea `db/migrations/0003_descripcion.sql`. Usa la estrategia *expandir → migrar → contraer* para que la versión anterior siga funcionando durante el despliegue.

## 6. Primer administrador (procedimiento seguro)

No existe ninguna contraseña administrativa en el código ni forma de autopromocionarse desde la web.

1. La persona se registra en `/registro` y confirma su email.
2. Desde un equipo de confianza con la `DATABASE_URL` del entorno correspondiente (por ejemplo en `.env.local` temporal):
   ```bash
   npm run admin:grant -- persona@empresa.com
   ```
3. La acción queda en la auditoría. Para retirar el rol: `npm run admin:grant -- persona@empresa.com --revoke`. Después, los administradores pueden gestionar roles desde **Admin → Usuarios** (nunca el suyo propio).

## 7. Pruebas

```bash
npm test
```

Las pruebas usan PostgreSQL real embebido (PGlite) y fuentes externas simuladas: esquema y RLS, búsqueda en lenguaje natural, búsqueda externa (éxito, fallo, caché, cuotas, límites por usuario), cola de tareas (duplicados, reintentos, recuperación), deduplicación, borrado lógico, exportación CSV/Excel, validación, permisos de administración, aislamiento de listas entre usuarios, CSRF, secreto del cron, RGPD, robots.txt, SSRF, redacción de logs y validación del entorno de producción.

## 8. Despliegue

Resumen (detalle en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md)):

1. Crea un proyecto en Supabase (región UE) y copia la URL, la clave pública, la *service role key* y la cadena del *transaction pooler*.
2. Sube el repositorio a GitHub.
3. Importa el repositorio en Vercel, define las variables de entorno de **Production** y **Preview** (bases de datos distintas) y despliega. El build de producción aplica las migraciones; si fallan, el despliegue se cancela y sigue activa la versión anterior.
4. Configura Auth en Supabase (URL del sitio y redirecciones `/auth/callback`).
5. Crea el primer administrador (sección 6).
6. Activa las tareas programadas y las copias de seguridad en GitHub (secretos `PRODUCTION_URL`, `CRON_SECRET`, `PRODUCTION_DATABASE_URL`, `BACKUP_PASSPHRASE` y variables `SCHEDULED_TASKS_ENABLED=true`, `BACKUPS_ENABLED=true`).

Flujo de trabajo: ramas → pull request (CI + *preview* de Vercel) → `main` → producción → comprobación automática de `/api/health`.

## 9. Tareas automáticas, logs y copias de seguridad

- **Worker**: `/api/cron/worker` se ejecuta cada 15 minutos (GitHub Actions) y una vez al día (Vercel Cron). Cada ejecución dura como máximo ~50 s y procesa la cola por lotes; las tareas interrumpidas se recuperan solas. También se puede lanzar desde **Admin → Tareas**.
- **Logs**: JSON estructurado en la consola (Vercel → *Logs*), sin contraseñas, tokens, emails ni teléfonos.
- **Salud**: `GET /api/health` (base de datos, migraciones y worker).
- **Copias**: diarias, cifradas, con 30 días de retención (además de las propias de Supabase según el plan). Restauración en [docs/OPERACIONES.md](docs/OPERACIONES.md).

## 10. Limitaciones conocidas

- La cobertura de la búsqueda depende de las fuentes configuradas, sus permisos, cuotas y costes. Sin claves de búsqueda externa, la plataforma funciona solo con su base de datos propia.
- Google Custom Search JSON API está cerrada a clientes nuevos y Google anuncia su retirada el 1 de enero de 2027; el adaptador se mantiene para cuentas existentes y Brave Search es la alternativa integrada.
- Los textos legales son una base que debe revisar un profesional; los mecanismos RGPD implementados no equivalen por sí solos al cumplimiento normativo.
