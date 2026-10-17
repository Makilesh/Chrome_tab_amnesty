/**
 * Renders public/icons/icon.svg into the PNG sizes Chrome asks for (toolbar 16/32, extensions page
 * 48, Web Store and install dialog 128), with the same Chrome for Testing the checks use:
 *   npm run icons
 */
import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const DIR = resolve('public/icons');
const SIZES = [16, 32, 48, 128];

const exe = process.env.CHROME_PATH ?? [...globSync('chrome/*/chrome-*/chrome.exe'), ...globSync('chrome/*/chrome-*/chrome')].sort().at(-1);
if (!exe) throw new Error('Chrome for Testing not found. Run: npm run check:setup');
const svg = readFileSync(join(DIR, 'icon.svg'), 'utf8');
const browser = await puppeteer.launch({ executablePath: resolve(exe), headless: true });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: join(DIR, `icon-${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`public/icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
