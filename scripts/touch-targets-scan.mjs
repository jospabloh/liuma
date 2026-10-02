// Touch-target scan: every interactive element on LIUMA's main screens, per
// role, on a phone (coarse pointer) at 320 and 390 px, measured in Chromium.
//
// Usage:  node scripts/touch-targets-scan.mjs [--width 320,390] [--json out.json]
//   Starts Vite's dev server itself and fulfils EVERY /api/ request locally
//   (the same mocked-backend pattern as the v1.8.2 mobile QA): nothing reaches
//   Base44. Exits 1 when a target is under 44x44.
//   Needs a Playwright Chromium (`npx playwright install chromium`).
//
// What counts as a target's size is what a finger can hit, not its painted
// box: a 20px close button whose ::after reaches 44px (sonner's, Switch) is
// fine. So an element under 44 px is hit-tested at the edges of a 44x44
// square around its centre with elementFromPoint, and only reported when a
// probe lands on something else. Inline links inside running text are
// exempt (WCAG 2.5.8's own exception) and listed separately.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const WIDTHS = (argOf('--width') || '320,390').split(',').map(Number);
const JSON_OUT = argOf('--json');
const MIN = 44;

// ----------------------------------------------------------------- data --
const S = 'mockSchoolA';
const C = '2026-09-01T12:00:00.000000';
const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const USERS = {
  ADMIN: { id: 'uD', email: 'directora@example.invalid', full_name: 'Directora Prueba', display_name: 'Laura', role: 'user' },
  TEACHER: { id: 'uT', email: 'maestra@example.invalid', full_name: 'Maestra Prueba', role: 'user' },
  PARENT: { id: 'uP', email: 'padre@example.invalid', full_name: 'Papá Prueba', role: 'user' },
  // full_name is the email handle and there is no display_name: the
  // "¿Cómo te llamas?" dialog opens by itself for this one.
  NAMELESS: { id: 'uN', email: 'h.prueba+qa-padre@example.invalid', full_name: 'h.prueba+qa-padre', role: 'user' },
};
const ROLE_OF = { ADMIN: 'ADMIN', TEACHER: 'TEACHER', PARENT: 'PARENT', NAMELESS: 'PARENT' };
const kids = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Fernando', 'Gabriela', 'Hugo', 'Isabel'];

function fixtures() {
  return {
    School: [{ id: S, name: 'Escuela de prueba', join_code: 'ABCD-EFGH', created_date: C, settings: {} }],
    UserProfile: Object.entries(USERS).map(([k, u]) => ({
      id: `up_${k}`, user_id: u.id, school_id: S, app_role: ROLE_OF[k], status: 'ACTIVE',
      onboarding_completed: true, welcome_message_shown: true, created_date: C, full_name: u.full_name, email: u.email,
    })),
    Classroom: [
      { id: 'c1', school_id: S, name: 'Salón 1', grade: 'Kínder 2', is_active: true, created_date: C },
      { id: 'c2', school_id: S, name: 'Salón 2', grade: 'Kínder 3', is_active: true, created_date: C },
    ],
    Student: kids.map((n, i) => ({ id: `s${i}`, school_id: S, classroom_id: i < 6 ? 'c1' : 'c2', first_name: n, last_name: 'Prueba', is_active: true, birth_date: '2021-03-01', created_date: C })),
    TeacherClassroom: [{ id: 'tc1', school_id: S, teacher_id: 'uT', classroom_id: 'c1', is_primary: true, is_active: true }],
    ParentStudent: ['uP', 'uN'].map((p, i) => ({ id: `ps${i}`, school_id: S, parent_id: p, student_id: 's0', relationship: 'PADRE', is_primary: true, status: 'ACTIVE' })),
    Notice: [1, 2].map((i) => ({ id: `n${i}`, school_id: S, scope: 'SCHOOL', title: `Aviso de prueba ${i}`, content: 'Contenido del aviso. '.repeat(6), priority: i === 1 ? 'HIGH' : 'NORMAL', author_id: 'uD', author_name: 'Laura', created_date: C, sent_at: C })),
    NoticeDelivery: [],
    ChargeItem: [
      { id: 'ch1', school_id: S, student_id: 's0', concept_name: 'Colegiatura octubre', amount: 3500, due_date: today, status: 'PENDING', created_date: C },
      { id: 'ch2', school_id: S, student_id: 's0', concept_name: 'Uniforme deportivo', amount: 850, amount_paid: 400, due_date: '2026-09-10', status: 'OVERDUE', created_date: C },
    ],
    PaymentConcept: [{ id: 'pc1', school_id: S, name: 'Colegiatura', default_amount: 3500, concept_type: 'COLEGIATURA', is_active: true }],
    Discount: [], PaymentRecord: [], Attendance: [], DiaryEntry: [],
    Homework: [{ id: 'h1', school_id: S, classroom_id: 'c1', title: 'Tarea de prueba', due_date: today, teacher_id: 'uT', subject: 'Arte' }],
    Event: [{ id: 'e1', school_id: S, title: 'Festival', date: today, time: '10:00', scope: 'SCHOOL', created_date: C }],
    UniformOrder: [], AbsenceNotification: [], EventResponse: [], EmergencyContact: [], OfficialDocument: [],
    SupportTicket: [], AuditLog: [], PendingChange: [], PermissionOverride: [], SchoolSetupGuide: [],
    SchoolSubscription: [{ id: 'sub1', school_id: S, subscription_status: 'trial', license_tier: 'growth', trial_end_date: '2026-10-29' }],
  };
}

function matches(row, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$and') return v.every((x) => matches(row, x));
    if (k === '$or') return v.some((x) => matches(row, x));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.map(String).includes(String(row[k]));
      if ('$ne' in v) return row[k] !== v.$ne;
      return true;
    }
    if (row[k] === undefined) return true;
    return String(row[k]) === String(v);
  });
}

async function mockBackend(ctx, who) {
  const db = fixtures();
  const me = { ...USERS[who] }; // per context: updateMe below edits it
  const role = ROLE_OF[who];
  await ctx.route((url) => url.pathname.startsWith('/api/') || /socket\.io/.test(url.href), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { /* not JSON */ }
    const json = (x, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
    if (/socket\.io/.test(url.href)) return route.abort();
    if (p.includes('public-settings')) return json({ id: 'mockapp', public_settings: {} });
    if (p.endsWith('/entities/User/me')) {
      if (req.method() !== 'GET') Object.assign(me, body);
      return json(me);
    }
    let m = p.match(/\/entities\/(\w+)(?:\/(\w+))?$/);
    if (m) {
      const rows = db[m[1]] || [];
      if (req.method() !== 'GET') return json({ id: `mock_${Date.now()}`, ...body });
      if (m[2]) return json(rows.find((r) => r.id === m[2]) || {});
      let q = {};
      try { q = JSON.parse(url.searchParams.get('q') || '{}'); } catch { /* none */ }
      return json(rows.filter((r) => matches(r, q)));
    }
    m = p.match(/\/functions\/(\w+)/);
    if (m) {
      const fn = m[1];
      if (fn === 'schoolRead') {
        const classroomIds = role === 'TEACHER' ? ['c1'] : role === 'ADMIN' ? ['c1', 'c2'] : [];
        const studentIds = role === 'PARENT' ? ['s0'] : db.Student.filter((s) => classroomIds.includes(s.classroom_id)).map((s) => s.id);
        const context = {
          ok: true, role, school_id: S, profile_id: `up_${who}`, classroom_ids: classroomIds, student_ids: studentIds,
          link_student_ids: role === 'PARENT' ? ['s0'] : [],
          students: db.Student.filter((s) => studentIds.includes(s.id)),
          classrooms: db.Classroom.filter((c) => classroomIds.includes(c.id) || role === 'PARENT'),
        };
        if (body.action === 'context') return json(context);
        const one = (q) => (db[q.entity] || []).filter((r) => matches(r, q.filter));
        if (body.queries) return json({ ok: true, results: Object.fromEntries(body.queries.map((q) => [q.key, one(q)])), ...(body.context ? { context } : {}) });
        return json({ ok: true, rows: one(body), has_more: false });
      }
      if (fn === 'getMySubscription') return json({ ok: true, subscription: db.SchoolSubscription[0], effective: { status: 'trial', isReadOnly: false, reason: 'trial' }, school: db.School[0] });
      if (fn === 'listSchoolMembers') return json({ ok: true, users: Object.values(USERS).map((u) => ({ id: u.id, full_name: u.display_name || u.full_name, email: u.email })) });
      if (fn === 'guardedEntityWrite' || fn === 'guardedFamilyWrite') return json({ ok: true, record: { id: `mock_${Date.now()}`, ...(body.data || {}) } });
      return json({ ok: true, sent: 0, total: 0 });
    }
    if (/\/agents\/conversations/.test(p)) return json(req.method() === 'GET' && /conversations\/?$/.test(p) ? [] : { id: 'conv1', messages: [] });
    return json({ ok: true });
  });
}

// --------------------------------------------------------------- screens --
const SCREENS = {
  ADMIN: ['Home', 'GestionEscuela', 'Aprobaciones', 'PagosAdmin', 'GestionDescuentos', 'AvisosAdmin', 'AlertaEmergencia', 'CalendarioEscolar', 'Reportes', 'GestionDocumentos', 'GestionAusencias', 'GestionPedidosAdmin', 'PermisosRoles', 'SoporteAdmin', 'Ayuda'],
  TEACHER: ['Home', 'Asistencia', 'CrearBitacora', 'BitacorasMaestro', 'TareaMaestro', 'AvisosMaestro', 'GestionSalon', 'CalendarioEscolar', 'Soporte'],
  PARENT: ['Home', 'MisHijos', 'Avisos', 'Tarea', 'Bitacora', 'Asistencia', 'Pagos', 'SolicitarAusencia', 'EventosParaPadres', 'PedidosUniformes', 'ContactosEmergencia', 'CalendarioEscolar', 'Soporte'],
};

// Runs in the page. Returns every interactive element under MIN x MIN that a
// finger cannot hit across a MIN x MIN square.
async function measure(page, min) {
  return page.evaluate(async (MIN) => {
    const SELECTOR = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=menuitem], [role=option], [role=link], [tabindex]:not([tabindex="-1"])';
    const describe = (el) => {
      const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || '';
      return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} "${label.replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
    };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none' || Number(cs.opacity) === 0) return false;
      if (el.closest('[aria-hidden="true"], [inert]')) return false;
      // The thing under a modal is not reachable while it is open.
      const modal = document.querySelector('[role="dialog"][aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"]');
      if (modal && !modal.contains(el) && !el.closest('[data-sonner-toaster]')) return false;
      return true;
    };
    const inlineInText = (el) => {
      if (el.tagName !== 'A' || getComputedStyle(el).display !== 'inline') return false;
      const parentText = (el.parentElement?.textContent || '').replace(/\s+/g, ' ').trim();
      return parentText.length > (el.textContent || '').trim().length + 10;
    };
    const hits = (el, x, y) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true; // off-screen half: not a competitor
      const at = document.elementFromPoint(x, y);
      return !!at && (at === el || el.contains(at));
    };
    const out = { small: [], inline: [] };
    const seen = new Set();
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (seen.has(el) || !visible(el)) continue;
      seen.add(el);
      // The inner element of a label/button pair is measured through its owner.
      if (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(el.type) && el.closest('label')) continue;
      let r = el.getBoundingClientRect();
      if (r.width >= MIN - 0.5 && r.height >= MIN - 0.5) continue;
      if (inlineInText(el)) { out.inline.push(describe(el)); continue; }
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((res) => requestAnimationFrame(() => res()));
      r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const h = (MIN - 2) / 2;
      const probes = [[-h, -h], [0, -h], [h, -h], [-h, 0], [h, 0], [-h, h], [0, h], [h, h]];
      const misses = probes.filter(([dx, dy]) => !hits(el, cx + dx, cy + dy));
      if (misses.length === 0) continue;
      out.small.push(`${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    window.scrollTo(0, 0);
    return out;
  }, min);
}

async function openContext(browser, width, who) {
  const ctx = await browser.newContext({
    viewport: { width, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'es-MX', timezoneId: 'America/Mexico_City',
  });
  if (who) {
    await ctx.addInitScript(() => {
      localStorage.setItem('base44_access_token', 'mock-token');
      localStorage.setItem('liuma-theme', 'light');
    });
  }
  await mockBackend(ctx, who || 'ADMIN');
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  return { ctx, page, errors };
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
}

async function main() {
  const server = await createServer({ server: { port: 5299, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const report = [];
  const record = (width, who, screen, result, errors) => {
    report.push({ width, who, screen, ...result, errors });
    const flag = result.small.length ? 'FAIL' : 'ok  ';
    console.log(`${flag} ${width}px ${who.padEnd(8)} ${screen.padEnd(22)} ${result.small.length ? result.small.join(' | ') : ''}${errors.length ? `  [errors: ${errors.join('; ')}]` : ''}`);
  };
  try {
    for (const width of WIDTHS) {
      // Signed out.
      {
        const { ctx, page, errors } = await openContext(browser, width, null);
        await page.goto(`${base}/entrar`);
        await settle(page);
        record(width, 'ANON', 'entrar', await measure(page, MIN), errors);
        await ctx.close();
      }
      for (const who of ['ADMIN', 'TEACHER', 'PARENT']) {
        const { ctx, page, errors } = await openContext(browser, width, who);
        for (const screen of SCREENS[who]) {
          errors.length = 0;
          await page.goto(`${base}/${screen}`);
          await settle(page);
          record(width, who, screen, await measure(page, MIN), [...errors]);
        }
        // States that only exist after a tap.
        await page.goto(`${base}/Home`);
        await settle(page);
        const switcher = page.locator('[data-theme-switcher] button[aria-expanded]');
        if (await switcher.count()) {
          await switcher.click();
          await page.waitForTimeout(400);
          record(width, who, 'theme switcher (open)', await measure(page, MIN), []);
          await page.keyboard.press('Escape');
        }
        const more = page.getByRole('button', { name: /^Más/ }).or(page.getByRole('link', { name: /^Más/ }));
        if (await more.count()) {
          await more.first().click();
          await page.waitForTimeout(400);
          record(width, who, 'command palette', await measure(page, MIN), []);
          await page.keyboard.press('Escape');
        }
        // A toast from the app's own sonner instance (same module URL).
        const toasted = await page.evaluate(async () => {
          const src = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/deps\/sonner\.js/.test(n));
          if (!src) return false;
          const mod = await import(src);
          mod.toast.success('Guardado', { description: 'Prueba de cierre', duration: 60000 });
          return true;
        });
        if (toasted) {
          await page.waitForTimeout(500);
          record(width, who, 'toast', await measure(page, MIN), []);
        }
        await ctx.close();
      }
      // The one-time "¿Cómo te llamas?" dialog.
      {
        const { ctx, page, errors } = await openContext(browser, width, 'NAMELESS');
        await page.goto(`${base}/Home`);
        await settle(page);
        const asked = await page.getByRole('dialog').filter({ hasText: '¿Cómo te llamas?' }).count();
        const greeting = await page.locator('h1').first().textContent().catch(() => '');
        record(width, 'NAMELESS', `name dialog (${asked ? 'shown' : 'NOT SHOWN'}; h1 "${(greeting || '').trim()}")`, await measure(page, MIN), errors);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(report, null, 2));
  const failing = report.filter((r) => r.small.length);
  const inline = [...new Set(report.flatMap((r) => r.inline))];
  if (inline.length) console.log(`\nInline links in text (exempt): ${inline.join(' | ')}`);
  console.log(`\n${failing.length ? `${failing.length} screen states with targets under ${MIN}px` : `Every target is at least ${MIN}x${MIN}px`}.`);
  process.exit(failing.length ? 1 : 0);
}

export { fixtures, mockBackend, openContext, settle, measure };
if (!process.env.TOUCH_SCAN_NO_MAIN) main().catch((e) => { console.error(e); process.exit(2); });
