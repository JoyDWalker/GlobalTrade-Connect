import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { canonicalName, isGenericDomain, normalize, normalizeDomain, normalizeTaxId, rootDomain, safeUrl, slugify } from '@/lib/text';
import { parseQuery, minMatches } from '@/lib/search/query';
import { isAllowedByRobots } from '@/lib/sources/robots';
import { companyNameFromTitle, parseGleif, parseSite, webResultsToHits } from '@/lib/sources/adapters';
import { assertPublicUrl } from '@/lib/sources/http';
import { toCSV, toXLSX } from '@/lib/export';
import { loadMigrations, migrate } from '@/lib/migrations';
import { redact } from '@/lib/logger';
import { createPgliteDb } from '@/lib/db-pglite';

describe('normalización', () => {
  it('normaliza texto, slugs y nombres canónicos', () => {
    expect(normalize('  Café   Verde ÁRABE ')).toBe('cafe verde arabe');
    expect(slugify('Chocolaterie Atelier Brügge, S.L.')).toBe('chocolaterie-atelier-brugge-s-l');
    expect(canonicalName('Café Serra, S.L.')).toBe(canonicalName('cafe serra'));
    expect(canonicalName('ACME Coffee Ltda.')).toBe(canonicalName('Acme Coffee'));
  });
  it('normaliza dominios y descarta los genéricos', () => {
    expect(normalizeDomain('https://WWW.Acme.co.uk/es?x=1')).toBe('acme.co.uk');
    expect(normalizeDomain('ventas@acme.com')).toBe('acme.com');
    expect(normalizeDomain('localhost')).toBeNull();
    expect(rootDomain('shop.acme.co.uk')).toBe('acme.co.uk');
    expect(isGenericDomain('es.linkedin.com')).toBe(true);
    expect(isGenericDomain('acme.com')).toBe(false);
    expect(normalizeTaxId('B-12.345.678')).toBe('B12345678');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('acme.com')).toBe('https://acme.com/');
  });
});

describe('consultas en lenguaje natural', () => {
  const countries = new Map([['mexico', 'MX'], ['estados unidos', 'US'], ['colombia', 'CO']]);
  it('extrae términos, tipos y países', () => {
    const p = parseQuery('Necesito fabricantes de envases compostables para café en México', countries);
    expect(p.countries).toEqual(['MX']);
    expect(p.types).toEqual(['fabricante']);
    expect(p.terms).toEqual(['envas', 'compostabl', 'cafe']);   // raíces: coinciden con singular y plural
    expect(parseQuery('importers of olive oil in Estados Unidos', countries)).toMatchObject({ countries: ['US'], types: ['importador'] });
    expect(parseQuery('busco aceite de oliva en Colombia', countries).phrase).toBe('aceite de oliva');
  });
  it('exige más coincidencias en consultas cortas', () => {
    expect(minMatches(1)).toBe(1);
    expect(minMatches(2)).toBe(2);
    expect(minMatches(5)).toBe(3);
  });
});

describe('robots.txt', () => {
  const txt = 'User-agent: *\nDisallow: /privado\nAllow: /privado/publico\n\nUser-agent: GlobalTradeConnectBot\nDisallow: /no-bots';
  it('aplica el grupo específico y la regla más larga', () => {
    expect(isAllowedByRobots(txt, '/no-bots/x')).toBe(false);
    expect(isAllowedByRobots(txt, '/privado/x')).toBe(true);          // el grupo específico no lo prohíbe
    expect(isAllowedByRobots('User-agent: *\nDisallow: /privado\nAllow: /privado/publico', '/privado/x')).toBe(false);
    expect(isAllowedByRobots('User-agent: *\nDisallow: /privado\nAllow: /privado/publico', '/privado/publico/a')).toBe(true);
    expect(isAllowedByRobots('User-agent: *\nDisallow: /', '/')).toBe(false);
    expect(isAllowedByRobots('', '/')).toBe(true);
  });
});

describe('adaptadores', () => {
  it('convierte resultados web en empresas sin duplicar dominios', () => {
    const hits = webResultsToHits('brave', [
      { title: 'Acme Válvulas | Fabricante de válvulas industriales', url: 'https://www.acme-valvulas.example/es' },
      { title: 'Acme – Contacto', url: 'https://acme-valvulas.example/contacto' },
      { title: 'Válvulas en Alibaba', url: 'https://www.alibaba.com/x' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ name: 'Acme Válvulas', domain: 'acme-valvulas.example', externalId: 'https://acme-valvulas.example' });
    expect(companyNameFromTitle('Inicio | Café Serra', 'serra.example')).toBe('Café Serra');
  });
  it('extrae metadatos públicos y solo buzones corporativos del mismo dominio', () => {
    const html = `<html><head><title>Acme SA - Inicio</title><meta name="description" content="Fabricamos válvulas &amp; bombas">
      <script type="application/ld+json">{"@type":"Organization","name":"Acme S.A.","legalName":"Acme Sociedad Anónima","email":"info@acme.example","telephone":"+34 900 000 000",
      "address":{"streetAddress":"Calle 1","addressLocality":"Bilbao","addressCountry":"ES"},"sameAs":["https://www.linkedin.com/company/acme"]}</script></head>
      <body><a href="mailto:juan.perez@acme.example">Juan</a><a href="mailto:ventas@acme.example">Ventas</a><a href="mailto:info@otro.example">x</a></body></html>`;
    const s = parseSite(html, 'https://www.acme.example/');
    expect(s.name).toBe('Acme S.A.');
    expect(s.legalName).toBe('Acme Sociedad Anónima');
    expect(s.description).toBe('Fabricamos válvulas & bombas');
    expect(s.emails.sort()).toEqual(['info@acme.example', 'ventas@acme.example']); // sin emails personales ni de otros dominios
    expect(s.address?.city).toBe('Bilbao');
  });
  it('interpreta respuestas de GLEIF', () => {
    const r = parseGleif({ data: [{ id: '5493001KJTIIGC8Y1R12', attributes: { lei: '5493001KJTIIGC8Y1R12', entity: { legalName: { name: 'ACME SA' }, status: 'ACTIVE', legalAddress: { country: 'ES', city: 'Bilbao', addressLines: ['Calle 1'], postalCode: '48001' } } } }] });
    expect(r[0]).toMatchObject({ lei: '5493001KJTIIGC8Y1R12', legalName: 'ACME SA', country: 'ES', status: 'ACTIVE' });
  });
  it('bloquea direcciones no públicas (SSRF)', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/admin')).rejects.toThrow(/no pública/);
    await expect(assertPublicUrl('http://10.0.0.5/')).rejects.toThrow();
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertPublicUrl('ftp://example.com')).rejects.toThrow(/http/);
    await expect(assertPublicUrl('http://example.com:8080')).rejects.toThrow(/Puerto/);
  });
});

describe('exportación', () => {
  const rows = [{ name: 'Acme', city: '=HYPERLINK("x")', n: 12 }, { name: 'B, "c"', city: 'Bilbao', n: null }];
  const cols: [string, string][] = [['Nombre', 'name'], ['Ciudad', 'city'], ['N', 'n']];
  it('CSV con BOM, escape y protección contra fórmulas', () => {
    const csv = toCSV(rows, cols);
    expect(csv.startsWith('﻿Nombre,Ciudad,N')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"B, ""c"""');
  });
  it('XLSX es un ZIP válido con la hoja y los datos', () => {
    const buf = toXLSX(rows, cols, 'Empresas');
    expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304');
    // Localiza y descomprime la hoja
    const name = 'xl/worksheets/sheet1.xml';
    const idx = buf.indexOf(Buffer.from(name));
    const compSize = buf.readUInt32LE(idx - 12);
    const data = zlib.inflateRawSync(buf.subarray(idx + name.length, idx + name.length + compSize)).toString();
    expect(data).toContain('<t xml:space="preserve">Acme</t>');
    expect(data).toContain('<v>12</v>');
  });
});

describe('migraciones', () => {
  it('tienen versión única y no son destructivas', () => {
    const m = loadMigrations();
    expect(new Set(m.map((x) => x.version)).size).toBe(m.length);
    expect(m.filter((x) => x.destructive)).toEqual([]);
  });
  it('bloquean migraciones destructivas sin confirmación y detectan cambios en las aplicadas', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '0001_a.sql'), 'CREATE TABLE t (id int);');
    const db = await createPgliteDb();
    await migrate(db, { dir });
    fs.writeFileSync(path.join(dir, '0002_b.sql'), 'DROP TABLE t;');
    await expect(migrate(db, { dir })).rejects.toThrow(/destructivas/);
    fs.renameSync(path.join(dir, '0002_b.sql'), path.join(dir, '0002_b.destructive.sql'));
    await expect(migrate(db, { dir })).rejects.toThrow(/destructivas/);
    expect(await migrate(db, { dir, allowDestructive: true })).toEqual(['0002_b.destructive.sql']);
    fs.writeFileSync(path.join(dir, '0001_a.sql'), 'CREATE TABLE t (id bigint);');
    await expect(migrate(db, { dir })).rejects.toThrow(/checksum/);
  });
});

describe('logs', () => {
  it('redactan secretos y datos personales', () => {
    const out = redact({ password: 'x', apiKey: 'k', email: 'a@b.c', nested: { authorization: 'Bearer abc.def' }, url: 'https://x/?key=SECRET&q=1', db: 'postgres://u:pass@host/db', ok: 1 }) as any;
    expect(out).toMatchObject({ password: '[redacted]', apiKey: '[redacted]', email: '[redacted]', nested: { authorization: '[redacted]' }, ok: 1 });
    expect(out.url).toBe('https://x/?key=[redacted]&q=1');
    expect(out.db).toBe('postgres://u:[redacted]@host/db');
  });
});
