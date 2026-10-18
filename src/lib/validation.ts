// Esquemas de validación compartidos por la API y las pruebas.
import { z } from 'zod';
import { safeUrl } from './text';

const str = (max: number) => z.string().trim().max(max);
const optStr = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optUrl = z.string().trim().max(300).optional().nullable().transform((v, ctx) => {
  if (!v) return null;
  const u = safeUrl(v);
  if (!u) { ctx.addIssue({ code: 'custom', message: 'URL no válida' }); return z.NEVER; }
  return u;
});
const email = z.string().trim().toLowerCase().max(254).email('Email no válido');
const optEmail = z.string().trim().toLowerCase().max(254).optional().nullable()
  .transform((v) => v || null).pipe(z.string().email('Email no válido').nullable());
const phone = z.string().trim().max(40).regex(/^[+()\d\s.-]{6,40}$/, 'Teléfono no válido');
const optPhone = z.string().trim().max(40).optional().nullable().transform((v) => v || null)
  .pipe(phone.nullable());
const optNum = (max: number) => z.union([z.number(), z.string()]).optional().nullable().transform((v, ctx) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) { ctx.addIssue({ code: 'custom', message: 'Número no válido' }); return z.NEVER; }
  return n;
});
const slugList = (max = 50) => z.array(z.string().trim().max(60).regex(/^[a-z0-9-]+$/)).max(max).default([]);
const isoList = z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).max(250).default([]);
const freeTags = z.array(z.string().trim().min(1).max(60)).max(40).default([]);
const accepted = (msg: string) => z.literal(true, { error: msg });

export const contactSchema = z.object({
  full_name: optStr(120),
  job_title: optStr(120),
  email: optEmail,
  phone: optPhone,
  whatsapp: optPhone,
  languages: z.array(z.string().regex(/^[a-z]{2}$/)).max(15).default([]),
  is_primary: z.boolean().default(false),
  is_personal: z.boolean().default(true),
  consent_public: z.boolean().default(false),
}).refine((c) => c.email || c.phone, { message: 'Indica al menos un email o teléfono', path: ['email'] });

export const companyInputSchema = z.object({
  name: str(150).min(2, 'El nombre es obligatorio'),
  legal_name: optStr(200),
  description: optStr(4000),
  main_activity: optStr(200),
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Selecciona un país'),
  region: optStr(100),
  city: optStr(100),
  address: optStr(200),
  postal_code: optStr(20),
  coverage_area: optStr(300),
  website: optUrl,
  email: optEmail,
  phone: optPhone,
  company_types: slugList(15).refine((a) => a.length > 0, 'Indica al menos un tipo de actividad'),
  keywords: freeTags,
  year_founded: optNum(new Date().getFullYear()).refine((v) => v == null || v >= 1500, 'Año no válido'),
  employees_range: optStr(30),
  export_capacity_tons: optNum(1e9),
  production_capacity: optStr(200),
  minimum_order_kg: optNum(1e9),
  minimum_order_notes: optStr(200),
  commercial_terms: optStr(1500),
  social: z.object({ linkedin: optUrl, instagram: optUrl, facebook: optUrl, other: optUrl }).partial().default({}),
  tax_id: optStr(40),
  lei: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{20}$/, 'El LEI tiene 20 caracteres').optional().nullable().or(z.literal('')).transform((v) => v || null),
  categories: z.array(z.coerce.number().int().positive()).max(30).default([]),
  offerings: z.array(z.object({
    kind: z.enum(['product', 'service']).default('product'),
    name: str(150).min(1),
    description: optStr(500),
    hs_code: z.string().trim().max(12).regex(/^[\d.]*$/, 'Código SA no válido').optional().nullable().transform((v) => v || null),
  })).max(100).default([]),
  certifications: slugList(),
  languages: z.array(z.string().regex(/^[a-z]{2}$/)).max(20).default([]),
  client_types: slugList(),
  export_markets: isoList,
  import_markets: isoList,
  contacts: z.array(contactSchema).max(10).default([]),
}).refine((c) => c.categories.length > 0 || c.keywords.length > 0 || c.offerings.length > 0,
  { message: 'Indica al menos un sector, un producto/servicio o una palabra clave', path: ['categories'] });

export type CompanyInput = z.infer<typeof companyInputSchema>;

export const adminCompanyExtras = z.object({
  record_status: z.enum(['detected', 'pending_review', 'published', 'hidden', 'rejected']).optional(),
  verification_level: z.enum(['none', 'contrasted', 'verified']).optional(),
  verification_method: optStr(300),
  is_featured: z.boolean().optional(),
  rejection_reason: optStr(500),
});

export const registerCompanySchema = z.object({
  company: companyInputSchema,
  consent_privacy: accepted('Debes aceptar la política de privacidad'),
  consent_authority: accepted('Debes confirmar que representas a la empresa'),
});

export const inquirySchema = z.object({
  inquiry_type: z.enum(['contact', 'quote']).default('contact'),
  sender_name: str(120).min(2, 'Tu nombre es obligatorio'),
  sender_company: optStr(150),
  sender_country: str(80).min(2, 'Indica tu país'),
  email,
  phone: optPhone,
  product_interest: optStr(200),
  estimated_volume: optStr(120),
  message: str(3000).min(20, 'El mensaje debe tener al menos 20 caracteres'),
  consent_privacy: accepted('Debes aceptar la política de privacidad'),
});

export const supplierRequestSchema = z.object({
  user_name: str(120).min(2, 'Tu nombre es obligatorio'),
  email,
  company_name: optStr(150),
  phone: optPhone,
  product: str(200).min(3, 'Describe el producto o servicio'),
  category_id: z.coerce.number().int().positive().optional().nullable().catch(null),
  origin_countries: isoList,
  certifications: slugList(),
  quantity: str(120).min(1, 'Indica la cantidad'),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')).transform((v) => v || null),
  notes: optStr(3000),
  consent_privacy: accepted('Debes aceptar la política de privacidad'),
});

export const dataReportSchema = z.object({
  field: optStr(80),
  reporter_email: optEmail,
  message: str(2000).min(10, 'Describe el problema'),
});

export const privacyRequestSchema = z.object({
  name: str(120).min(2, 'El nombre es obligatorio'),
  email,
  request_type: z.enum(['deletion', 'access', 'rectification', 'objection']),
  details: optStr(2000),
});

export const searchParamsSchema = z.object({
  q: z.string().trim().max(200).default(''),
  category: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).default(''),
  country: isoList,
  region: z.string().trim().max(100).default(''),
  city: z.string().trim().max(100).default(''),
  type: slugList(20),
  cert: slugList(20),
  lang: z.array(z.string().regex(/^[a-z]{2}$/)).max(20).default([]),
  client: slugList(20),
  verification: z.array(z.enum(['none', 'contrasted', 'verified'])).default([]),
  status: z.array(z.enum(['detected', 'pending_review', 'published', 'hidden', 'rejected'])).default([]),
  source: slugList(10).transform((a) => a.map((s) => s.replace(/-/g, '_'))),
  minCapacity: optNum(1e9),
  maxMinOrder: optNum(1e9),
  featured: z.boolean().default(false),
  includeDetected: z.boolean().default(true),
  sort: z.enum(['relevance', 'name', 'country', 'newest', 'verified']).default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});
export type SearchParams = z.infer<typeof searchParamsSchema>;

/** Convierte URLSearchParams (listas separadas por comas) en un objeto validable. */
export function searchParamsFromUrl(sp: URLSearchParams | Record<string, string | string[] | undefined>) {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return Array.isArray(v) ? v.join(',') : v ?? '';
  };
  const list = (k: string) => get(k).split(',').map((s) => s.trim()).filter(Boolean);
  return searchParamsSchema.parse({
    q: get('q'), category: get('category'), country: list('country'), region: get('region'), city: get('city'),
    type: list('type'), cert: list('cert'), lang: list('lang'), client: list('client'),
    verification: list('verification').filter((v) => ['none', 'contrasted', 'verified'].includes(v)),
    status: list('status').filter((v) => ['detected', 'pending_review', 'published', 'hidden', 'rejected'].includes(v)),
    source: list('source'), minCapacity: get('minCapacity') || null, maxMinOrder: get('maxMinOrder') || null,
    featured: get('featured') === '1', includeDetected: get('detected') !== '0',
    sort: ['relevance', 'name', 'country', 'newest', 'verified'].includes(get('sort')) ? get('sort') : 'relevance',
    page: get('page') || 1, pageSize: get('pageSize') || 12,
  });
}

/** Errores de zod → {campo: mensaje} para mostrarlos junto a cada campo del formulario. */
export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const k = i.path.join('.') || '_';
    out[k] ??= i.message;
  }
  return out;
}
