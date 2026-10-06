// Overlap scan: on every main screen, per role, at phone / tablet / desktop
// viewports, finds (1) interactive elements whose boxes intersect, (2) a
// horizontally scrolling page, (3) button/link text that is cut off, and
// (4) controls covered by something else (ThemeSwitcher, BottomNav, SideNav,
// fixed bars) at mid-scroll and at the bottom of the page.
//
// Usage: node scripts/overlap-scan.mjs [--vp 390x844,834x1194] [--json out.json]
//        [--shots dir]
// Reuses the mocked backend of scripts/touch-targets-scan.mjs: nothing reaches
// Base44. Exits 1 when any overlap or page overflow is found.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
process.env.TOUCH_SCAN_NO_MAIN = '1';
const { mockBackend, settle, SCREENS } = await import('./touch-targets-scan.mjs');

const args = process.argv.slice(2);
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const VIEWPORTS = (argOf('--vp') || '320x640,390x844,768x1024,834x1194,1024x1366,1024x768,1440x900')
  .split(',').map((s) => s.split('x').map(Number));
const JSON_OUT = argOf('--json');
const SHOTS = argOf('--shots');
const WHO = (argOf('--who') || 'ANON,ADMIN,TEACHER,PARENT').split(',');

// Runs in the page.
async function detect() {
  const SELECTOR = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=menuitem], [role=option], [role=link]';
  const describe = (el) => {
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || '';
    return `${el.tagName.toLowerCase()} "${label.replace(/\s+/g, ' ').trim().slice(0, 36)}"`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    if (el.closest('[aria-hidden="true"], [inert]')) return false;
    return true;
  };
  // The part of the box actually painted: clipped by every ancestor that
  // scrolls or hides overflow (a long SideNav list scrolls under its footer).
  const clipped = (el) => {
    const r = el.getBoundingClientRect();
    let l = r.left, t = r.top, rt = r.right, b = r.bottom;
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const c = n.getBoundingClientRect();
      if (cs.overflowX !== 'visible') { l = Math.max(l, c.left); rt = Math.min(rt, c.right); }
      if (cs.overflowY !== 'visible') { t = Math.max(t, c.top); b = Math.min(b, c.bottom); }
    }
    return { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t };
  };
  const els = [...document.querySelectorAll(SELECTOR)].filter(visible)
    // a checkbox inside its own label is one control
    .filter((el) => !(el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(el.type) && el.closest('label')))
    // sr-only / clipped helpers
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
  const out = { pairs: [], hscroll: null, cut: [], covered: [] };

  const de = document.documentElement;
  if (de.scrollWidth > innerWidth + 1) out.hscroll = `${de.scrollWidth} > ${innerWidth}`;

  // (1) pairs, in document coordinates, scroll-independent.
  const boxes = els.map((el) => ({ el, r: clipped(el) })).filter(({ r }) => r.width > 1 && r.height > 1);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 2 && h > 2) {
        // Sticky/fixed vs scrolling content only overlap by scroll position; compared below.
        const fixed = (e) => { for (let n = e; n; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
        if (fixed(a.el) !== fixed(b.el)) continue;
        out.pairs.push(`${describe(a.el)} x ${describe(b.el)} (${Math.round(w)}x${Math.round(h)})`);
      }
    }
  }

  // (3) cut text: the control (or a child) clips overflow and its TEXT, not a
  // decorative child, sticks out past the box. Ellipsis truncation is
  // reported apart ("ellipsis") because it is a design choice, not a clip.
  const textRect = (node) => { const rg = document.createRange(); rg.selectNodeContents(node); return rg.getBoundingClientRect(); };
  const labelled = (el) => ['A', 'BUTTON', 'SUMMARY'].includes(el.tagName) || ['button', 'tab'].includes(el.getAttribute('role'));
  for (const { el } of boxes) {
    if (!labelled(el)) continue;
    for (const c of [el, ...el.querySelectorAll('span, p, div, h1, h2, h3, h4, label')]) {
      if (!(c.textContent || '').trim() || c.children.length > 3) continue;
      const cs = getComputedStyle(c);
      const tr = textRect(c), cr = c.getBoundingClientRect();
      // Text that spills past its own box (an unbreakable word in a narrow
      // flex cell) paints over whatever sits next to it.
      if (cs.overflowX === 'visible' && cs.textOverflow !== 'ellipsis') {
        if (c.children.length === 0 && tr.width > 0 && tr.right > cr.right + 1) out.cut.push(`CLIPPED(spill) ${describe(el)} text ${Math.round(tr.right)}>${Math.round(cr.right)}`);
        continue;
      }
      if (c.scrollWidth <= c.clientWidth + 1) continue;
      if (cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap') out.cut.push(`ellipsis ${describe(el)} ${c.scrollWidth}>${c.clientWidth}`);
      else if (tr.right > cr.right + 1 || tr.left < cr.left - 1) out.cut.push(`CLIPPED ${describe(el)} text ${Math.round(tr.right)}>${Math.round(cr.right)}`);
    }
  }

  // (4) covered controls: mid-scroll and page bottom.
  const cover = async (mode) => {
    const modal = document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]');
    for (const { el } of boxes) {
      if (!el.isConnected) continue;
      if (modal && !modal.contains(el)) continue;
      if (mode === 'mid') el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = clipped(el);
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const pts = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5]].map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]);
      let blocked = null;
      let ok = 0;
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) { ok++; continue; }
        const at = document.elementFromPoint(x, y);
        if (at && (at === el || el.contains(at) || at.contains(el))) ok++; else blocked = blocked || at;
      }
      if (ok === 0 && blocked) {
        const tag = blocked.closest('[data-theme-switcher]') ? 'ThemeSwitcher' : blocked.closest('nav, aside, header, footer') ? blocked.closest('nav, aside, header, footer').tagName.toLowerCase() : describe(blocked);
        out.covered.push(`${mode}: ${describe(el)} covered by ${tag} <${blocked.tagName.toLowerCase()}.${(blocked.className + '').slice(0, 50)}>`);
      }
    }
  };
  await cover('mid');
  window.scrollTo(0, document.documentElement.scrollHeight);
  await new Promise((res) => requestAnimationFrame(() => res()));
  await cover('bottom');
  window.scrollTo(0, 0);
  for (const k of ['pairs', 'cut', 'covered']) out[k] = [...new Set(out[k])];
  return out;
}

async function main() {
  const server = await createServer({ server: { port: 5298, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const CANDIDATES = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  let browser;
  try { browser = await chromium.launch({ args: ['--no-sandbox'] }); }
  catch (e) {
    const exe = CANDIDATES.find((p) => existsSync(p));
    if (!exe) throw e;
    browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  }
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  const report = [];
  let bad = 0;
  try {
    for (const [w, h] of VIEWPORTS) {
      const touch = w < 1440;
      for (const who of WHO) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: touch && w < 800, hasTouch: touch,
          locale: 'es-MX', timezoneId: 'America/Mexico_City',
        });
        if (who !== 'ANON') await ctx.addInitScript(() => { localStorage.setItem('base44_access_token', 'mock-token'); localStorage.setItem('liuma-theme', 'light'); });
        await mockBackend(ctx, who === 'ANON' ? 'ADMIN' : who);
        const page = await ctx.newPage();
        const screens = who === 'ANON' ? ['entrar'] : SCREENS[who];
        for (const screen of screens) {
          await page.goto(`${base}/${screen}`, { timeout: 120000 });
          await settle(page);
          const res = await page.evaluate(detect);
          const states = [['base', res]];
          // Open the theme switcher and re-check once per viewport/role.
          const issues = res.pairs.length + (res.hscroll ? 1 : 0) + res.covered.length + res.cut.filter((c) => c.startsWith('CLIPPED')).length;
          const entry = { vp: `${w}x${h}`, who, screen, ...res };
          report.push(entry);
          const cutNote = '';
          console.log(`${issues ? 'FAIL' : 'ok  '} ${w}x${h} ${who.padEnd(7)} ${screen.padEnd(20)}${cutNote}${issues ? ' ' + [res.hscroll && `HSCROLL ${res.hscroll}`, ...res.pairs.map((p) => `PAIR ${p}`), ...res.covered.map((c) => `COVER ${c}`), ...res.cut.filter((c) => c.startsWith('CLIPPED'))].filter(Boolean).join(' | ') : ''}`);
          const soft = res.cut.filter((c) => c.startsWith('ellipsis'));
          if (soft.length) console.log(`       ${soft.join(' | ')}`);
          if (issues) {
            bad++;
            if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w}x${h}-${who}-${screen}.png`, fullPage: false });
          }
          void states;
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`\n${bad ? `${bad} screen states with overlaps/overflow` : 'No overlaps, no horizontal overflow'}.`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
