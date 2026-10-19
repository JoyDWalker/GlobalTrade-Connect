// Interpretación de consultas en lenguaje natural:
// "busco exportadores de café verde en Colombia" → términos [cafe, verde], tipos [exportador], países [CO]
import { normalize } from '../text';

const STOPWORDS = new Set((
  'a al algo alguien algun alguna algunas alguno algunos ante con contra de del desde donde durante e el ella ellos en entre ' +
  'es esta este esto hacia hasta la las le lo los mas me mi mis muy necesito necesitamos busco buscamos buscar buscando quiero ' +
  'queremos encontrar para por que quien se sin sobre su sus tambien un una unas uno unos y o u ya cual cuales como ' +
  'empresa empresas compania companias proveedor proveedores proveedora suministrador suministradores negocio negocios ' +
  'the of and or in for to from with a an i we need looking find company companies supplier suppliers provider providers ' +
  'de do da dos das em no na para com um uma fornecedor fornecedores'
).split(' '));

// Palabras que indican un tipo de actividad (slug de business_types)
const TYPE_WORDS: Record<string, string> = {
  exportador: 'exportador', exportadora: 'exportador', exporter: 'exportador', exportacion: 'exportador',
  importador: 'importador', importadora: 'importador', importer: 'importador', importacion: 'importador',
  distribuidor: 'distribuidor', distribuidora: 'distribuidor', distributor: 'distribuidor',
  mayorista: 'mayorista', wholesaler: 'mayorista', wholesale: 'mayorista',
  fabricante: 'fabricante', manufacturer: 'fabricante', fabrica: 'fabricante', factory: 'fabricante',
  productor: 'productor', productora: 'productor', producer: 'productor', grower: 'productor',
  oem: 'oem', odm: 'oem', cooperativa: 'cooperativa', tostador: 'tostador', tostadero: 'tostador', roaster: 'tostador',
  almazara: 'almazara', logistica: 'logistica', transitario: 'logistica', forwarder: 'logistica',
  trader: 'trading', trading: 'trading', broker: 'trading',
};

const singular = (w: string) => (w.length > 5 && w.endsWith('es') ? w.slice(0, -2) : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);

export interface ParsedQuery {
  normalized: string;
  terms: string[];
  /** Palabras útiles sin reducir a raíz (para APIs externas) */
  words: string[];
  /** Frase útil en su orden original ("aceite de oliva"), sin país, tipo ni palabras vacías en los extremos */
  phrase: string;
  countries: string[];
  types: string[];
}

/** `countryNames`: nombre normalizado → ISO (p. ej. "colombia" → "CO", "estados unidos" → "US"). */
export function parseQuery(raw: string, countryNames: Map<string, string> = new Map()): ParsedQuery {
  let text = normalize(raw).replace(/[^\p{L}\p{N}\s.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const normalizedQuery = text;
  const countries: string[] = [];
  // Países de varias palabras primero ("estados unidos", "costa de marfil")
  const names = [...countryNames.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (name.length < 4) continue;
    const re = new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    if (re.test(text)) {
      countries.push(countryNames.get(name)!);
      text = text.replace(re, ' ');
    }
  }
  const types: string[] = [];
  const terms: string[] = [];
  const words: string[] = [];
  const kept: string[] = [];
  for (const word of text.split(' ')) {
    if (!word) continue;
    const t = TYPE_WORDS[word] || TYPE_WORDS[word.replace(/s$/, '')] || TYPE_WORDS[word.replace(/es$/, '')];
    if (t) { if (!types.includes(t)) types.push(t); continue; }
    kept.push(word);
    if (STOPWORDS.has(word) || word.length < 2) continue;
    const s = singular(word);
    if (!terms.includes(s)) { terms.push(s); words.push(word); }
  }
  while (kept.length && STOPWORDS.has(kept[0])) kept.shift();
  while (kept.length && STOPWORDS.has(kept[kept.length - 1])) kept.pop();
  return { normalized: normalizedQuery, terms: terms.slice(0, 8), words: words.slice(0, 8), phrase: kept.slice(0, 10).join(' '), countries: [...new Set(countries)], types };
}

/** Número mínimo de términos que deben coincidir: todos si son pocos, ~60 % si la consulta es larga. */
export const minMatches = (n: number) => (n <= 2 ? n : Math.ceil(n * 0.6));
