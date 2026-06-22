// Capture PNG screenshots of the premium UI preview harness.
//
// Usage:  npm run preview:shots
//   which runs `PREVIEW=1 vite build` (adds preview.html to the build) and then
//   this script: it serves the built output with vite's preview server and walks
//   the real components in light/dark + a couple of tenant brand colors.
//
// Requires the Playwright browser once: `npx playwright install chromium`.
// Output: docs/screenshots/*.png
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/screenshots';
const VIEWPORT = { width: 1280, height: 1100 };

async function main() {
  await mkdir(OUT, { recursive: true });

  const server = await preview({ preview: { port: 4399, strictPort: false } });
  const base = server.resolvedUrls?.local?.[0];
  if (!base) throw new Error('Could not resolve preview server URL');
  const url = new URL('preview.html', base).href;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-action="open-dialog"]');

  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log(`✓ ${OUT}/${name}.png`);
  };

  // Light, default brand.
  await shot('gallery-light');

  // Dark.
  await page.click('[data-action="toggle-dark"]');
  await shot('gallery-dark');
  await page.click('[data-action="toggle-dark"]'); // back to light

  // A couple of tenant brand re-skins (proves "no hardcoded hex").
  for (const rgb of ['13 148 136', '234 88 12']) {
    await page.click(`[data-brand="${rgb}"]`);
    await shot(`gallery-brand-${rgb.replaceAll(' ', '_')}`);
  }
  await page.click('[data-brand="79 70 229"]'); // back to indigo

  // The real Dialog, opened.
  await page.click('[data-action="open-dialog"]');
  await page.waitForSelector('[role="dialog"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/dialog.png` });
  console.log(`✓ ${OUT}/dialog.png`);

  await browser.close();
  await server.httpServer.close();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
