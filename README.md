# GlobalTrade Connect

Directorio B2B para buscar **productores, exportadores, importadores y distribuidores** de café, chocolate y aceite, con foco en Brasil, España, Argentina, Colombia, Bélgica y Suiza.

> Todos los datos de ejemplo son **ficticios**: emails y webs con el dominio reservado `.example`, teléfonos con el bloque `000 000`, y etiqueta **DEMO** en cada ficha.

---

## 1. Instalación y ejecución local

Requisitos: **Node.js 22.13 o superior** (usa el módulo SQLite integrado `node:sqlite`). No hay dependencias que instalar.

```bash
cp .env.example .env      # opcional: sin .env se usan los valores de .env.example
npm start                 # http://localhost:3000
```

En el primer arranque se crean la base de datos (`data/globaltrade.db`), el esquema y los datos de ejemplo (24 empresas, 2 de ellas pendientes de revisión).

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el servidor |
| `npm run dev` | Arranca con recarga automática al editar el servidor |
| `npm run db:migrate` | Aplica migraciones pendientes de `db/migrations/` |
| `npm run db:seed` | Carga datos de ejemplo (solo si la base está vacía) |
| `npm run db:reset` | Borra la base de datos y los logos subidos, y vuelve a sembrar |

**Cuentas de prueba**: el seed crea un administrador y un usuario de empresa con los emails y contraseñas definidos en `.env.example` (`ADMIN_*` y `COMPANY_DEMO_*`). Cámbialos en `.env` y ejecuta `npm run db:reset`.

---

## 2. Funcionalidades

**Público (visitante)**
- Portada con buscador, accesos rápidos (Café, Chocolate, Aceite, Exportadores, Importadores, Distribuidores), países, categorías, empresas destacadas y últimas añadidas.
- Buscador avanzado con texto libre (sin tildes, en nombre, descripción, productos, códigos SA, ciudad…) y filtros combinables: categoría, subcategoría, país, región, ciudad, tipo de empresa, certificaciones (todas las elegidas), idiomas, capacidad de exportación mínima, pedido mínimo máximo, tipo de cliente y verificación.
- Resultados con contador, filtros activos visibles, 5 ordenaciones, paginación, selección múltiple y exportación a **CSV o Excel** (seleccionadas o todo el resultado).
- Ficha completa: datos comerciales, productos con código arancelario, certificaciones, mercados, condiciones, contactos (solo si la empresa autoriza mostrarlos), redes y empresas similares.
- Botones: Contactar, Solicitar cotización, Guardar en favoritos, Copiar email, Compartir ficha, Reportar datos incorrectos.
- Favoritos sin cuenta (en el navegador) que se sincronizan al iniciar sesión.
- Formularios de contacto, «Solicitar proveedores», alta de empresa y derechos RGPD.

**Empresa registrada**: ver estado de su ficha, editarla, gestionar las solicitudes recibidas, guardar leads.

**Administrador** (`#/admin`):
- Resumen con estadísticas por país, categoría, tipo y mes.
- Empresas: crear, editar, eliminar, aprobar, rechazar (con motivo, se notifica por email), verificar y destacar.
- Duplicados por nombre normalizado, email, dominio web e identificación fiscal.
- Solicitudes de contacto, de proveedores, reportes de datos y peticiones RGPD con estados. La supresión RGPD anonimiza los datos asociados a un email.
- Catálogos editables: categorías, subcategorías, productos, países, certificaciones, idiomas, tipos de empresa y de cliente. **Añadir un país o una categoría no requiere tocar código.**
- Exportaciones a CSV/Excel de empresas, leads de contacto y solicitudes de proveedores.
- Bandeja de emails: en local los emails no se envían, se registran aquí.

---

## 3. Estructura de archivos

```
├── package.json
├── .env.example                 Configuración y credenciales de prueba
├── db/
│   ├── migrations/001_init.sql  Esquema relacional completo
│   ├── seed-data.js             Catálogos y 24 empresas ficticias
│   ├── seed.js                  Carga de datos de ejemplo
│   └── cli.js                   migrate | seed | reset
├── server/
│   ├── index.js                 Servidor HTTP, CSRF, estáticos y SPA
│   ├── http.js                  Router, JSON, ficheros, cabeceras de seguridad
│   ├── config.js  db.js         Configuración, conexión y migraciones
│   ├── auth.js                  Contraseñas (scrypt), sesiones en BD, roles
│   ├── spam.js                  Honeypot, token con marca de tiempo, límite por IP
│   ├── companies.js             Validación, guardado, búsqueda, fichas y exportación
│   ├── export.js                CSV y Excel (.xlsx) sin dependencias
│   ├── mailer.js                Notificaciones (bandeja de salida)
│   ├── util.js                  Validador y utilidades
│   └── routes/
│       ├── public.js            API pública, cuenta, favoritos, formularios
│       └── admin.js             API de administración
├── public/
│   ├── index.html
│   ├── css/styles.css
│   ├── img/                     Favicon y banderas
│   └── js/
│       ├── app.js               Router (hash) y cabecera
│       ├── lib.js               Plantillas con escape, API, estado, UI
│       └── views/               home, search, company, register, pages, account, admin
├── data/                        Base de datos SQLite (se crea al arrancar)
└── uploads/logos/               Logos subidos
```

---

## 4. Base de datos

Tablas principales (ver `db/migrations/001_init.sql`):

| Tabla | Contenido |
|---|---|
| `companies` | Ficha de empresa (todos los campos pedidos + región, cobertura, NIF, estado de publicación, destacada, redes, condiciones, índice de búsqueda) |
| `categories` | Árbol de categorías con `parent_id` (café › café verde…) |
| `products` | Productos por subcategoría con `hs_code` opcional |
| `countries` | Países con ISO, bandera y marca de prioritario |
| `certifications`, `languages`, `business_types`, `client_types` | Catálogos |
| `company_categories`, `company_products`, `company_certifications`, `company_languages`, `company_business_types`, `company_client_types`, `company_markets` | Relaciones N:M (los mercados distinguen exportación/importación) |
| `contacts` | Personas de contacto con `consent_public` |
| `inquiries` | Mensajes y solicitudes de cotización a empresas |
| `supplier_requests` | Solicitudes de búsqueda de proveedores |
| `users`, `sessions`, `favorites` | Cuentas (roles `company` y `admin`), sesiones y leads guardados |
| `data_reports`, `privacy_requests`, `mail_outbox` | Reportes, peticiones RGPD y emails |

Para cambios de esquema, añade `db/migrations/002_lo-que-sea.sql`; se aplica solo al arrancar o con `npm run db:migrate`.

---

## 5. API

Todas las rutas devuelven JSON. Las peticiones que modifican datos exigen `Content-Type: application/json` y la cabecera `X-Requested-With: fetch` (protección CSRF junto a la cookie `SameSite=Lax`).

**Pública**

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/meta` | Catálogos para filtros y formularios |
| GET | `/api/home` | Destacadas, últimas y totales |
| GET | `/api/companies?q=&category=&subcategory=&country=&region=&city=&type=&cert=&lang=&client=&verification=&minCapacity=&maxMinOrder=&sort=&page=&pageSize=` | Búsqueda (listas separadas por comas). `&format=csv\|xlsx` exporta |
| POST | `/api/companies/export` | `{ ids, format }` → CSV/Excel de las seleccionadas |
| GET | `/api/companies/:slug` | Ficha y empresas similares |
| POST | `/api/companies/:slug/inquiries` | Contacto o cotización (notifica a la empresa) |
| POST | `/api/companies/:slug/reports` | Reportar datos incorrectos |
| POST | `/api/supplier-requests` | Solicitar proveedores (notifica al admin) |
| POST | `/api/register` | Alta de empresa (+ cuenta opcional), queda pendiente de revisión |
| POST | `/api/privacy-requests` | Derechos RGPD |
| GET | `/api/form-token` | Token anti-spam para formularios |
| POST | `/api/auth/login` · `/api/auth/logout` · GET `/api/auth/me` | Sesión |
| GET/POST/DELETE | `/api/favorites[/:id]` | Favoritos |
| GET | `/api/account` · PUT `/api/account/company` · PUT `/api/account/inquiries/:id` | Área de empresa |

**Administración** (rol `admin`): `/api/admin/stats`, `/api/admin/companies[/:id]` (GET, POST, PUT, DELETE), `/api/admin/companies/:id/status`, `/api/admin/duplicates`, `/api/admin/inquiries`, `/api/admin/supplier-requests`, `/api/admin/reports`, `/api/admin/privacy-requests[/:id/execute]`, `/api/admin/outbox`, `/api/admin/taxonomy/:tipo[/:id]` y `/api/admin/export/:companies|inquiries|supplier-requests?format=csv|xlsx`.

---

## 6. Seguridad, spam y RGPD

- Contraseñas con scrypt y sal; sesiones aleatorias guardadas como hash; cookie `HttpOnly` + `SameSite=Lax` (+ `Secure` si `BASE_URL` es https).
- Validación en servidor de todos los formularios y en cliente para la experiencia de uso.
- Anti-spam: campo trampa oculto, token firmado con tiempo mínimo de 3 s, límite de envíos por IP y por formulario, máximo de enlaces por mensaje.
- Cabeceras CSP, `X-Frame-Options`, `nosniff`; escape automático de todo el HTML generado; solo se enlazan URLs `http(s)`; CSV protegido frente a inyección de fórmulas.
- RGPD: casillas de consentimiento no premarcadas, aviso de privacidad, publicación de datos de contacto solo con autorización, NIF nunca público, formulario de acceso/rectificación/supresión y ejecución de la supresión desde el panel.
- Pendiente para producción: textos legales definitivos con tu asesor, CAPTCHA (Turnstile/hCaptcha) si llega spam real, recuperación de contraseña y verificación de email.

---

## 7. Stack recomendado para crecer

Esta versión prioriza que funcione con un solo comando (Node + SQLite, sin dependencias). La arquitectura (esquema relacional, API REST, catálogos configurables) se traslada sin cambios conceptuales. Para producción y crecimiento recomiendo:

| Capa | Recomendación | Por qué |
|---|---|---|
| Frontend + BFF | **Next.js (App Router) + TypeScript + Tailwind** | SSR/SSG para SEO de las fichas (clave en un directorio), rutas por país/categoría indexables |
| Backend | Route handlers de Next.js o **NestJS** si la API crece o la consumen terceros | Tipado de punta a punta, validación con Zod |
| Base de datos | **PostgreSQL** (Neon, Supabase o RDS) con **Prisma** o Drizzle | El esquema SQL actual se traduce casi literalmente; migraciones versionadas |
| Búsqueda | Postgres `unaccent` + `pg_trgm` al principio; **Meilisearch/Typesense** a partir de miles de fichas | Tolerancia a errores, facetas con contadores, sinónimos (AOVE ↔ aceite de oliva virgen extra) |
| Autenticación | **Auth.js** o Clerk/Supabase Auth | Verificación de email, recuperación de contraseña, SSO |
| Emails | **Resend**, Postmark o Amazon SES | Sustituye `deliver()` en `server/mailer.js` |
| Ficheros | S3 / Cloudflare R2 para logos y catálogos PDF | |
| Anti-spam | Cloudflare Turnstile | Sin fricción para el usuario |
| Multi-idioma | `next-intl` (ES/EN/PT/FR/DE/NL) | El público es internacional |
| Despliegue | Vercel + Postgres gestionado, o Docker en Railway/Render/Fly.io | |

Siguientes funcionalidades naturales: planes de pago para empresas (Stripe), fichas con catálogos de producto y fichas técnicas, mensajería interna, alertas de nuevas empresas por filtro guardado e importación masiva por CSV desde el panel.
