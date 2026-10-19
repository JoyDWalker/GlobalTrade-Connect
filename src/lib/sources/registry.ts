// Registro de adaptadores de búsqueda externa (de pago y abiertos). Añadir una fuente = implementar SearchAdapter
// y crear su fila en la tabla sources (catálogo en src/lib/seed/catalog.ts).
import { brave, googleCse, type SearchAdapter } from './adapters';
import { gleifSearch, wikidataSearch } from './open-data';

export const SEARCH_ADAPTERS: SearchAdapter[] = [brave, googleCse, gleifSearch, wikidataSearch];
