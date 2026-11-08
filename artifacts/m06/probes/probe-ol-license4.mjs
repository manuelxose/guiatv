const cands = ['https://www.openligadb.de/_blazor/initializers','https://www.openligadb.de/lizenz/blazor.server.js'];
const names = ['Lizenz','Nutzungsbedingungen','Impressum'];
for (const n of names) { const u = `https://www.openligadb.de/api/header/${n}`; try { const r = await fetch(u); console.log(u, r.status, (await r.text()).slice(0,200)); } catch(e) { console.log(u, 'ERR'); } }
// Render via public render endpoint
const render = 'https://www.openligadb.de/prerender/';
for (const p of ['lizenz','nutzungsbedingungen']) {
  try { const r = await fetch(render + p); const t = await r.text(); console.log('== ' + p + ' ' + r.status + ' ' + t.length); console.log(t.replace(/<[^>]+>/g,'\n').replace(/\n{2,}/g,'\n').trim().slice(0, 1200)); } catch (e) { console.log(p, 'ERR', e.message); }
}
