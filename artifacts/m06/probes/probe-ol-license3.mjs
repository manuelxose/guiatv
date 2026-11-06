// Try alternate routes / API surfaces for licence text
const cands = ['https://www.openligadb.de/lizenz.html','https://www.openligadb.de/Lizenz','https://api.openligadb.de/license.txt','https://www.openligadb.de/impressum','https://raw.githubusercontent.com/OpenLigaDB/OpenLigaDB-Samples/master/README.md'];
for (const u of cands) {
  try { const r = await fetch(u); const t = await r.text();
    const txt = t.replace(/<[^>]+>/g,'\n').replace(/\n{2,}/g,'\n').replace(/[ \t]+/g,' ').trim();
    console.log('===== ' + u + ' (' + r.status + ', ' + t.length + 'B) =====');
    console.log(txt.slice(0, 1800));
  } catch (e) { console.log(u, 'ERR', e.message); }
}
