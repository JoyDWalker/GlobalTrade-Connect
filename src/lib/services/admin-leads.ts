// Definición común de los listados de leads en el panel (consulta, estados y columnas de exportación).
export const LEAD_KINDS = {
  inquiries: {
    table: 'inquiries', statuses: ['new', 'read', 'answered', 'archived'],
    sql: `SELECT x.*, c.name AS company_name, c.slug AS company_slug FROM inquiries x JOIN companies c ON c.id = x.company_id`,
    columns: [['Fecha', 'created_at'], ['Tipo', 'inquiry_type'], ['Estado', 'status'], ['Empresa destinataria', 'company_name'], ['Nombre', 'sender_name'],
      ['Empresa', 'sender_company'], ['País', 'sender_country'], ['Email', 'email'], ['Teléfono', 'phone'], ['Producto', 'product_interest'],
      ['Volumen', 'estimated_volume'], ['Mensaje', 'message']] as [string, string][],
  },
  'supplier-requests': {
    table: 'supplier_requests', statuses: ['new', 'in_progress', 'closed'],
    sql: `SELECT x.*, ca.name AS category_name, coalesce((SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug))
      FROM companies c WHERE c.id = ANY(x.suggested_company_ids)), '[]') AS suggestions FROM supplier_requests x LEFT JOIN categories ca ON ca.id = x.category_id`,
    columns: [['Fecha', 'created_at'], ['Estado', 'status'], ['Nombre', 'user_name'], ['Empresa', 'company_name'], ['Email', 'email'], ['Teléfono', 'phone'],
      ['Producto', 'product'], ['Categoría', 'category_name'], ['Países de origen', 'origin_countries'], ['Certificaciones', 'certifications'],
      ['Cantidad', 'quantity'], ['Fecha objetivo', 'target_date'], ['Notas', 'notes']] as [string, string][],
  },
  reports: {
    table: 'data_reports', statuses: ['new', 'resolved', 'dismissed'],
    sql: `SELECT x.*, c.name AS company_name, c.slug AS company_slug FROM data_reports x JOIN companies c ON c.id = x.company_id`,
    columns: [['Fecha', 'created_at'], ['Estado', 'status'], ['Empresa', 'company_name'], ['Campo', 'field'], ['Mensaje', 'message'], ['Email', 'reporter_email']] as [string, string][],
  },
  privacy: {
    table: 'privacy_requests', statuses: ['new', 'completed', 'rejected'],
    sql: 'SELECT x.* FROM privacy_requests x',
    columns: [['Fecha', 'created_at'], ['Tipo', 'request_type'], ['Estado', 'status'], ['Nombre', 'name'], ['Email', 'email'], ['Detalles', 'details']] as [string, string][],
  },
} as const;
export type LeadKind = keyof typeof LEAD_KINDS;
export const isLeadKind = (k: string): k is LeadKind => k in LEAD_KINDS;
