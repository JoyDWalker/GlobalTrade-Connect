// Deduce la web de una empresa a partir de su nombre ("Cafe Kladdkakan i Gamla Stan AB" + Suecia → kladdkakan.se)
// y solo la acepta si la página dice ser esa empresa. Gratuito: no usa buscadores.
import { normalize } from '../text';
import { fetchPublicPage } from './http';
import { robotsAllows } from './adapters';

// Dominio nacional por país (los que usan segundo nivel, como .com.br o .co.uk)
const CC: Record<string, string> = { GB: 'co.uk', UK: 'co.uk', BR: 'com.br', AR: 'com.ar', MX: 'com.mx', PE: 'com.pe', AU: 'com.au', TR: 'com.tr', ZA: 'co.za', NZ: 'co.nz', JP: 'co.jp', US: 'com' };

export function candidateDomains(tokens: string[], country: string | null, max = 6) {
  const labels = new Set<string>();
  const clean = (s: string) => s.replace(/[^a-z0-9-]/g, '');
  const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
  // Por probabilidad: palabra más distintiva, dos primeras juntas, con guion, todas juntas
  if (longest && (longest.length >= 6 || tokens.length === 1) && longest.length >= 4) labels.add(clean(longest));
  if (tokens.length > 1) labels.add(clean(tokens[0] + tokens[1]));
  if (tokens.length > 1) labels.add(clean(`${tokens[0]}-${tokens[1]}`));
  if (tokens.length > 2 && tokens.join('').length <= 24) labels.add(clean(tokens.join('')));
  const tlds = [...new Set([country ? CC[country.toUpperCase()] ?? country.toLowerCase() : null, 'com'].filter(Boolean) as string[])];
  const out: string[] = [];
  for (const l of labels) for (const t of tlds) if (l.length >= 3) out.push(`${l}.${t}`);
  return out.slice(0, max);
}

/** ¿La página corresponde a la empresa? La palabra más distintiva y otra más (o la ciudad) aparecen en el título o el texto. */
export function pageMatches(html: string, tokens: string[], city: string | null) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const text = normalize(`${title} ${html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')}`).slice(0, 200_000);
  const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
  if (!longest || !text.includes(longest)) return false;
  const others = tokens.filter((t) => t !== longest && text.includes(t)).length;
  return others >= 1 || Boolean(city && text.includes(normalize(city)));
}

export async function guessWebsite(tokens: string[], country: string | null, city: string | null, timeoutMs = 5000): Promise<{ website: string | null; tried: string[] }> {
  const tried: string[] = [];
  for (const domain of candidateDomains(tokens, country)) {
    tried.push(domain);
    try {
      const url = new URL(`https://${domain}/`);
      if (!(await robotsAllows(url, timeoutMs))) continue;
      const page = await fetchPublicPage(url.toString(), { timeoutMs });
      if (page.status >= 400 || !/html/i.test(page.contentType)) continue;
      if (pageMatches(page.body, tokens, city)) return { website: `https://${new URL(page.url).hostname.replace(/^www\./, '')}`, tried };
    } catch { /* el dominio no existe o no responde: siguiente candidato */ }
  }
  return { website: null, tried };
}
