const clean = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n').replace(/&middot;/g,'·').replace(/&auml;/g,'ä').replace(/&uuml;/g,'ü').replace(/&ouml;/g,'ö').replace(/&szlig;/g,'ß').replace(/&#\d+;/g,' ').replace(/&nbsp;/g,' ').replace(/\n{2,}/g, '\n').replace(/[ \t]+/g,' ').trim();
for (const u of ['https://www.openligadb.de/lizenz', 'https://www.openligadb.de/nutzungsbedingungen']) {
  try {
    const r = await fetch(u); const t = clean(await r.text());
    console.log('===== ' + u + ' (' + r.status + ') =====');
    console.log(t.slice(0, 4000));
  } catch (e) { console.log(u, 'ERR', e.message); }
}
