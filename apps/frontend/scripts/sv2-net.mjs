// Debug: list requests made by one page over a window. Usage: node scripts/sv2-net.mjs <url> [seconds]
import { chromium } from 'playwright';
const [url, secs = '12'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const t0 = Date.now();
p.on('request', (r) => console.log(String(Date.now() - t0).padStart(6), r.method(), r.resourceType(), r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 110)));
p.on('requestfailed', (r) => console.log('FAILED', r.url().slice(0, 100), r.failure()?.errorText));
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(Number(secs) * 1000);
await b.close();
