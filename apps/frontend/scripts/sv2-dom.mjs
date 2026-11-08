// Debug: is the shell DOM replaced after load? Usage: node scripts/sv2-dom.mjs <url> <selector>
import { chromium } from 'playwright';
const [url, sel] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
p.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 160)));
await p.addInitScript((s) => {
  window.__log = [];
  const t0 = performance.now();
  new MutationObserver((ms) => ms.forEach((m) => { [...m.removedNodes].forEach((n) => { if (n.nodeType === 1 && (n.matches?.(s) || n.querySelector?.(s))) window.__log.push(['removed', Math.round(performance.now() - t0), n.nodeName, String(n.className).slice(0, 40), (n.getAttribute?.('style') || '').slice(0, 60)]); }); [...m.addedNodes].forEach((n) => { if (n.nodeType === 1 && (n.matches?.(s) || n.querySelector?.(s))) window.__log.push(['added', Math.round(performance.now() - t0), n.nodeName]); }); if (m.type === 'attributes' && m.target.matches?.(s)) window.__log.push(['attr', Math.round(performance.now() - t0), m.attributeName, (m.target.getAttribute(m.attributeName) || '').slice(0, 60)]); })).observe(document, { childList: true, subtree: true, attributes: true });
}, sel);
await p.goto(url, { waitUntil: 'load' });
await p.waitForTimeout(3000);
console.log(JSON.stringify(await p.evaluate(() => window.__log)));
await b.close();
