// Verifica dello script di Excel (power-automate/estrai-scadenze.ts):
//  1. compilazione TypeScript rigorosa e rispetto dei vincoli degli Office Scripts;
//  2. funzionamento di main() su un registro Excel simulato (duplicati, fuso orario, formati, celle sicure);
//  3. confronto con il motore di scadenzario.html sullo stesso insieme di testi (devono dare risultati identici).
// Uso: TSC=/percorso/tsc node verifica-script-excel.js     (richiede TypeScript e Playwright)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const { execFileSync } = require('child_process');
const QUI = __dirname, RADICE = path.resolve(QUI, '..');
const SRC = path.join(RADICE, 'power-automate', 'estrai-scadenze.ts');
const HTML = path.join(RADICE, 'scadenzario.html');
let falliti = 0;
const ok = (nome, cond, dettaglio) => { if (!cond) falliti++; console.log((cond ? 'OK   ' : 'FAIL ') + nome + (!cond && dettaglio ? '\n     ' + dettaglio : '')); };

/* ---------- 1. Compilazione e vincoli ---------- */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'script-excel-'));
try {
  execFileSync(process.env.TSC || 'tsc', ['--strict', '--noImplicitReturns', '--noFallthroughCasesInSwitch', '--target', 'ES2017', '--lib', 'ES2017',
    '--outDir', out, SRC, path.join(QUI, 'excelscript.d.ts')], { stdio: 'pipe' });
  ok('compilazione TypeScript rigorosa', true);
} catch (e) { ok('compilazione TypeScript rigorosa', false, String(e.stdout || e.message)); process.exit(1); }
const src = fs.readFileSync(SRC, 'utf8');
const codice = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const vincoli = [
  ['nessun tipo any', /:\s*any\b|<any>|\bas any\b/],
  ['nessun lookbehind nelle espressioni regolari', /\(\?<[=!]/],
  ['nessuna funzione non garantita (matchAll, Intl, toLocale…, padStart, eval)', /matchAll|\bIntl\b|toLocale|padStart|padEnd|\beval\(|new Function/],
  ['callback dei metodi degli array solo come arrow function', /\.(map|filter|forEach|some|every|find|findIndex|sort|reduce)\(\s*(function\b|[A-Za-z_$][\w$]*\s*[,)])/],
  ['nessuna chiamata di rete', /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/],
  ['nessun nome riservato (Excel, ExcelScript, console) usato come identificatore', /\b(const|let|var|function|class|interface)\s+(Excel|ExcelScript|console)\b/],
  ['nessuna API del browser non disponibile in Power Automate (TextEncoder, crypto, DOMParser)', /TextEncoder|TextDecoder|\bcrypto\b|DOMParser|\bwindow\.|\bdocument\./],
];
for (const [nome, re] of vincoli) { const m = re.exec(codice); ok(nome, !m, m && 'trovato: ' + m[0]); }

/* ---------- 2. main() su un registro simulato ---------- */
const js = fs.readFileSync(path.join(out, 'estrai-scadenze.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(js, ctx);

function cartellaSimulata(rigaVuotaIniziale) {
  const tabelle = {}, fogli = {}, grezzo = [];
  const comeExcel = v => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v); // l'apostrofo iniziale rende testo
  function tabella(intestazioni) {
    const t = { nome: '', intestazioni, righe: rigaVuotaIniziale ? [intestazioni.map(() => '')] : [] };
    return {
      _t: t,
      setName: n => { t.nome = n; tabelle[n] = api; },
      getRowCount: () => t.righe.length,
      getRangeBetweenHeaderAndTotal: () => ({
        getValues: () => t.righe.map(r => r.slice()),
        setValues: v => { if (v.length !== t.righe.length || v.some(r => r.length !== intestazioni.length)) throw new Error('dimensioni errate'); grezzo.push(...v); t.righe = v.map(r => r.map(comeExcel)); },
      }),
      getColumnByName: k => { const i = intestazioni.indexOf(k); return i < 0 ? undefined : { getRangeBetweenHeaderAndTotal: () => ({ getValues: () => t.righe.map(r => [r[i]]) }) }; },
      addRows: (i, v) => { if (i !== -1) throw new Error('indice inatteso'); for (const r of v) { if (r.length !== intestazioni.length) throw new Error('colonne errate'); grezzo.push(r); t.righe.push(r.map(comeExcel)); } },
    };
    var api;
  }
  const wb = {
    getTable: k => tabelle[k],
    getWorksheet: n => fogli[n],
    addWorksheet: n => {
      let intest = null;
      const f = {
        getRangeByIndexes: (r, c, rc, cc) => ({ setValues: v => { if (r !== 0 || c !== 0 || rc !== 1 || v[0].length !== cc) throw new Error('intestazione'); intest = v[0].slice(); }, getValues: () => [intest] }),
        addTable: (range, conIntest) => { if (!conIntest || !intest) throw new Error('tabella senza intestazione'); const t = tabella(intest); t.setName = (n => { t._t.nome = n; tabelle[n] = t; }); return t; },
      };
      fogli[n] = f; return f;
    },
  };
  return { wb, tabelle, grezzo, righe: () => (tabelle.RegistroScadenze ? tabelle.RegistroScadenze._t.righe : []) };
}

const M = JSON.parse(fs.readFileSync(path.join(QUI, 'email', 'messaggi.json'), 'utf8'));
const chiama = (cart, m, id) => ctx.main(cart.wb, m.oggetto, m.corpo, m.ricevuta, m.mittente, id);
const sintesi = ev => ev.map(e => `${e.inizio}→${e.fine}${e.tuttoIlGiorno ? ' (giornata)' : ''} | ${e.titolo}`);

for (const rigaVuota of [true, false]) {
  const etichetta = rigaVuota ? '[tabella creata con riga vuota]' : '[tabella creata senza righe]';
  const c = cartellaSimulata(rigaVuota);
  const e1 = chiama(c, M.avvocatura, 'id-1');
  ok(`${etichetta} Avvocatura: 2 eventi corretti`, JSON.stringify(sintesi(e1)) === JSON.stringify([
    '2026-12-10T00:00:00→2026-12-11T00:00:00 (giornata) | [Da verificare] Contenzioso: Ricorso TAR Lazio R.G. 4567/2026 – richiesta relazione',
    '2027-01-15T10:30:00→2027-01-15T11:30:00 | [Da verificare] Udienza: Ricorso TAR Lazio R.G. 4567/2026 – richiesta relazione']), JSON.stringify(sintesi(e1)));
  ok(`${etichetta} registro: 6 righe, nessuna riga vuota`, c.righe().length === 6 && c.righe().every(r => r[0] !== ''), c.righe().length);
  ok(`${etichetta} promemoria: 3 giorni prima alle 9 (giornata) e 3 giorni prima (con orario)`, e1[0].promemoriaMinuti === 3780 && e1[1].promemoriaMinuti === 4320);
  const e2 = chiama(c, M.avvocatura, 'id-1');
  ok(`${etichetta} stessa email una seconda volta: nessun duplicato`, e2.length === 0 && c.righe().slice(6).filter(r => r[6] === 'Già presente: non duplicato').length === 2);
  const e3 = chiama(c, M.risposta_con_citazione, 'id-2');
  ok(`${etichetta} risposta che cita la email: nessun duplicato`, e3.length === 0, JSON.stringify(sintesi(e3)));
}
{
  const c = cartellaSimulata(true);
  const e = chiama(c, M.pec_originale, 'id-3');
  ok('email HTML (entità, stili, immagini): riunione e pagamento; formula di rito esclusa', JSON.stringify(sintesi(e)) === JSON.stringify([
    '2026-12-03T15:00:00→2026-12-03T16:00:00 | [Da verificare] Riunione: Richiesta di pagamento spese legali – sentenza n. 812/2026',
    '2026-12-17T00:00:00→2026-12-18T00:00:00 (giornata) | [Da verificare] Liquidazione: Richiesta di pagamento spese legali – sentenza n. 812/2026']), JSON.stringify(sintesi(e)));
  ok('formula di rito registrata come "Non creato"', c.righe().some(r => /ammesso ricorso/.test(r[7]) && r[6] === 'Non creato: affidabilità bassa'));
  const s = chiama(c, M.sindacato, 'id-4');
  ok('interrogazione (HTML): lunedì prossimo e 5 giorni lavorativi', JSON.stringify(s.map(x => x.inizio)) === JSON.stringify(['2026-11-23T00:00:00', '2026-11-27T00:00:00']), JSON.stringify(s.map(x => x.inizio)));
  ok('testo della descrizione in HTML sicuro', s.every(x => !/<(?!br>)/.test(x.descrizione)) && /Frase: «/.test(s[0].descrizione));
}
{
  const c = cartellaSimulata(true);
  const ev = ctx.main(c.wb, '=HYPERLINK("http://esempio";"clic") <b>prova</b>', 'Mandami la scheda entro il 10/12/2026 <tag>', '2026-11-20T08:00:00Z', '+39 mittente', '@id');
  const riga = c.grezzo[c.grezzo.length - 1];
  ok('celle sicure: oggetto, mittente e ID che iniziano con = + @ restano testo', riga[9].startsWith("'=") && riga[10].startsWith("'+") && riga[13].startsWith("'@"), JSON.stringify(riga));
  ok('descrizione: i caratteri < > della email sono neutralizzati', ev.length === 1 && ev[0].descrizione.includes('&lt;b&gt;prova&lt;/b&gt;') && ev[0].descrizione.includes('&lt;tag&gt;'), ev[0] && ev[0].descrizione);
}
{
  const c = cartellaSimulata(true);
  const notte = ctx.main(c.wb, '', 'Inviami il file entro domani.', '2026-11-20T23:30:00+00:00', '', 'a');
  ok('fuso orario: email delle 00:30 ora italiana del 21/11 → "domani" = 22/11', notte.length === 1 && notte[0].inizio === '2026-11-22T00:00:00', notte[0] && notte[0].inizio);
  const estate = ctx.main(c.wb, '', 'Inviami il file entro domani.', '2026-07-31T22:30:00Z', '', 'b');
  ok('fuso orario estivo: email delle 00:30 del 1/8 → "domani" = 2/8', estate.length === 1 && estate[0].inizio === '2026-08-02T00:00:00', estate[0] && estate[0].inizio);
  const r = ms => { const d = ctx.oraDiRoma(Date.parse(ms)); return d.toISOString().slice(0, 16); };
  ok('ora legale: cambi del 29/3/2026 e del 25/10/2026 alle 01:00 UTC',
    r('2026-03-29T00:59:00Z') === '2026-03-29T01:59' && r('2026-03-29T01:00:00Z') === '2026-03-29T03:00'
    && r('2026-10-25T00:59:00Z') === '2026-10-25T02:59' && r('2026-10-25T01:00:00Z') === '2026-10-25T02:00',
    [r('2026-03-29T00:59:00Z'), r('2026-03-29T01:00:00Z'), r('2026-10-25T00:59:00Z'), r('2026-10-25T01:00:00Z')].join(' '));
  const vuota = ctx.main(c.wb, '', '', '', '', '');
  ok('email vuota o senza data: nessun errore, nessun evento', Array.isArray(vuota) && vuota.length === 0);
}
{ // regressione: righe consecutive senza riga vuota (la frase non deve inglobare la riga successiva)
  const t = 'Scadenze del mese:\n- relazione entro il 10/12/2026.\n- memoria entro il 20/12/2026.\nLa riunione si terrà il 3 dicembre 2026 alle 15.\nAvverso il presente provvedimento è ammesso ricorso al TAR entro 60 giorni.';
  const r = ctx.estrai(t, ctx.D(2026, 11, 20), '').map(c => [ctx.ymd(c.date), c.time, c.category, c.conf, c.ctx.text].join(' | '));
  ok('righe consecutive: ogni scadenza resta nella sua frase', JSON.stringify(r) === JSON.stringify([
    '2026-12-03 | 15:00 | riunione | alta | La riunione si terrà il 3 dicembre 2026 alle 15.',
    '2026-12-10 |  | scadenza | alta | - relazione entro il 10/12/2026.',
    '2026-12-20 |  | contenzioso | alta | - memoria entro il 20/12/2026.',
    '2027-01-19 |  | contenzioso | bassa | Avverso il presente provvedimento è ammesso ricorso al TAR entro 60 giorni.']), JSON.stringify(r, null, 1));
}

/* ---------- 3. Confronto con scadenzario.html ---------- */
const CORPUS = [
  ['Si prega di far pervenire il riscontro entro e non oltre il 30.11.2026.', '2026-11-20'],
  ["La scadenza per l'inserimento dei dati è il 15/12.", '2026-11-20'],
  ['Ai sensi del D.Lgs. 31 marzo 2001, n. 165, si comunica che...', '2026-11-20'],
  ['Il termine per il deposito della memoria scade il 2 gennaio 2027.', '2026-11-20'],
  ['Siete convocati per martedì 1° dicembre 2026, ore 11.', '2026-11-20'],
  ['Restituire il modulo entro fine mese.', '2026-11-20'],
  ['Inviare entro domani la scheda.', '2026-11-20'],
  ['Termine perentorio di 10 giorni dal ricevimento.', '2026-11-20'],
  ['Vista la nota del 3/11/2026, si chiede riscontro entro il 7 dic. 2026 alle 12:00.', '2026-11-20'],
  ['Ho 3 set di documenti da 12 pagine.', '2026-11-20'],
  ['Il PIAO va aggiornato entro il 31 gennaio.', '2026-11-20'],
  ['Udienza rinviata al 20/04/27.', '2026-11-20'],
  ['Mi serve la nota per il 5 dicembre.', '2026-11-20'],
  ['Il 10 dicembre scade il termine per le controdeduzioni.', '2026-11-20'],
  ['Avverso il presente provvedimento è ammesso ricorso al TAR entro 60 giorni.', '2026-11-20'],
  ['Riunione lunedì 7 dicembre 2026 alle 10 in sala B.', '2026-11-20'],
  ['Riunione giovedì 7 dicembre 2026 alle 10.', '2026-11-20'],
  ['Scadenza: entro il 25/04/2027.', '2026-11-20'],
  ['Inviare il prospetto entro 10 giorni lavorativi.', '2026-12-20'],
  ['Restituire firmato entro 2 mesi.', '2026-12-31'],
  ['Il ricorso va notificato entro 30 giorni.', '2026-07-20'],
  ['Ci aggiorniamo entro fine settimana.', '2026-11-21'],
  ['Mandami tutto entro venerdì prossimo.', '2026-11-20'],
  ["L'incontro del 3 febbraio è confermato.", '2026-11-20'],
  ['Da: Mario\nInviato: giovedì 19 novembre 2026 10:00\nA: Ufficio\nOggetto: R: relazione\nTi ricordo la scadenza del 30/11/2026.', '2026-11-20'],
  ['Il giorno gio 19 nov 2026 alle ore 10:00 Mario <m@x.it> ha scritto:\n> la relazione va inviata entro il 15 dicembre 2026', '2026-11-20'],
  ['Vedi legge 7 agosto 1990, n. 241.', '2026-11-20'],
  ['Entro e non oltre le ore 12:00 del 4 dicembre 2026 va trasmessa la scheda.', '2026-11-20'],
  ['giovedì 3 dicembre, ore 9.30, riunione di coordinamento', '2026-11-20'],
  ['lunedì15 dicembre', '2026-11-20'],
  ['Il pagamento della fattura entro 30 (trenta) giorni dalla ricezione.', '2026-11-17'],
  ['Le interrogazioni 4-01234 e 3-00456: elementi entro il 2/12', '2026-11-20'],
  ['entro il 29 giugno 2027 (festa del patrono)', '2026-11-20'],
  ['Tra il 1 e il 5 dicembre 2026 si terrà il corso.', '2026-11-20'],
  ['Scadenze del mese:\n- relazione entro il 10/12/2026.\n- memoria entro il 20/12/2026.\nLa riunione si terrà il 3 dicembre 2026 alle 15.\nAvverso il presente provvedimento è ammesso ricorso al TAR entro 60 giorni.', '2026-11-20'],
];
const [y0, m0, d0] = [0, 1, 2];
const motoreScript = (testo, ref, oggetto) => ctx.estrai(testo, ctx.D(+ref.slice(0, 4), +ref.slice(5, 7), +ref.slice(8, 10)), oggetto || '')
  .map(c => ({ d: ctx.ymd(c.date), t: c.time, cat: c.category, conf: c.conf, s: c.score, w: c.warns.join(' | ') }));

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + HTML);
  const motoreHtml = (testo, ref, oggetto) => page.evaluate(([t, r, o]) => {
    const p = n => String(n).padStart(2, '0');
    return Scadenzario.Extract.run(t, new Date(+r.slice(0, 4), +r.slice(5, 7) - 1, +r.slice(8, 10), 9), o || '')
      .map(c => ({ d: `${c.date.getFullYear()}-${p(c.date.getMonth() + 1)}-${p(c.date.getDate())}`, t: c.time, cat: c.category, conf: c.conf, s: c.score, w: c.warns.join(' | ') }));
  }, [testo, ref, oggetto]);
  let diversi = 0;
  const casi = CORPUS.map(([t, r]) => [t, r, '']);
  casi.push([M.avvocatura.corpo, '2026-11-18', M.avvocatura.oggetto]);
  // per le email HTML entrambi i motori ricevono lo stesso testo (convertito dallo script di Excel)
  for (const k of ['pec_originale', 'sindacato', 'risposta_con_citazione']) casi.push([ctx.htmlToText(M[k].corpo), M[k].ricevuta.slice(0, 10), M[k].oggetto]);
  for (const [t, r, o] of casi) {
    const a = JSON.stringify(motoreScript(t, r, o)), b = JSON.stringify(await motoreHtml(t, r, o));
    if (a !== b) { diversi++; console.log('     DIVERSO: ' + JSON.stringify(t.slice(0, 70)) + '\n       script: ' + a + '\n       html:   ' + b); }
  }
  ok(`stessi risultati di scadenzario.html su ${casi.length} testi (date, ore, categorie, punteggi, avvisi)`, diversi === 0);
  // conversione HTML→testo: lo script (senza browser) e scadenzario.html (DOM del browser) devono trovare le stesse scadenze
  for (const k of ['pec_originale', 'sindacato']) {
    const r = M[k].ricevuta.slice(0, 10);
    const a = motoreScript(ctx.htmlToText(M[k].corpo), r, M[k].oggetto).map(c => [c.d, c.t, c.cat, c.conf].join(' '));
    const domTesto = await page.evaluate(h => { const doc = new DOMParser().parseFromString(h, 'text/html'); return doc.body.innerText || doc.body.textContent; }, M[k].corpo);
    const b = (await motoreHtml(domTesto, r, M[k].oggetto)).map(c => [c.d, c.t, c.cat, c.conf].join(' '));
    ok(`conversione HTML→testo equivalente a quella del browser (${k})`, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' vs ' + JSON.stringify(b));
  }
  console.log('\nEsempio di conversione HTML→testo (risposta con citazione):\n' + ctx.htmlToText(M.risposta_con_citazione.corpo).split('\n').map(r => '   | ' + r).join('\n'));
  await browser.close();
  console.log(falliti ? `\n${falliti} verifiche NON superate` : '\nTutte le verifiche superate');
  process.exit(falliti ? 1 : 0);
})();
