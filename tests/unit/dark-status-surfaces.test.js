import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Why this exists: status surfaces (payment, notice, homework, banners, chips)
// used fixed light tints like `bg-red-50` while their text used theme tokens
// (`text-foreground`, `text-card-foreground`). In dark mode — the default for
// any phone set to dark, since the preference defaults to 'system' — the text
// turned near-white on a near-white card: parents could not read who owed what
// or the title of an urgent notice. A light tint must carry a `dark:bg-*`
// restatement on the same line (convention: -50 -> dark:bg-X-950/40,
// -100 -> dark:bg-X-900/40, text 6xx/7xx/8xx -> dark:text-X-3xx/4xx).

const ROOT = new URL('../../', import.meta.url);
const LIGHT_TINT = /(?<![\w:/-])bg-(?:red|amber|green|emerald|blue|sky|yellow|orange|purple|pink|indigo|teal|rose|violet|lime|cyan|fuchsia|slate|gray|zinc|neutral|stone)-(?:50|100)(?![\w/-])/;

// Files another fix package of this pass is rewriting (P3 app shell, P4
// attendance/reports, P5 admin home/payments/setup, P7 emergency contacts,
// P8 approvals/alerts/classroom/student, P2 CrearBitacora). Each applies the
// same convention there; remove the entry once that package merges.
const PENDING_IN_OTHER_PACKAGES = new Set([
  'src/pages/Home.jsx',
  'src/components/UserNotRegisteredError.jsx',
  'src/pages/Asistencia.jsx',
  'src/pages/Reportes.jsx',
  'src/pages/PagosAdmin.jsx',
  'src/pages/GestionPedidosAdmin.jsx',
  'src/pages/ConfiguracionInicial.jsx',
  'src/pages/GestionEscuela.jsx',
  'src/pages/ContactosEmergencia.jsx',
  'src/pages/Aprobaciones.jsx',
  'src/pages/AlertaEmergencia.jsx',
  'src/pages/GestionSalon.jsx',
  'src/pages/GestionAlumno.jsx',
  'src/pages/CrearBitacora.jsx',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('every light status tint in src/ has a dark-mode restatement', () => {
  const rootPath = new URL('.', ROOT).pathname;
  const offenders = [];
  for (const file of walk(new URL('src/', ROOT).pathname)) {
    const rel = path.relative(rootPath, file).split(path.sep).join('/');
    if (PENDING_IN_OTHER_PACKAGES.has(rel)) continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (LIGHT_TINT.test(line) && !/dark:(?:hover:)?bg-/.test(line)) {
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test('the surfaces from the audit screenshots carry dark tints', () => {
  const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
  // PaymentStatusCard: student name + amount are text-foreground on this tint.
  const payment = read('src/components/payments/PaymentStatusCard.jsx');
  for (const c of ['green', 'amber', 'red']) {
    assert.match(payment, new RegExp(`bg-${c}-50 dark:bg-${c}-950/40`));
  }
  // NoticeCard: the urgent notice title is text-card-foreground on this tint.
  const notice = read('src/components/notices/NoticeCard.jsx');
  assert.match(notice, /URGENT: '[^']*bg-red-50 dark:bg-red-950\/40/);
  assert.match(notice, /IMPORTANT: '[^']*bg-amber-50 dark:bg-amber-950\/40/);
});
