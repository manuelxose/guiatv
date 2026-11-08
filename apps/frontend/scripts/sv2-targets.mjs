// Debug: list interactive elements under 24x24 CSS px with their class chain. Usage: node scripts/sv2-targets.mjs <url> [width]
import { chromium } from 'playwright';
const [url, w = '1440'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: Number(w), height: 900 } })).newPage();
await p.goto(url, { waitUntil: 'load' }); await p.waitForTimeout(2000);
console.log((await p.evaluate(() => [...document.querySelectorAll('a[href],button,[role=tab]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.width < 24 || r.height < 24); }).map((e) => `${e.tagName}.${e.className} | ${e.parentElement?.tagName}.${e.parentElement?.className} | ${e.textContent.trim().slice(0, 25)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`))).join('\n'));
await b.close();
