# Despliegue en producción

Arquitectura recomendada: **Vercel** (aplicación Next.js y cron diario) + **Supabase** (PostgreSQL, Auth y Storage) + **GitHub** (código, CI, worker cada 15 min, copias de seguridad). Alternativa: **Railway** (sección 8).

> Usa siempre proyectos/bases de datos distintos para **producción** y **preview/staging**. Nunca compartas `DATABASE_URL` ni la *service role key* entre entornos.

## 1. Supabase (base de datos, autenticación y almacenamiento)

1. Crea dos proyectos en https://supabase.com/dashboard: `globaltrade-prod` y `globaltrade-staging` (región UE, p. ej. Frankfurt, por el RGPD). Guarda la contraseña de la base de datos en un gestor de contraseñas.
2. En **Project Settings → API** copia:
   - *Project URL* → `NEXT_PUBLIC_SUPABASE_URL`
   - clave pública *anon* / *publishable* → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - clave *service_role* / *secret* → `SUPABASE_SERVICE_ROLE_KEY` (solo en el servidor)
3. En **Connect** copia la cadena del **Transaction pooler** (puerto 6543) → `DATABASE_URL` para Vercel, y la del **Session pooler** o conexión directa (puerto 5432) → secreto `PRODUCTION_DATABASE_URL` de GitHub para las copias de seguridad.
   Usa `DATABASE_SSL=require`. Para verificar además el certificado, descarga el certificado raíz de Supabase (Settings → Database → SSL) y ponlo en `DATABASE_CA_CERT` con `DATABASE_SSL=verify-full`.
4. **Authentication → URL Configuration**:
   - *Site URL*: `https://TU-APP.vercel.app` (o tu dominio).
   - *Redirect URLs*: `https://TU-APP.vercel.app/auth/callback`, `https://TU-APP.vercel.app/**` y, para previews, `https://*-TU-EQUIPO.vercel.app/**`.
5. **Authentication → Providers → Email**: deja activada la confirmación de email. Para producción configura un SMTP propio (Authentication → Emails → SMTP), porque el servidor de correo integrado de Supabase tiene límites muy bajos.
6. **Storage**: crea un bucket público llamado `logos` (tamaño máximo 400 KB, tipos `image/png, image/jpeg, image/webp`). Las subidas las hace el servidor con la *service role key* tras validar el archivo; no se necesitan políticas de subida para usuarios.
7. Las migraciones se aplican solas en el primer build de producción. También puedes aplicarlas manualmente desde tu equipo:
   ```bash
   DATABASE_URL="postgres://…:5432/postgres" DATABASE_SSL=require APP_SECRET=… npm run db:migrate
   ```
   La migración `0002_security.sql` activa RLS en todas las tablas, revoca permisos a `anon`/`authenticated` (el navegador no puede leer tablas directamente con la clave pública) y crea el trigger que genera el perfil al registrarse.

## 2. GitHub

```bash
git remote add origin https://github.com/TU_USUARIO/globaltrade-connect.git
git push -u origin main
```

- **Settings → Branches**: protege `main` (requerir pull request y el check `CI / test`).
- **Settings → Secrets and variables → Actions**:
  - Secretos: `PRODUCTION_URL` (p. ej. `https://tu-app.vercel.app`), `CRON_SECRET` (el mismo que en Vercel), `PRODUCTION_DATABASE_URL` (puerto 5432), `BACKUP_PASSPHRASE` (contraseña larga; guárdala también fuera de GitHub).
  - Variables: `SCHEDULED_TASKS_ENABLED=true`, `BACKUPS_ENABLED=true` (actívalas cuando producción esté lista).

## 3. Vercel

1. https://vercel.com/new → importa el repositorio. Framework: Next.js (se detecta solo). Región de funciones: `fra1` (definida en `vercel.json`, cerca de Supabase UE).
2. **Settings → Environment Variables**. Define para **Production**:

   | Variable | Valor |
   |---|---|
   | `APP_ENV` | `production` |
   | `NEXT_PUBLIC_SITE_URL` | `https://tu-app.vercel.app` (o el dominio propio) |
   | `DATABASE_URL` | transaction pooler de `globaltrade-prod` |
   | `DATABASE_SSL` | `require` |
   | `DB_POOL_MAX` | `3` |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | de `globaltrade-prod` |
   | `APP_SECRET` | aleatorio de 32+ caracteres |
   | `CRON_SECRET` | aleatorio de 32+ caracteres |
   | `EMAIL_PROVIDER` / `RESEND_API_KEY` / `EMAIL_FROM` / `ADMIN_NOTIFY_EMAIL` | ver sección 5 |
   | `SERPER_API_KEY` | opcional (buscador principal recomendado) |
   | `BRAVE_SEARCH_API_KEY` | opcional |
   | `ANTHROPIC_API_KEY` | opcional (amplía las búsquedas con IA) |
   | `AI_MODEL` | opcional (por defecto `claude-opus-5-5`) |
   | `ALERT_WEBHOOK_URL` | opcional |

   Para **Preview** usa los valores de `globaltrade-staging`, `APP_ENV=preview` y otros `APP_SECRET`/`CRON_SECRET`. En preview el build **no** migra; aplica las migraciones a staging con `MIGRATE_ON_BUILD=true` (variable solo de Preview) o manualmente.
3. Despliega. El build ejecuta `scripts/prebuild.ts`: en producción aplica las migraciones pendientes y los catálogos; si algo falla, el build falla y la versión anterior sigue sirviendo tráfico.
4. **Cron**: `vercel.json` define una ejecución diaria del worker (límite del plan Hobby). Vercel envía `Authorization: Bearer $CRON_SECRET` automáticamente. Las ejecuciones cada 15 minutos las hace GitHub Actions (`.github/workflows/scheduled.yml`).
5. **Deployment Protection**: puedes proteger las *previews* con Vercel Authentication; la verificación posterior al despliegue lo tiene en cuenta.
6. Comprueba: `https://tu-app.vercel.app/api/health` debe devolver `"status":"ok"` y `"pending": []` en migraciones.
7. Crea el primer administrador (README, sección 6).

> **Plan**: el plan Hobby de Vercel es para uso personal/no comercial. Un servicio comercial requiere el plan Pro. Comprueba las condiciones vigentes.

## 4. Flujo de cambios

1. Rama de trabajo → pull request.
2. GitHub Actions ejecuta tipos, pruebas, comprobación de migraciones, build y búsqueda de secretos.
3. Vercel genera una *preview* conectada a staging.
4. Al fusionar en `main`, Vercel despliega a producción (migraciones incluidas).
5. `post-deploy.yml` comprueba `/api/health` y las páginas principales de la nueva versión. Si falla, aplica la reversión (docs/OPERACIONES.md).

## 5. Correo transaccional (Resend)

1. Crea una cuenta en https://resend.com, añade y verifica tu dominio (registros SPF/DKIM en tu DNS).
2. Crea una API key con permiso de envío → `RESEND_API_KEY`.
3. `EMAIL_PROVIDER=resend`, `EMAIL_FROM="GlobalTrade Connect <no-reply@tu-dominio.com>"`, `ADMIN_NOTIFY_EMAIL=tu@email`.
Sin dominio verificado, deja `EMAIL_PROVIDER=log`: los emails se registran en **Admin → Emails** pero no se envían.

## 6. Búsqueda externa

- **GLEIF** y **Wikidata** están activas por defecto (gratuitas, licencia CC0, sin clave). GLEIF busca entidades legales por nombre en todo el mundo; Wikidata, empresas por sector/producto y país (sobre todo empresas conocidas).
- La app también acepta las variables que crea la integración Supabase de Vercel (`POSTGRES_URL`, `SUPABASE_URL`…, con o sin prefijo como `GTC_`).

- **Modo gratuito (sin ninguna clave)**: las empresas se buscan en GLEIF y Wikidata, y sus contactos en **OpenStreetMap** (teléfono, email y web que publican los negocios) y en su propia web, que se deduce por el nombre (p. ej. `kladdkakan.se`) y solo se acepta si la página corresponde a la empresa. Ninguna de estas fuentes tiene coste.
- **Serper.dev** (opcional, de pago): crea una clave en https://serper.dev/ → `SERPER_API_KEY`. Devuelve resultados de Google, de pago por uso; ajusta en **Admin → Fuentes** la cuota diaria y el coste por 1.000 peticiones.
- **IA para ampliar las búsquedas** (Claude): crea una clave en https://console.anthropic.com/ → `ANTHROPIC_API_KEY`. Cada producto nuevo («dulces», «licor»…) se amplía una vez con su sector, términos relacionados y consultas optimizadas; la expansión se guarda en caché 30 días y su coste cuenta en el presupuesto diario (**Admin → Ajustes**). Sin clave, la búsqueda se amplía con el catálogo de sectores. En **Admin → Ajustes** puedes desactivarla y fijar el número de consultas por búsqueda (cada consulta cuesta una petición al buscador).
- **Brave Search API**: crea una clave en https://api-dashboard.search.brave.com/ → `BRAVE_SEARCH_API_KEY`. Es de pago por uso; ajusta en **Admin → Fuentes** la cuota diaria y el coste por 1.000 peticiones, y en **Admin → Ajustes** el presupuesto diario y los límites por usuario.
- **Google Custom Search JSON API**: Google indica que está cerrada a clientes nuevos y que las cuentas existentes deben migrar antes del 1 de enero de 2027. Si ya tienes acceso: `GOOGLE_CSE_API_KEY` y `GOOGLE_CSE_ENGINE_ID`.
- **GLEIF** (registro mundial de entidades legales) no necesita clave.
- Sin claves, la búsqueda funciona con los datos almacenados y el panel indica «sin configurar».

## 7. Dominio propio (opcional)

1. Registra el dominio (p. ej. `globaltradeconnect.com`) en el registrador que prefieras.
2. Vercel → **Settings → Domains** → añade `globaltradeconnect.com` y `www.globaltradeconnect.com`. Vercel indica los registros DNS: normalmente `A @ 76.76.21.21` y `CNAME www cname.vercel-dns.com` (usa los que muestre el panel).
3. Vercel emite y renueva el certificado TLS automáticamente. Elige el dominio principal y redirige el otro (p. ej. `www` → raíz).
4. Actualiza `NEXT_PUBLIC_SITE_URL=https://globaltradeconnect.com` (Production) y redespliega.
5. En Supabase Auth cambia *Site URL* y añade `https://globaltradeconnect.com/auth/callback` a las *Redirect URLs*.
6. Actualiza el secreto `PRODUCTION_URL` de GitHub y, en Resend, verifica el dominio de envío.

## 8. Alternativa: Railway

Útil si prefieres un proceso de larga duración para el worker o tener app y base de datos en un mismo proveedor.

1. https://railway.app → *New Project* → *Deploy from GitHub repo*.
2. Añade **PostgreSQL** al proyecto (o usa Supabase). Railway expone `DATABASE_URL`.
3. Servicio **web**: build `npm run build`, start `npm start`. Variables como en Vercel (`APP_ENV=production`, `DATABASE_SSL=require` si la conexión es pública; para la red privada de Railway, `DATABASE_SSL=disable` solo si la conexión no sale de su red interna), `NEXT_PUBLIC_SITE_URL` con el dominio `*.up.railway.app`.
4. Servicio **worker** (mismo repositorio): start `npm run worker`. Sustituye al cron de GitHub/Vercel (desactiva `SCHEDULED_TASKS_ENABLED`).
5. Copias: activa las copias de Railway para el volumen de PostgreSQL y/o mantén `backup.yml` con `PRODUCTION_DATABASE_URL` apuntando a la conexión pública.
6. Health check del servicio web: ruta `/api/health`.
