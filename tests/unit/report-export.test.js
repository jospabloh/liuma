import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCsv, UTF8_BOM } from '../../src/lib/report-export.js';

test('CSV starts with a UTF-8 BOM so Excel (es-MX) shows "Bitácoras", not "BitÃ¡coras"', () => {
  const csv = buildCsv([{ kpi: 'Bitácoras', valor: '80%' }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.startsWith(UTF8_BOM));
  assert.match(csv, /"Bitácoras","80%"/);
});

test('CSV quotes cells the RFC 4180 way (doubled quotes, not backslashes)', () => {
  const csv = buildCsv([{ a: 'dijo "hola"', b: 12, c: null }]);
  const [header, row] = csv.slice(1).split('\r\n');
  assert.equal(header, '"a","b","c"');
  assert.equal(row, '"dijo ""hola""","12",""');
});

test('jsPDF and html2canvas load only when a PDF is requested', () => {
  // A static import put ~600 KB into the Reportes chunk for every visit.
  const src = fs.readFileSync(new URL('../../src/lib/report-export.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import .*(jspdf|html2canvas)/m);
  assert.match(src, /import\('jspdf'\)/);
  assert.match(src, /import\('html2canvas'\)/);
  // The object URL is revoked after the download has had time to start.
  assert.match(src, /setTimeout\(\(\) => URL\.revokeObjectURL/);
});
