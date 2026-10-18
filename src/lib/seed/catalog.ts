// Catálogos iniciales. Son un punto de partida ampliable desde el panel de administración:
// la búsqueda NO depende de ellos (acepta texto libre, keywords y productos/servicios abiertos).

const CONTINENTS: Record<string, string> = {
  'Europa': 'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  'Asia': 'AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
  'África': 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  'América del Norte y Central': 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  'América del Sur': 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  'Oceanía': 'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS',
};
const PRIORITY = ['BR', 'ES', 'AR', 'CO', 'BE', 'CH'];
const LOCAL_FLAGS = new Set(PRIORITY);

export function countries() {
  const names = new Intl.DisplayNames(['es'], { type: 'region' });
  const out: { iso_code: string; name: string; continent: string; flag_url: string | null; is_priority: boolean; sort_order: number }[] = [];
  for (const [continent, codes] of Object.entries(CONTINENTS)) {
    for (const iso of codes.split(' ')) {
      const p = PRIORITY.indexOf(iso);
      out.push({
        iso_code: iso, name: (iso === 'XK' ? 'Kosovo' : names.of(iso)) ?? iso, continent,
        flag_url: LOCAL_FLAGS.has(iso) ? `/img/flags/${iso.toLowerCase()}.svg` : null,
        is_priority: p >= 0, sort_order: p >= 0 ? p + 1 : 100,
      });
    }
  }
  return out;
}

type Cat = { name: string; slug: string; children?: Cat[] };

// Sectores de alto nivel + subsectores. Cualquier otro sector cabe como keyword o producto libre.
export const categories: Cat[] = [
  { name: 'Alimentación y bebidas', slug: 'alimentacion', children: [
    { name: 'Café', slug: 'cafe', children: [
      { name: 'Café verde', slug: 'cafe-verde' }, { name: 'Café tostado', slug: 'cafe-tostado' },
      { name: 'Café de especialidad', slug: 'cafe-especialidad' }, { name: 'Café soluble', slug: 'cafe-soluble' },
      { name: 'Cápsulas y monodosis', slug: 'capsulas' }, { name: 'Accesorios de café', slug: 'accesorios-cafe' }] },
    { name: 'Chocolate y cacao', slug: 'chocolate', children: [
      { name: 'Cacao', slug: 'cacao' }, { name: 'Chocolate industrial', slug: 'chocolate-industrial' },
      { name: 'Chocolate artesanal', slug: 'chocolate-artesanal' }, { name: 'Chocolate negro', slug: 'chocolate-negro' },
      { name: 'Coberturas', slug: 'coberturas' }, { name: 'Bombonería', slug: 'bomboneria' }, { name: 'Derivados del cacao', slug: 'derivados-cacao' }] },
    { name: 'Aceites', slug: 'aceite', children: [
      { name: 'Aceite de oliva virgen extra (AOVE)', slug: 'aove' }, { name: 'Aceite de girasol', slug: 'aceite-girasol' },
      { name: 'Aceites gourmet', slug: 'aceites-gourmet' }, { name: 'Aceite de argán', slug: 'aceite-argan' },
      { name: 'Otros aceites alimentarios', slug: 'otros-aceites' }] },
    { name: 'Frutas y verduras', slug: 'frutas-verduras' }, { name: 'Cereales y legumbres', slug: 'cereales-legumbres' },
    { name: 'Cárnicos', slug: 'carnicos' }, { name: 'Pescados y mariscos', slug: 'pescados-mariscos' },
    { name: 'Lácteos', slug: 'lacteos' }, { name: 'Vinos y bebidas alcohólicas', slug: 'vinos-bebidas' },
    { name: 'Bebidas sin alcohol', slug: 'bebidas-sin-alcohol' }, { name: 'Ingredientes y aditivos', slug: 'ingredientes' },
  ] },
  { name: 'Agricultura y materias primas', slug: 'agricultura-materias-primas', children: [
    { name: 'Commodities agrícolas', slug: 'commodities-agricolas' }, { name: 'Fertilizantes y fitosanitarios', slug: 'fertilizantes' },
    { name: 'Madera y forestal', slug: 'madera' }, { name: 'Metales y minerales', slug: 'metales-minerales' }] },
  { name: 'Química y plásticos', slug: 'quimica', children: [
    { name: 'Productos químicos industriales', slug: 'quimicos-industriales' }, { name: 'Plásticos y polímeros', slug: 'plasticos' },
    { name: 'Cosmética e higiene', slug: 'cosmetica' }, { name: 'Farmacia y salud', slug: 'farmacia' }] },
  { name: 'Maquinaria e industria', slug: 'maquinaria', children: [
    { name: 'Maquinaria industrial', slug: 'maquinaria-industrial' }, { name: 'Maquinaria agrícola', slug: 'maquinaria-agricola' },
    { name: 'Maquinaria alimentaria', slug: 'maquinaria-alimentaria' }, { name: 'Herramientas y repuestos', slug: 'herramientas' },
    { name: 'Automoción y componentes', slug: 'automocion' }] },
  { name: 'Electrónica y energía', slug: 'electronica-energia', children: [
    { name: 'Componentes electrónicos', slug: 'componentes-electronicos' }, { name: 'Electrónica de consumo', slug: 'electronica-consumo' },
    { name: 'Energía solar y renovables', slug: 'renovables' }, { name: 'Material eléctrico', slug: 'material-electrico' }] },
  { name: 'Textil y moda', slug: 'textil', children: [
    { name: 'Tejidos e hilados', slug: 'tejidos' }, { name: 'Confección y prendas', slug: 'confeccion' }, { name: 'Calzado y marroquinería', slug: 'calzado' }] },
  { name: 'Envases y embalaje', slug: 'envases-embalaje' },
  { name: 'Construcción y materiales', slug: 'construccion' },
  { name: 'Hogar y mobiliario', slug: 'hogar-mobiliario' },
  { name: 'Logística y transporte', slug: 'logistica', children: [
    { name: 'Transporte marítimo y transitarios', slug: 'transitarios' }, { name: 'Transporte por carretera', slug: 'transporte-carretera' },
    { name: 'Almacenaje', slug: 'almacenaje' }, { name: 'Agentes de aduanas', slug: 'aduanas' }] },
  { name: 'Software y tecnología', slug: 'software', children: [
    { name: 'Software empresarial', slug: 'software-empresarial' }, { name: 'Comercio electrónico', slug: 'ecommerce' }, { name: 'Servicios TI', slug: 'servicios-ti' }] },
  { name: 'Servicios profesionales', slug: 'servicios-profesionales', children: [
    { name: 'Consultoría de comercio exterior', slug: 'consultoria-comex' }, { name: 'Certificación e inspección', slug: 'certificacion-inspeccion' },
    { name: 'Servicios legales y financieros', slug: 'legal-financiero' }, { name: 'Marketing y traducción', slug: 'marketing-traduccion' }] },
];

export const businessTypes: [string, string][] = [
  ['productor', 'Productor'], ['fabricante', 'Fabricante'], ['oem', 'Fabricante OEM/ODM'], ['marca-blanca', 'Marca blanca / private label'],
  ['exportador', 'Exportador'], ['importador', 'Importador'], ['distribuidor', 'Distribuidor'], ['mayorista', 'Mayorista'],
  ['minorista', 'Minorista'], ['cooperativa', 'Cooperativa'], ['tostador', 'Tostador'], ['almazara', 'Bodega / almazara'],
  ['trading', 'Trading / broker'], ['logistica', 'Logística y transporte'], ['servicios', 'Prestador de servicios'], ['software', 'Software / tecnología'],
];

export const certifications: [string, string][] = [
  ['organico', 'Orgánico'], ['ecologico', 'Ecológico (UE)'], ['comercio-justo', 'Comercio justo'], ['rainforest-alliance', 'Rainforest Alliance'],
  ['utz', 'UTZ'], ['kosher', 'Kosher'], ['halal', 'Halal'], ['brc', 'BRCGS'], ['ifs', 'IFS Food'], ['iso', 'ISO 22000 / 9001'],
  ['iso-14001', 'ISO 14001'], ['denominacion-origen', 'Denominación de Origen'], ['ce', 'Marcado CE'], ['fda', 'Registro FDA'],
  ['gmp', 'GMP'], ['fsc', 'FSC'], ['oeko-tex', 'OEKO-TEX'], ['aeo', 'Operador Económico Autorizado (OEA/AEO)'],
];

export const languages: [string, string][] = [
  ['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['fr', 'Francés'], ['de', 'Alemán'], ['nl', 'Neerlandés'],
  ['it', 'Italiano'], ['zh', 'Chino'], ['ar', 'Árabe'], ['ru', 'Ruso'], ['ja', 'Japonés'], ['hi', 'Hindi'], ['tr', 'Turco'],
];

export const clientTypes: [string, string][] = [
  ['horeca', 'HORECA'], ['retail', 'Retail'], ['supermercados', 'Supermercados'], ['mayoristas', 'Mayoristas'],
  ['marcas-privadas', 'Marcas privadas'], ['industria', 'Industria'], ['administracion', 'Administración pública'], ['ecommerce', 'E-commerce'],
];

// Fuentes. Los costes/cuotas son estimaciones a revisar en el panel de cada proveedor.
export const sources = [
  { key: 'self_registered', name: 'Registro por la propia empresa', kind: 'self_registered', reliability: 70, cost: 0, quota: null,
    notes: 'Datos declarados por la empresa. Se revisan antes de publicar.' },
  { key: 'manual', name: 'Alta manual del equipo', kind: 'manual', reliability: 80, cost: 0, quota: null, notes: 'Introducidos por un administrador.' },
  { key: 'seed_demo', name: 'Datos de demostración', kind: 'manual', reliability: 0, cost: 0, quota: null, notes: 'Ficticios. Solo entornos de desarrollo.' },
  { key: 'google_cse', name: 'Google Custom Search JSON API', kind: 'search_api', reliability: 40, cost: 5, quota: 100,
    base_url: 'https://www.googleapis.com/customsearch/v1', terms_url: 'https://developers.google.com/custom-search/v1/overview',
    notes: 'Cerrada a nuevos clientes; Google anuncia su retirada el 1 de enero de 2027. 100 consultas/día gratis, 5 USD/1.000 adicionales (máx. 10.000/día) para clientes existentes.' },
  { key: 'brave', name: 'Brave Search API', kind: 'search_api', reliability: 40, cost: 5, quota: 30,
    base_url: 'https://api.search.brave.com/res/v1/web/search', terms_url: 'https://api-dashboard.search.brave.com/',
    notes: 'De pago por uso (aprox. 5 USD/1.000 consultas, con un crédito mensual). Verifica precio y condiciones actuales en su panel.' },
  { key: 'gleif', name: 'GLEIF – Registro mundial LEI', kind: 'registry', reliability: 90, cost: 0, quota: 2000,
    base_url: 'https://api.gleif.org/api/v1', terms_url: 'https://www.gleif.org/en/meta/terms-of-use', licence: 'CC0 1.0',
    notes: 'Datos abiertos (CC0) de entidades legales con código LEI. Cobertura limitada a entidades con LEI.' },
  { key: 'website', name: 'Sitio web oficial de la empresa', kind: 'website', reliability: 60, cost: 0, quota: 1000,
    notes: 'Metadatos públicos (título, descripción, JSON-LD Organization). Respeta robots.txt.' },
] as const;

export const defaultSettings: [string, unknown, string][] = [
  ['external_search', { enabled: true, min_internal_results: 6, max_results_per_source: 10, cache_hours: 72, timeout_ms: 8000 },
    'Búsqueda en fuentes externas desde el buscador'],
  ['limits', { searches_per_hour_anon: 30, searches_per_hour_user: 120, external_per_day_anon: 5, external_per_day_user: 30, daily_budget_usd: 2 },
    'Límites de consumo por usuario/IP y presupuesto diario de APIs'],
  ['worker', { batch_size: 10, time_budget_ms: 45000, stale_after_days: 90, link_check_after_days: 30, stuck_after_minutes: 15 },
    'Parámetros del worker'],
  ['discovery_queries', [] as string[], 'Consultas que el worker usa para descubrir empresas nuevas (p. ej. "exportadores de café Colombia")'],
];
