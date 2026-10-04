// Renders the share card and the app icons from the built site.
// Usage: npm run build && npx astro preview & node pipeline/tools/og.mjs [http://localhost:4321]
// Needs Playwright (npx playwright, or a global install).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import { readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:4321';
const browser = await chromium.launch();

const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await card.goto(`${base}/og/`, { waitUntil: 'networkidle' });
await card.waitForTimeout(3500);
await card.locator('.card').screenshot({ path: 'public/og.png' });

const svg = readFileSync('public/favicon.svg', 'utf8');
for (const [file, size] of [['public/icon-512.png', 512], ['public/apple-touch-icon.png', 180]]) {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: file, omitBackground: true });
}
await browser.close();
writeFileSync('/dev/stdout', 'wrote public/og.png, public/icon-512.png, public/apple-touch-icon.png\n');
