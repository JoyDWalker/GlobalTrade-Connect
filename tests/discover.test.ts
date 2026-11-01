import { describe, expect, it, vi } from 'vitest';
import { domainCandidates, discoverWebsite, nameWords, siteMatches } from '@/lib/sources/discover';
import type { SiteInfo } from '@/lib/sources/adapters';
import { SourceError } from '@/lib/sources/http';

const site = (url: string, text: string, extra: Partial<SiteInfo> = {}): SiteInfo => ({
  finalUrl: url, status: 200, redirected: false, name: null, description: null, legalName: null, logo: null,
  emails: [], phones: [], address: null, sameAs: [], text, ...extra,
});

describe('descubrimiento de la web oficial', () => {
  it('quita la forma jurídica y propone dominios del país y .com', () => {
    expect(nameWords('Aceites Sierra Sur, S.L.').key).toEqual(['aceites', 'sierra', 'sur']);
    expect(nameWords('Grupo Bimbo, S.A.B. de C.V.').distinctive).toEqual(['bimbo']);
    const d = domainCandidates('Aceites Sierra Sur, S.L.', 'ES');
    expect(d.slice(0, 2)).toEqual(['aceitessierrasur.es', 'aceites-sierra-sur.es']);
    expect(d).toContain('aceitessierrasur.com');
    expect(domainCandidates('Café do Brasil Ltda', 'BR')[0]).toBe('cafebrasil.com.br');
  });

  it('acepta solo webs que mencionan a la empresa y descarta dominios aparcados', () => {
    const t = { name: 'Aceites Sierra Sur SL', city: 'Jaén' };
    expect(siteMatches(site('https://aceitessierrasur.es/', 'Aceites Sierra Sur · Aceite de oliva virgen extra desde 1950 en Jaén. Contacto y tienda online.'), t)).toBe(true);
    expect(siteMatches(site('https://aceitessierrasur.es/', 'Este dominio está a la venta. Buy this domain today, contact the owner for an offer.'), t)).toBe(false);
    expect(siteMatches(site('https://sierra.es/', 'Hotel en la sierra, rutas de senderismo y casas rurales. Reserva tu estancia ahora mismo.'), t)).toBe(false);
    // Nombre de una sola palabra: hace falta otra evidencia (ciudad o razón social)
    expect(siteMatches(site('https://ybarra.es/', 'Ybarra mayonesas y aceites. Información corporativa y productos de la marca.'), { name: 'Ybarra' })).toBe(false);
    expect(siteMatches(site('https://ybarra.es/', 'Ybarra mayonesas y aceites. Sede en Dos Hermanas, Sevilla. Productos de la marca.'), { name: 'Ybarra', city: 'Dos Hermanas' })).toBe(true);
  });

  it('prueba Wikidata por LEI, luego dominios probables y por último el buscador', async () => {
    const fetchSite = vi.fn(async (url: string) => {
      if (url === 'https://aceitessierrasur.es/') throw new SourceError('network', 'El dominio no resuelve');
      if (url === 'https://aceites-sierra-sur.es/') return site('https://www.aceites-sierra-sur.es/', 'Aceites Sierra Sur S.L. – almazara en Jaén. Tel. 953 000 000', { phones: ['953 000 000'] });
      throw new SourceError('network', 'no');
    });
    const wikidataByLei = vi.fn(async () => null);
    const webSearch = vi.fn(async () => []);
    const r = await discoverWebsite({ name: 'Aceites Sierra Sur SL', lei: '959800ABCDEF12345678', city: 'Jaén', countryCode: 'ES' }, { fetchSite, wikidataByLei, webSearch });
    expect(wikidataByLei).toHaveBeenCalledWith('959800ABCDEF12345678');
    expect(r).toMatchObject({ website: 'https://www.aceites-sierra-sur.es/', method: 'guess' });
    expect(r!.info!.phones).toEqual(['953 000 000']);
    expect(webSearch).not.toHaveBeenCalled();
  });

  it('usa la web declarada en Wikidata aunque robots.txt no permita leerla', async () => {
    const fetchSite = vi.fn(async () => { throw new SourceError('blocked', 'robots.txt no permite rastrear esta página'); });
    const r = await discoverWebsite({ name: 'Acme Foods Ltd', lei: 'LEI1' }, {
      fetchSite, wikidataByLei: async () => ({ qid: 'Q1', website: 'https://acme-foods.example/', email: 'info@acme-foods.example', phone: null }),
    });
    expect(r).toMatchObject({ website: 'https://acme-foods.example/', method: 'wikidata', email: 'info@acme-foods.example', info: null });
  });

  it('con buscador, solo acepta un resultado cuya web menciona a la empresa', async () => {
    const fetchSite = vi.fn(async (url: string) => {
      if (url === 'https://directorio-empresas.example/') return site(url, 'Directorio de empresas de España: miles de fichas de empresas por provincia y sector.');
      if (url === 'https://hsj-aceites.example/') return site(url, 'Hermanos Jerez · Aceite de oliva virgen extra · Almazara familiar en Alameda de la Sagra');
      throw new SourceError('network', 'El dominio no resuelve');
    });
    const webSearch = vi.fn(async () => [
      { sourceKey: 'brave', externalId: 'a', name: 'x', url: 'https://directorio-empresas.example/ficha/1', domain: 'directorio-empresas.example', snippet: null },
      { sourceKey: 'brave', externalId: 'b', name: 'y', url: 'https://hsj-aceites.example/contacto', domain: 'hsj-aceites.example', snippet: null },
    ]);
    const r = await discoverWebsite({ name: 'Aceite De Oliva Virgen Hermanos Jerez Sl', city: 'Alameda de la Sagra', countryCode: 'ES' }, { fetchSite, webSearch });
    expect(webSearch).toHaveBeenCalledWith('"Aceite De Oliva Virgen Hermanos Jerez Sl" Alameda de la Sagra', 'ES');
    expect(r).toMatchObject({ website: 'https://hsj-aceites.example/', method: 'web_search' });
  });

  it('devuelve null si nada coincide', async () => {
    const r = await discoverWebsite({ name: 'Empresa Inexistente Zzz SL', countryCode: 'ES' }, { fetchSite: async () => { throw new SourceError('network', 'no resuelve'); } });
    expect(r).toBeNull();
  });
});
