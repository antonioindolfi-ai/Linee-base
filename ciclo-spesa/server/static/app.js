'use strict';
/* Ciclo della spesa - client. Parla solo con il server da cui è servito. */

let FASI = [], TIPI = {}, ALL = [], CAMPI = [], CONCLUSA = 4;

/* ---------------- utilità ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const EUR = new Intl.NumberFormat('it-IT', {style:'currency', currency:'EUR', useGrouping:'always'});
const eur = n => (n == null || n === '' || isNaN(n)) ? '—' : EUR.format(n);
const parseNum = s => { s = String(s ?? '').trim().replace(/\s|€/g, ''); if (!s) return null; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = Number(s); return isNaN(n) ? NaN : n; };
const numIn = n => (n == null || isNaN(n)) ? '' : String(n).replace('.', ',');
const today = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };
const parseD = s => { if (!s || typeof s !== 'string') return null; const [y, m, d] = s.split('-').map(Number); return (y && m && d) ? new Date(Date.UTC(y, m - 1, d)) : null; };
const addDays = (dt, n) => new Date(dt.getTime() + n * 864e5);
const fmtD = dt => dt ? dt.toLocaleDateString('it-IT', {timeZone:'UTC', day:'2-digit', month:'2-digit', year:'numeric'}) : '—';
const fmtTs = t => t ? new Date(t).toLocaleString('it-IT', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}) : '—';
const isoD = dt => dt.toISOString().slice(0, 10);
const days = (a, b) => Math.round((a - b) / 864e5);
const faseNome = f => f >= CONCLUSA ? 'Conclusa' : FASI[f]?.n || '—';
const RUOLI = {admin:'Amministratore', operatore:'Operatore', lettura:'Consultazione'};

let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4200); }

/* ---------------- stato ---------------- */
const S = {
  me: null, utenti: new Map(), pratiche: new Map(), rev: -1,
  view: 'cruscotto', open: null, det: null, newMode: false, viewFase: null,
  formDirty: false, advWarn: false, delAsk: false, sospAsk: false, busy: false,
  f: {q:'', tipo:'', fase:'aperte', stato:'', mie:false, eserc:''},
  segreto: null, offline: false, poll: null,
  modo: 'guida', wizIdx: null, wizSpiega: false, wizRiep: false, wizIntro: null,
};
const canWrite = () => S.me && (S.me.ruolo === 'admin' || S.me.ruolo === 'operatore');
const isAdmin = () => S.me && S.me.ruolo === 'admin';
function who(uid) {
  if (uid == null) return '<span class="mut">—</span>';
  const u = S.utenti.get(uid);
  return esc(u ? u.nome : 'Utente non più presente') + (uid === S.me?.id ? ' (tu)' : '');
}

/* ---------------- server ---------------- */
class ErrApi extends Error { constructor(code, msg) { super(msg); this.code = code; } }
async function api(method, path, body) {
  let r;
  try {
    r = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: method === 'GET' ? {} : {'Content-Type': 'application/json', 'X-CS': '1'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    setOffline(true);
    throw new ErrApi(0, 'Server non raggiungibile. Verifica la connessione alla rete interna.');
  }
  setOffline(false);
  let data = null; try { data = await r.json(); } catch { /* corpo vuoto */ }
  if (r.status === 401 && path !== '/api/login' && path !== '/api/password') { showLogin('La sessione è scaduta: accedi di nuovo.'); throw new ErrApi(401, data?.errore || 'Sessione scaduta.'); }
  if (!r.ok) throw new ErrApi(r.status, data?.errore || ('Errore ' + r.status));
  return data;
}
function setOffline(v) {
  if (S.offline === v) return; S.offline = v;
  if (v) banner('warn', '<b>Server non raggiungibile.</b> I dati mostrati potrebbero non essere aggiornati; riprovo in automatico.');
  else banner(canWrite() ? '' : 'info', canWrite() ? '' : 'Profilo di consultazione: puoi vedere le pratiche ma non modificarle.');
}
function banner(kind, html) { const b = $('#banner'); if (!html) { b.hidden = true; return; } b.className = 'banner ' + kind; b.innerHTML = `<div class="wrap">${html}</div>`; b.hidden = false; }

async function caricaTutto() {
  const [u, p] = await Promise.all([api('GET', '/api/utenti'), api('GET', '/api/pratiche')]);
  S.utenti = new Map(u.map(x => [x.id, x]));
  S.pratiche = new Map(p.pratiche.map(x => [x.id, x]));
  S.rev = p.rev;
  if (S.open && !S.pratiche.has(S.open)) { S.det = null; }
  renderAll();
}
async function caricaDettaglio(id) {
  try { S.det = await api('GET', '/api/pratiche/' + id); }
  catch (e) { if (e.code === 404) { S.det = null; S.pratiche.delete(id); } else if (e.code) toast(e.message); }
  if (S.open === id) { renderDrawer(false); renderAppr(); }
}
async function controllaNovita() {
  if (document.hidden || !S.me) return;
  try {
    const {rev} = await api('GET', '/api/rev');
    if (rev !== S.rev) { await caricaTutto(); if (S.open && !S.newMode) await caricaDettaglio(S.open); }
  } catch { /* gestito in api() */ }
}
async function modifica(id, body) {
  if (S.busy) return; S.busy = true;
  try {
    const d = await api('PATCH', '/api/pratiche/' + id, body);
    S.det = d; const {log, ...sintesi} = d; S.pratiche.set(id, sintesi);
    renderAll(); return true;
  } catch (e) {
    if (e.code) toast(e.message);
    await caricaDettaglio(id);
    if (e.code === 409) { await caricaTutto(); }
    return false;
  } finally { S.busy = false; }
}

/* ---------------- calcoli ---------------- */
function scadenza(p) {
  const m = parseD(p.scadenzaManuale); if (m) return {d: m, base: 'indicata a mano'};
  if (p.tipo === 'beni' && parseD(p.dataRicezione)) {
    const ric = parseD(p.dataRicezione), c = parseD(p.dataConformita); const b = (c && c > ric) ? c : ric;
    const n = p.termine60 ? 60 : 30;
    return {d: addDays(b, n), base: `${n} giorni dalla ${b === c ? 'verifica di conformità' : 'ricezione della fattura'} (D.Lgs. 231/2002)`};
  }
  if (p.tipo === 'legali' && parseD(p.dataNotifica)) return {d: addDays(parseD(p.dataNotifica), 120), base: '120 giorni dalla notifica del titolo esecutivo (art. 14 DL 669/1996)'};
  return null;
}
function residuo(p) { if ((p.fase ?? 0) >= CONCLUSA) return null; const s = scadenza(p); return s ? days(s.d, today()) : null; }
function termineRifiuto(p) {
  if (p.tipo !== 'beni' || (p.fase ?? 0) > 1 || p.check?.b_acc) return null;
  const r = parseD(p.dataRicezione); return r ? days(addDays(r, 15), today()) : null;
}
function scadChip(p) {
  if ((p.fase ?? 0) >= CONCLUSA) return '<span class="chip ok">Conclusa</span>';
  const r = residuo(p), s = scadenza(p); let h = '';
  if (p.sospesa) h += '<span class="chip warn">Sospesa</span>';
  if (r == null) return h;
  if (r < 0) h += `<span class="chip bad">Scaduta da ${-r} gg</span>`;
  else if (r <= 7) h += `<span class="chip warn">${r === 0 ? 'Scade oggi' : `Scade tra ${r} gg`}</span>`;
  else h += `<span class="chip">Scad. ${fmtD(s.d)}</span>`;
  return h;
}
function avanzamento(p, f = (p.fase ?? 0)) { const l = TIPI[p.tipo]?.check[Math.min(f, 3)] || []; return {fatti: l.filter(i => p.check?.[i.id]).length, tot: l.length}; }
function mancanti(p, f) { return (TIPI[p.tipo]?.check[f] || []).filter(i => i.r && !p.check?.[i.id]); }
const aperte = () => [...S.pratiche.values()].filter(p => (p.fase ?? 0) < CONCLUSA);
const somma = l => l.reduce((s, p) => s + (Number(p.importo) || 0), 0);
function perUrgenza(a, b) { const ra = residuo(a), rb = residuo(b); if (ra == null && rb == null) return (b.aggiornata || 0) - (a.aggiornata || 0); if (ra == null) return 1; if (rb == null) return -1; return ra - rb; }

/* ---------------- viste ---------------- */
function renderCruscotto() {
  const el = $('#v-cruscotto'); const ap = aperte();
  const scadute = ap.filter(p => { const r = residuo(p); return r != null && r < 0; });
  const insc = ap.filter(p => { const r = residuo(p); return r != null && r >= 0 && r <= 7; });
  const sosp = ap.filter(p => p.sospesa);
  const anno = String(new Date().getFullYear());
  const concl = [...S.pratiche.values()].filter(p => (p.fase ?? 0) >= CONCLUSA && String(p.esercizio || '') === anno);
  let h = `<div class="section-h"><h2>Cruscotto</h2><p>Pratiche aperte per fase. Apri una scheda per spuntare gli adempimenti e far avanzare la pratica.</p></div>
  <div class="stats">
    <button class="stat" data-goto="aperte"><span class="lbl">Aperte</span><span class="val num">${ap.length}</span><span class="sub num">${eur(somma(ap))}</span></button>
    <button class="stat ${scadute.length ? 'bad' : ''}" data-goto="scadute"><span class="lbl">Scadute</span><span class="val num">${scadute.length}</span><span class="sub">termine superato</span></button>
    <button class="stat ${insc.length ? 'warn' : ''}" data-goto="inscadenza"><span class="lbl">Entro 7 giorni</span><span class="val num">${insc.length}</span><span class="sub">da chiudere a breve</span></button>
    <button class="stat" data-goto="sospese"><span class="lbl">Sospese</span><span class="val num">${sosp.length}</span><span class="sub">in attesa di sblocco</span></button>
    <button class="stat" data-goto="concluse"><span class="lbl">Concluse ${anno}</span><span class="val num">${concl.length}</span><span class="sub num">${eur(somma(concl))}</span></button>
  </div>`;
  if (!S.pratiche.size) {
    h += `<div class="empty"><h3>Nessuna pratica registrata</h3>
      <p>Qui compariranno le pratiche di spesa dell'ufficio, divise nelle quattro fasi. Per iniziare:</p>
      <ol><li>premi <b>Nuova pratica</b> e scegli la tipologia (beni e servizi, spese legali, compensi organi, altra spesa);</li>
      <li>spunta gli adempimenti man mano che li completi: la lista cambia in base alla tipologia;</li>
      <li>registra le date chiave (ricezione della fattura, notifica del titolo): le scadenze si calcolano da sole.</li></ol>
      <div class="actions w"><button class="btn primary" data-act="new">+ Nuova pratica</button><button class="btn" data-act="esempio">Crea una pratica di esempio</button></div></div>`;
  } else {
    h += '<div class="board">';
    FASI.forEach((f, i) => {
      const items = ap.filter(p => (p.fase ?? 0) === i).sort(perUrgenza);
      h += `<div class="col"><div class="col-h"><span class="n">${i + 1}</span><h3>${esc(f.n)}</h3><span class="meta"><span class="num">${items.length}</span> pratiche<br><span class="num">${eur(somma(items))}</span></span></div>`;
      h += items.length ? items.map(card).join('') : '<div class="col-empty">Nessuna pratica in questa fase.</div>';
      h += '</div>';
    });
    h += '</div>';
  }
  el.innerHTML = h;
}
function card(p) {
  const a = avanzamento(p); const rif = termineRifiuto(p);
  const df = (p.fase ?? 0) < CONCLUSA ? (TIPI[p.tipo]?.check[p.fase ?? 0] || []).filter(i => p.dafare?.[i.id] && !p.check?.[i.id]).length : 0;
  return `<button class="card" data-open="${esc(p.id)}">
    <div class="card-top"><span class="tag">${esc(TIPI[p.tipo]?.n || '')}</span>${p.esempio ? '<span class="chip ex">Esempio</span>' : ''}${scadChip(p)}${rif != null && rif >= 0 && rif <= 5 ? `<span class="chip warn">Esito fattura: ${rif} gg</span>` : ''}${df ? `<span class="chip acc">${df} da fare</span>` : ''}</div>
    <div class="card-title">${esc(p.oggetto || '(senza oggetto)')}</div>
    ${p.beneficiario ? `<div class="card-sub">${esc(p.beneficiario)}</div>` : ''}
    <div class="card-foot"><span class="amt num">${eur(p.importo)}</span><progress class="prog" max="${a.tot || 1}" value="${a.fatti}" title="Adempimenti della fase"></progress><span class="num">${a.fatti}/${a.tot}</span></div>
  </button>`;
}

function filtrate() {
  const f = S.f, q = f.q.trim().toLowerCase();
  return [...S.pratiche.values()].filter(p => {
    const fase = p.fase ?? 0, r = residuo(p);
    if (f.tipo && p.tipo !== f.tipo) return false;
    if (f.fase === 'aperte' && fase >= CONCLUSA) return false;
    if (f.fase !== '' && f.fase !== 'aperte' && String(fase) !== f.fase) return false;
    if (f.stato === 'scadute' && !(r != null && r < 0)) return false;
    if (f.stato === 'inscadenza' && !(r != null && r >= 0 && r <= 7)) return false;
    if (f.stato === 'sospese' && !p.sospesa) return false;
    if (f.mie && p.assegnatario !== S.me.id) return false;
    if (f.eserc && String(p.esercizio || '') !== f.eserc) return false;
    if (q) { const hay = [p.oggetto, p.beneficiario, p.cfpiva, p.cig, p.cup, p.impegno, p.op, p.fattura, p.capitolo, p.titolo, p.rg, p.istituzione, p.note].join(' ').toLowerCase(); if (!hay.includes(q)) return false; }
    return true;
  }).sort(perUrgenza);
}
function renderPratiche() {
  const el = $('#v-pratiche'); const f = S.f;
  const anni = [...new Set([...S.pratiche.values()].map(p => String(p.esercizio || '')).filter(Boolean))].sort().reverse();
  if (!$('#f-q', el)) {
    el.innerHTML = `<div class="section-h"><h2>Pratiche</h2><p>Ordinate per scadenza. Cerca per oggetto, beneficiario, CIG, impegno, numero di fattura o di ordine.</p></div>
    <div class="filters">
      <input type="search" id="f-q" placeholder="Cerca…" aria-label="Cerca">
      <select id="f-tipo" aria-label="Tipologia"><option value="">Tutte le tipologie</option>${ALL.map(k => `<option value="${k}">${esc(TIPI[k].n)}</option>`).join('')}</select>
      <select id="f-fase" aria-label="Fase"><option value="aperte">Solo aperte</option><option value="">Tutte le fasi</option>${FASI.map((x, i) => `<option value="${i}">${i + 1}. ${esc(x.n)}</option>`).join('')}<option value="${CONCLUSA}">Concluse</option></select>
      <select id="f-stato" aria-label="Stato"><option value="">Qualsiasi scadenza</option><option value="scadute">Scadute</option><option value="inscadenza">Entro 7 giorni</option><option value="sospese">Sospese</option></select>
      <select id="f-eserc" aria-label="Esercizio"></select>
      <label class="btn sm" for="f-mie"><input type="checkbox" id="f-mie"> Assegnate a me</label>
      <button class="btn sm" id="f-csv" type="button">Esporta CSV</button>
    </div><div id="f-out"></div>`;
  }
  $('#f-q').value = f.q; $('#f-tipo').value = f.tipo; $('#f-fase').value = f.fase; $('#f-stato').value = f.stato; $('#f-mie').checked = f.mie;
  $('#f-eserc').innerHTML = '<option value="">Tutti gli esercizi</option>' + anni.map(a => `<option>${esc(a)}</option>`).join(''); $('#f-eserc').value = f.eserc;
  const list = filtrate();
  let h = `<p class="cnt"><span class="num">${list.length}</span> pratiche · totale <span class="num">${eur(somma(list))}</span></p>`;
  if (!list.length) h += '<div class="empty"><h3>Nessuna pratica corrisponde ai filtri</h3><p>Allarga la ricerca o scegli “Tutte le fasi”.</p></div>';
  else {
    h += '<div class="tbl-wrap"><table><thead><tr><th>Fase</th><th>Oggetto e beneficiario</th><th>Tipologia</th><th class="r">Importo</th><th>Esercizio · capitolo</th><th>Scadenza</th><th>Assegnata a</th><th>Aggiornata</th></tr></thead><tbody>';
    h += list.map(p => { const a = avanzamento(p), s = scadenza(p), fase = p.fase ?? 0; return `<tr class="click" data-open="${esc(p.id)}" tabindex="0">
      <td><b>${fase < CONCLUSA ? (fase + 1) + '. ' : ''}${faseNome(fase)}</b><br><span class="num mut">${fase < CONCLUSA ? `${a.fatti}/${a.tot}` : ''}</span></td>
      <td class="wide"><b>${esc(p.oggetto || '(senza oggetto)')}</b>${p.esempio ? ' <span class="chip ex">Esempio</span>' : ''}<br><span class="mut">${esc(p.beneficiario || '')}</span></td>
      <td>${esc(TIPI[p.tipo]?.n || '')}</td>
      <td class="r num">${eur(p.importo)}</td>
      <td>${esc(p.esercizio || '—')} · ${esc(p.capitolo || '—')}</td>
      <td>${scadChip(p)}${s && fase < CONCLUSA ? `<br><span class="num mut sm">${fmtD(s.d)}</span>` : ''}</td>
      <td>${who(p.assegnatario)}</td>
      <td class="num sm">${fmtTs(p.aggiornata)}</td></tr>`; }).join('');
    h += '</tbody></table></div>';
  }
  $('#f-out').innerHTML = h;
}

function renderGuida() {
  const el = $('#v-guida'); if (el.dataset.done) return; el.dataset.done = '1';
  el.innerHTML = `<div class="section-h"><h2>Guida operativa</h2><p>Le quattro fasi, i termini da presidiare e le liste di controllo per tipologia.</p></div>
  <div class="guide"><article>
    ${FASI.map((f, i) => `<div class="ph"><h3><span class="chip acc num">${i + 1}</span>${esc(f.n)}</h3><p>${esc(f.d)}</p></div>`).join('')}
    <p class="note">Le liste di controllo sono un supporto operativo e non sostituiscono la disciplina vigente, le circolari della Ragioneria generale dello Stato e le indicazioni dell'Ufficio centrale di bilancio. Gli adempimenti segnati come obbligatori sono quelli senza i quali la pratica normalmente non può passare alla fase successiva; l'applicazione consente comunque di avanzare, annotandolo nella cronologia. Le liste si modificano nel file <code>static/modello.json</code> sul server.</p>
    <h3>Liste di controllo per tipologia</h3><p class="mut">Apri una voce per leggere come si fa. Sono le stesse spiegazioni della risposta «No, spiegami» nella procedura guidata.</p>
    ${ALL.map(k => `<details class="tipo"><summary>${esc(TIPI[k].n)} <span>· ${esc(TIPI[k].s)}</span></summary>
      ${TIPI[k].check.map((l, i) => `<p><b>${i + 1}. ${esc(FASI[i].n)}</b></p>${TIPI[k].intro?.[i] ? `<p class="mut">${esc(TIPI[k].intro[i].come)}</p>` : ''}<ul class="tlist">${l.map(it => `<li><details class="voce"><summary>${esc(it.t)}${it.r ? '' : ' <em>(se pertinente)</em>'}${it.ref ? ` <em>· ${esc(it.ref)}</em>` : ''}</summary>${aiutoHtml(it)}</details></li>`).join('')}</ul>`).join('')}
    </details>`).join('')}
  </article>
  <aside><h3>Termini da presidiare</h3><div class="terms">
    <div><b>15 giorni</b><span>dalla ricezione su SdI per accettare o rifiutare la fattura elettronica. Il rifiuto è ammesso solo nei casi previsti dal DM MEF 132/2020.</span></div>
    <div><b>30 giorni</b><span>per pagare le fatture commerciali, dalla ricezione della fattura o, se prevista, dalla conclusione della verifica di conformità. Fino a 60 giorni solo se pattuito espressamente (D.Lgs. 231/2002, art. 4).</span></div>
    <div><b>120 giorni</b><span>di validità del DURC online.</span></div>
    <div><b>120 giorni</b><span>dalla notifica del titolo esecutivo prima che il creditore possa avviare l'esecuzione forzata contro l'amministrazione (art. 14 DL 669/1996).</span></div>
    <div><b>Oltre 5.000 €</b><span>verifica degli inadempimenti presso Agenzia delle Entrate-Riscossione prima del pagamento (art. 48-bis DPR 602/1973).</span></div>
  </div>
  <p class="note mt12">Le scadenze nelle schede si calcolano dalle date inserite nei dati della pratica: ricezione su SdI e verifica di conformità per beni e servizi, notifica del titolo per le spese legali. Per le altre tipologie si indica la scadenza a mano.</p>
  </aside></div>`;
}

async function renderUtenti() {
  const el = $('#v-utenti'); if (!isAdmin()) { el.innerHTML = ''; return; }
  const sec = S.segreto ? `<div class="secret" role="status"><b>${esc(S.segreto.titolo)}</b><span>Comunica questa password provvisoria all'interessato per un canale riservato. Al primo accesso dovrà sceglierne una personale. Non sarà più mostrata.</span><code>${esc(S.segreto.pw)}</code><div class="actions tight"><button class="btn sm" data-act="copia" type="button">Copia</button><button class="btn sm ghost" data-act="chiudi-segreto" type="button">Fatto</button></div></div>` : '';
  const rows = [...S.utenti.values()].map(u => `<tr>
    <td><b>${esc(u.nome)}</b>${u.id === S.me.id ? ' <span class="mut">(tu)</span>' : ''}<br><span class="mut num sm">${esc(u.username || '')}</span></td>
    <td><select class="inp" data-ruolo="${u.id}" aria-label="Ruolo di ${esc(u.nome)}" ${u.id === S.me.id ? 'disabled' : ''}>${Object.entries(RUOLI).map(([k, v]) => `<option value="${k}" ${u.ruolo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td>${u.attivo ? '<span class="chip ok">Attiva</span>' : '<span class="chip">Disattivata</span>'}</td>
    <td><div class="actions tight">${u.id !== S.me.id ? `<button class="btn sm" data-attiva="${u.id}" data-val="${u.attivo ? 0 : 1}" type="button">${u.attivo ? 'Disattiva' : 'Riattiva'}</button><button class="btn sm" data-reset="${u.id}" type="button">Reimposta password</button>` : ''}</div></td></tr>`).join('');
  el.innerHTML = `<div class="section-h"><h2>Utenti e registro</h2><p>Gestisci chi accede all'applicazione e consulta il registro di tutte le operazioni.</p></div>
  <div class="grid2"><div class="panel"><h3>Utenze</h3>${sec}
    <div class="tbl-wrap"><table class="compact"><thead><tr><th>Utente</th><th>Ruolo</th><th>Stato</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Amministratore: tutto, compresa la gestione delle utenze e l'eliminazione delle pratiche. Operatore: crea e aggiorna le pratiche. Consultazione: sola lettura.</p></div>
  <form class="panel" id="f-utente"><h3>Nuova utenza</h3>
    <div class="fld"><label for="u-nome">Nome e cognome</label><input id="u-nome" required maxlength="80"></div>
    <div class="fld"><label for="u-user">Nome utente</label><input id="u-user" required pattern="[A-Za-z0-9._\\-]{3,40}" placeholder="es. m.rossi"><span class="h">3-40 caratteri: lettere, cifre, punto, trattino.</span></div>
    <div class="fld"><label for="u-ruolo">Ruolo</label><select id="u-ruolo">${Object.entries(RUOLI).map(([k, v]) => `<option value="${k}" ${k === 'operatore' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <button class="btn primary" type="submit">Crea utenza</button></form></div>
  <div class="panel mt12"><h3>Registro delle operazioni</h3><p class="mut sm">Ultime 500 operazioni, comprese quelle sulle utenze e sulle pratiche eliminate.</p><div class="tbl-wrap"><table class="compact"><thead><tr><th>Data e ora</th><th>Utente</th><th>Pratica</th><th>Operazione</th></tr></thead><tbody id="reg-body"><tr><td colspan="4" class="mut">Caricamento…</td></tr></tbody></table></div></div>`;
  try {
    const reg = await api('GET', '/api/registro');
    const body = $('#reg-body'); if (!body) return;
    body.innerHTML = reg.map(r => { const p = r.pratica_id && S.pratiche.get(r.pratica_id); return `<tr><td class="num sm">${fmtTs(r.ts * 1000)}</td><td>${r.utente_id == null ? '<span class="mut">sistema</span>' : who(r.utente_id)}</td><td>${p ? `<button class="btn sm ghost" data-open="${esc(p.id)}" type="button">${esc((p.oggetto || '').slice(0, 60))}</button>` : `<span class="mut num sm">${esc(r.pratica_id || '')}</span>`}</td><td>${esc(r.msg)}</td></tr>`; }).join('') || '<tr><td colspan="4" class="mut">Nessuna operazione.</td></tr>';
  } catch (e) { if (e.code) toast(e.message); }
}

/* ---------------- pannello pratica ---------------- */
function openDrawer(id) { S.modo = 'guida'; S.wizIdx = null; S.wizSpiega = false; S.wizRiep = false; S.wizIntro = null; S.open = id; S.newMode = false; S.formDirty = false; S.advWarn = false; S.delAsk = false; S.sospAsk = false; S.det = null; const p = S.pratiche.get(id); S.viewFase = Math.min(p?.fase ?? 0, 3); showDrawer(); renderDrawer(true); caricaDettaglio(id); }
function openNew() { S.open = null; S.newMode = true; showDrawer(); renderNew(); }
function showDrawer() { $('#drawer').hidden = false; $('#scrim').hidden = false; document.body.style.overflow = 'hidden'; }
function closeDrawer() { chiudiAppr(); S.open = null; S.newMode = false; S.det = null; $('#drawer').hidden = true; $('#scrim').hidden = true; document.body.style.overflow = ''; }

function renderNew() {
  const anno = new Date().getFullYear();
  $('#drawer').innerHTML = `<div class="dr-head"><div class="t"><span class="tag">Nuova pratica</span><h2 id="dr-title">Registra una spesa</h2></div><button class="btn ghost" data-act="close" aria-label="Chiudi">✕</button></div>
  <div class="dr-body"><form class="box form" id="new-form">
    <div class="tipi" role="radiogroup" aria-label="Tipologia">${ALL.map((k, i) => `<label><input type="radio" name="tipo" value="${k}" ${i === 0 ? 'checked' : ''}><span><b>${esc(TIPI[k].n)}</b><span>${esc(TIPI[k].s)}</span></span></label>`).join('')}</div>
    <div class="fld full"><label for="n-oggetto">Oggetto</label><input id="n-oggetto" required maxlength="500" placeholder="Es. Fornitura di materiale di cancelleria"></div>
    <div class="fld"><label for="n-benef">Beneficiario</label><input id="n-benef" maxlength="500"></div>
    <div class="fld"><label for="n-imp">Importo totale (€)</label><input id="n-imp" inputmode="decimal" placeholder="0,00"></div>
    <div class="fld"><label for="n-es">Esercizio</label><input id="n-es" value="${anno}"></div>
    <div class="fld"><label for="n-cap">Capitolo / piano gestionale</label><input id="n-cap" maxlength="500"></div>
    <div class="actions span"><button class="btn primary" type="submit">Crea pratica</button><button class="btn" type="button" data-act="close">Annulla</button></div>
  </form></div>`;
  $('#n-oggetto').focus();
}

function renderDrawer(full) {
  const id = S.open, d = $('#drawer');
  const p = S.det || S.pratiche.get(id);
  if (!p) { d.innerHTML = '<div class="dr-head"><div class="t"><h2 id="dr-title">Pratica non più disponibile</h2><p class="mut">È stata eliminata da un collega.</p></div><button class="btn ghost" data-act="close" aria-label="Chiudi">✕</button></div>'; return; }
  if (full || !$('#dr-step', d)) {
    d.innerHTML = `<div class="dr-head" id="dr-head"></div><div class="dr-body">
      <div class="box"><div id="dr-step"></div></div>
      <div class="box" id="dr-phase"></div>
      <div class="box" id="dr-sit"></div>
      <form class="box" id="dr-form"></form>
      <div class="box"><h3>Cronologia</h3><ul class="log" id="dr-log"></ul></div>
      <div class="box adm" id="dr-del"></div></div>`;
  }
  const fase = p.fase ?? 0, s = scadenza(p), r = residuo(p);
  $('#dr-head').innerHTML = `<div class="t"><span class="tag">${esc(TIPI[p.tipo]?.n || '')} · ${faseNome(fase)}</span><h2 id="dr-title">${esc(p.oggetto || '(senza oggetto)')}</h2>
    <div class="chips">${p.esempio ? '<span class="chip ex">Esempio</span>' : ''}${scadChip(p)}<span class="chip num">${eur(p.importo)}</span>${p.beneficiario ? `<span class="chip">${esc(p.beneficiario)}</span>` : ''}</div></div>
    <button class="btn ghost" data-act="close" aria-label="Chiudi">✕</button>`;

  const vf = S.viewFase ?? Math.min(fase, 3);
  $('#dr-step').innerHTML = `<div class="stepper">${FASI.map((f, i) => { const cls = i < fase ? 'done' : i === fase ? 'cur' : ''; return `<button class="step ${cls} ${i === vf ? 'sel' : ''}" data-vf="${i}" type="button"><span class="dot">${i < fase ? '✓' : i + 1}</span><span class="lb">${esc(f.n)}</span></button>`; }).join('')}
    <div class="step ${fase >= CONCLUSA ? 'done' : ''}"><span class="dot">${fase >= CONCLUSA ? '✓' : '●'}</span><span class="lb">Conclusa</span></div></div>`;

  const dis = canWrite() && S.det ? '' : 'disabled';
  const guidata = S.modo === 'guida' && vf === Math.min(fase, 3) && fase < CONCLUSA;
  if (!guidata) S.introAperta = false;
  $('#dr-phase').classList.toggle('guida', guidata);
  $('#dr-phase').innerHTML = guidata ? renderGuidata(p) : renderElenco(p, vf);

  const rif = termineRifiuto(p);
  const assegnabili = [...S.utenti.values()].filter(u => u.attivo && u.ruolo !== 'lettura');
  let si = `<h3>Situazione</h3><dl class="dl">
    <dt>Scadenza</dt><dd>${s ? `<b class="num">${fmtD(s.d)}</b>${r != null ? ` · ${r < 0 ? `<span class="txt-bad">scaduta da ${-r} giorni</span>` : r === 0 ? 'oggi' : `tra ${r} giorni`}` : ''}<br><span class="mut sm">${esc(s.base)}</span>` : '<span class="mut">Non calcolabile: inserisci nei dati la data di ricezione su SdI, la notifica del titolo o una scadenza manuale.</span>'}</dd>
    ${rif != null ? `<dt>Esito fattura</dt><dd>${rif < 0 ? `<span class="txt-bad">termine di 15 giorni superato da ${-rif} gg</span>` : `accettare o rifiutare entro ${rif} giorni`}</dd>` : ''}
    <dt>Assegnata a</dt><dd>${canWrite() ? `<select class="inp" id="as-sel" aria-label="Assegnatario" ${dis}><option value="">Nessuno</option>${assegnabili.map(u => `<option value="${u.id}" ${p.assegnatario === u.id ? 'selected' : ''}>${esc(u.nome)}${u.id === S.me.id ? ' (tu)' : ''}</option>`).join('')}${p.assegnatario != null && !assegnabili.some(u => u.id === p.assegnatario) ? `<option value="${p.assegnatario}" selected>${who(p.assegnatario)}</option>` : ''}</select>` : who(p.assegnatario)}</dd>
    <dt>Stato</dt><dd>${p.sospesa ? `<span class="chip warn">Sospesa</span> ${esc(p.motivoSospensione || '')}` : 'Regolare'}</dd>
  </dl>`;
  if (fase < CONCLUSA) {
    if (p.sospesa) si += `<div class="actions w"><button class="btn sm" data-act="riprendi" type="button" ${dis}>Riprendi la pratica</button></div>`;
    else if (S.sospAsk) si += `<div class="warnbox w"><label for="sosp-m"><b>Motivo della sospensione</b></label><input class="inp full-w mt6" id="sosp-m" maxlength="300" placeholder="Es. DURC irregolare, contestazione della fornitura, nota di credito attesa"><div class="actions"><button class="btn sm" data-act="sosp-ok" type="button">Sospendi</button><button class="btn sm ghost" data-act="sosp-no" type="button">Annulla</button></div></div>`;
    else si += `<div class="actions w"><button class="btn sm" data-act="sosp" type="button" ${dis}>Sospendi la pratica</button></div>`;
  }
  $('#dr-sit').innerHTML = si;

  if (full || !S.formDirty) renderForm(p);

  $('#dr-log').innerHTML = S.det ? (S.det.log.map(l => `<li><time class="num">${fmtTs(l.ts * 1000)}</time><span>${esc(l.msg)} <span class="mut">· ${l.utente_id == null ? 'sistema' : who(l.utente_id)}</span></span></li>`).join('') || '<li><span>Nessuna attività.</span></li>') : '<li><span class="mut">Caricamento…</span></li>';
  $('#dr-del').innerHTML = S.delAsk ? '<h3>Eliminare la pratica?</h3><p class="ph-desc">L\'eliminazione è definitiva per tutti i colleghi. Nel registro delle operazioni resta traccia dell\'eliminazione.</p><div class="actions"><button class="btn danger" data-act="del-ok" type="button">Elimina definitivamente</button><button class="btn" data-act="del-no" type="button">Annulla</button></div>' : '<button class="btn sm danger" data-act="del" type="button">Elimina pratica</button>';
}

/* ---------------- procedura guidata ---------------- */
const statoVoce = (p, it) => p.check?.[it.id] ? 'fatto' : p.dafare?.[it.id] ? 'dafare' : 'aperto';
function aiutoHtml(it) {
  const h = it.aiuto; if (!h) return '<p class="mut">Spiegazione non disponibile per questo adempimento.</p>';
  return `<div class="aiuto">
    <p>${esc(h.cosa)}</p>
    <h4>Come si fa</h4><ol>${h.passi.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    ${h.dove ? `<h4>Dove</h4><p>${esc(h.dove)}</p>` : ''}
    ${h.attenzione ? `<div class="attn"><b>Attenzione.</b> ${esc(h.attenzione)}</div>` : ''}
    ${it.ref ? `<p class="mut sm">Riferimento: ${esc(it.ref)}</p>` : ''}
  </div>`;
}
function avanzaHtml(p) {
  const fase = p.fase ?? 0, miss = mancanti(p, fase), dis = canWrite() && S.det ? '' : 'disabled';
  let h = `<div class="actions w"><button class="btn primary" data-act="adv" type="button" ${dis}>${fase === 3 ? 'Concludi la pratica' : `Passa a ${esc(FASI[fase + 1].n)}`}</button>${fase > 0 ? `<button class="btn" data-act="back" type="button" ${dis}>Torna a ${esc(FASI[fase - 1].n)}</button>` : ''}</div>`;
  if (S.advWarn && miss.length) h += `<div class="warnbox w"><b>Mancano ${miss.length} adempimenti obbligatori:</b><ul>${miss.map(i => `<li>${esc(i.t)}</li>`).join('')}</ul><div class="actions tight"><button class="btn sm" data-act="adv-force" type="button">Avanza comunque</button><button class="btn sm ghost" data-act="adv-cancel" type="button">Annulla</button></div></div>`;
  return h;
}
function renderGuidata(p) {
  const fase = p.fase ?? 0, lst = TIPI[p.tipo].check[fase];
  const n = {fatto: 0, dafare: 0, aperto: 0}; lst.forEach(it => n[statoVoce(p, it)]++);
  const ro = canWrite() && S.det ? '' : 'disabled';
  let idx = S.wizIdx ?? lst.findIndex(it => statoVoce(p, it) === 'aperto');
  const iniziata = n.fatto + n.dafare > 0;
  S.introAperta = S.wizIntro === true || (S.wizIntro == null && !iniziata && !S.wizRiep && S.wizIdx == null);
  if (S.introAperta) return renderIntro(p, lst, iniziata);
  let h = `<div class="g-head"><span class="tag">Procedura guidata · fase ${fase + 1} di ${FASI.length}</span><h3 class="g-title">${esc(FASI[fase].n)}</h3>
    <p class="ph-desc">${esc(FASI[fase].d)}</p>
    <div class="g-prog"><progress class="prog wide" max="${lst.length}" value="${n.fatto}"></progress><span class="sm"><b class="num">${n.fatto}</b> fatti · <b class="num">${n.dafare}</b> da fare · <b class="num">${n.aperto}</b> senza risposta</span></div></div>`;

  if (S.wizRiep || idx < 0) {
    const miss = mancanti(p, fase);
    h += `<div class="riep"><h4>Riepilogo della fase</h4><ul>${lst.map((it, i) => { const st = statoVoce(p, it), c = p.check?.[it.id];
      return `<li class="r-${st}"><span class="chip ${st === 'fatto' ? 'ok' : st === 'dafare' ? 'warn' : ''}">${st === 'fatto' ? 'Fatto' : st === 'dafare' ? 'Da fare' : 'Senza risposta'}</span>
        <div><span>${esc(it.t)}</span>${it.r ? '<span class="req">obbligatorio</span>' : ''}${c ? `<span class="by">il ${fmtTs(c.at)} da ${who(c.by)}</span>` : ''}
        <div class="actions tight r-act">${st !== 'fatto' ? `<button class="btn sm" data-wiz="si" data-i="${i}" type="button" ${ro}>L'ho fatto</button>` : ''}<button class="btn sm ghost" data-appr="${fase}:${i}" type="button">Approfondisci</button></div></div></li>`; }).join('')}</ul>
      ${miss.length ? `<p class="warnbox">Per passare alla fase successiva mancano <b>${miss.length}</b> adempimenti obbligatori. Puoi completarli ora oppure avanzare comunque: resterà annotato nella cronologia.</p>` : '<p class="okbox">Tutti gli adempimenti obbligatori di questa fase sono fatti.</p>'}
      ${avanzaHtml(p)}
      ${n.aperto ? '<div class="actions"><button class="btn ghost" data-wiz="domande" type="button">Riprendi le domande</button></div>' : ''}</div>`;
    return h + `<div class="g-foot"><button class="btn sm ghost" data-wiz="intro" type="button">Come si svolge questa fase</button><button class="btn sm ghost" data-wiz="elenco" type="button">Vedi l'elenco completo della fase</button></div>`;
  }

  const it = lst[idx], st = statoVoce(p, it), c = p.check?.[it.id];
  h += `<div class="q" role="group" aria-labelledby="q-item">
    <div class="q-n">Domanda <span class="num">${idx + 1}</span> di <span class="num">${lst.length}</span> · ${it.r ? 'obbligatoria' : 'se pertinente'}</div>
    <p class="q-ask">Hai fatto questo?</p>
    <p class="q-item" id="q-item">${esc(it.t)}</p>
    ${it.ref ? `<p class="q-ref">${esc(it.ref)}</p>` : ''}
    <p class="q-deep"><button class="lnk" data-appr="${fase}:${idx}" type="button">Approfondisci questa sottofase ›</button></p>
    ${st === 'fatto' ? `<p class="q-now">Già segnato come fatto il ${fmtTs(c.at)} da ${who(c.by)}.</p>` : st === 'dafare' ? '<p class="q-now">Segnato come da fare.</p>' : ''}
    ${S.wizSpiega ? `<div class="spiega">${aiutoHtml(it)}
        <div class="actions"><button class="btn primary" data-wiz="si" type="button" ${ro}>Fatto, andiamo avanti</button><button class="btn" data-wiz="so" type="button" ${ro}>Lo farò dopo</button></div></div>`
      : `<div class="q-btns"><button class="btn primary" data-wiz="si" type="button" ${ro}>Sì</button><button class="btn" data-wiz="so" type="button" ${ro}>No, ma so come si fa</button><button class="btn" data-wiz="spiega" type="button">No, spiegami</button></div>`}
  </div>
  <div class="g-foot"><button class="btn sm ghost" data-wiz="prev" type="button" ${idx === 0 ? 'disabled' : ''}>← Domanda precedente</button><button class="btn sm ghost" data-wiz="riep" type="button">Riepilogo della fase</button><button class="btn sm ghost" data-wiz="intro" type="button">Come si svolge questa fase</button><button class="btn sm ghost" data-wiz="elenco" type="button">Elenco completo</button></div>`;
  return h;
}
function renderIntro(p, lst, iniziata) {
  const fase = p.fase ?? 0, it = TIPI[p.tipo].intro?.[fase];
  const lista = (a, et) => `<ul>${(a || []).map(x => { const k = et ? x.indexOf(': ') : -1; return `<li>${k > 0 ? `<b>${esc(x.slice(0, k))}</b>: ${esc(x.slice(k + 2))}` : esc(x)}</li>`; }).join('')}</ul>`;
  const s = scadenza(p), r = residuo(p), rif = termineRifiuto(p);
  const qui = [];
  if (s && fase >= 1) qui.push(`Scadenza di questa pratica: <b class="num">${fmtD(s.d)}</b> (${r < 0 ? `<span class="txt-bad">scaduta da ${-r} giorni</span>` : r === 0 ? 'oggi' : `tra ${r} giorni`}), ${esc(s.base)}.`);
  if (rif != null) qui.push(rif < 0 ? `<span class="txt-bad">Il termine di 15 giorni per l'esito della fattura è superato da ${-rif} giorni.</span>` : `Esito della fattura da comunicare entro <b>${rif}</b> giorni.`);
  if (!s && fase >= 1 && (p.tipo === 'beni' || p.tipo === 'legali')) qui.push(p.tipo === 'beni' ? 'Inserisci nei dati la data di ricezione della fattura su SdI per calcolare le scadenze.' : 'Inserisci nei dati la data di notifica del titolo esecutivo per calcolare i 120 giorni.');
  if (p.sospesa) qui.push(`<span class="txt-bad">La pratica è sospesa</span>${p.motivoSospensione ? ': ' + esc(p.motivoSospensione) : ''}.`);
  return `<div class="g-head"><span class="tag">Procedura guidata · fase ${fase + 1} di ${FASI.length}</span><h3 class="g-title">Come si svolge: ${esc(FASI[fase].n.toLowerCase())}</h3>
      <p class="intro-come">${esc(it?.come || FASI[fase].d)}</p></div>
    <div class="intro">
      <section class="i-seq"><h4>Le sottofasi, in ordine</h4><ol class="flow">${lst.map((v, i) => { const st = statoVoce(p, v);
        return `<li class="f-${st}"><button class="f-t" data-appr="${fase}:${i}" type="button">${esc(v.t)}</button><span class="f-m">${v.r ? 'obbligatoria' : 'se pertinente'}${st === 'fatto' ? ' · <span class="txt-ok">fatta</span>' : st === 'dafare' ? ' · da fare' : ''} · <button class="lnk sm" data-appr="${fase}:${i}" type="button">approfondisci ›</button></span></li>`; }).join('')}</ol><p class="mut sm">Tocca una sottofase per aprire la sua scheda di approfondimento.</p></section>
      ${it ? `<div class="i-grid">
        <section class="i-box"><h4>Chi interviene</h4>${lista(it.chi, true)}</section>
        <section class="i-box"><h4>Documenti</h4><p class="i-sub">Servono</p>${lista(it.entrata)}<p class="i-sub">Si producono</p>${lista(it.uscita)}</section>
        <section class="i-box"><h4>Tempi e scadenze</h4>${lista(it.tempi)}</section>
      </div>` : ''}
      ${qui.length ? `<div class="i-qui"><h4>Per questa pratica</h4><ul>${qui.map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
      <div class="actions"><button class="btn primary" data-wiz="inizia" type="button">${iniziata ? 'Riprendi le domande' : 'Inizia le domande'}</button><button class="btn ghost" data-wiz="elenco" type="button">Vedi l'elenco completo</button></div>
    </div>`;
}
/* ---------------- scheda di approfondimento della sottofase ---------------- */
function apriAppr(fase, idx) {
  let sc = $('#appr-scrim'), el = $('#appr');
  if (!el) {
    sc = document.createElement('div'); sc.id = 'appr-scrim'; sc.className = 'scrim appr-scrim'; sc.hidden = true;
    sc.addEventListener('click', chiudiAppr);
    el = document.createElement('section'); el.id = 'appr'; el.className = 'appr'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'appr-title');
    document.body.append(sc, el);
  }
  if (S.introAperta && S.modo === 'guida') S.wizIntro = true;
  S.appr = {fase, idx}; renderAppr(); sc.hidden = false; el.hidden = false; $('#appr .appr-x')?.focus();
}
function chiudiAppr() { if (!S.appr) return; S.appr = null; $('#appr').hidden = true; $('#appr-scrim').hidden = true; }
function renderAppr() {
  const el = $('#appr'); if (!el || !S.appr) return;
  const p = S.det || S.pratiche.get(S.open); if (!p) { chiudiAppr(); return; }
  const {fase, idx} = S.appr, lst = TIPI[p.tipo].check[fase], it = lst[idx], st = statoVoce(p, it), c = p.check?.[it.id];
  const ro = canWrite() && S.det ? '' : 'disabled';
  const corrente = fase === (p.fase ?? 0) && fase < CONCLUSA;
  el.innerHTML = `<header class="appr-h"><div><span class="tag">Approfondimento · ${esc(FASI[fase].n)} · sottofase ${idx + 1} di ${lst.length}</span>
      <h2 id="appr-title">${esc(it.t)}</h2>
      <div class="chips"><span class="chip">${it.r ? 'Obbligatoria' : 'Se pertinente'}</span><span class="chip ${st === 'fatto' ? 'ok' : st === 'dafare' ? 'warn' : ''}">${st === 'fatto' ? 'Fatta' : st === 'dafare' ? 'Da fare' : 'Senza risposta'}</span>${c ? `<span class="mut sm">il ${fmtTs(c.at)} da ${who(c.by)}</span>` : ''}</div></div>
      <button class="btn ghost appr-x" data-ap="chiudi" type="button" aria-label="Chiudi l'approfondimento">✕</button></header>
    <div class="appr-b">
      <h4>A cosa serve</h4>${aiutoHtml(it)}
    </div>
    <footer class="appr-f">
      <div class="actions tight">${st !== 'fatto' ? `<button class="btn primary w" data-ap="si" type="button" ${ro}>L'ho fatto</button>` : ''}${st === 'aperto' ? `<button class="btn w" data-ap="so" type="button" ${ro}>Lo farò dopo</button>` : ''}${corrente && S.modo === 'guida' ? '<button class="btn ghost" data-ap="vai" type="button">Vai a questa domanda</button>' : ''}</div>
      <div class="actions tight appr-nav"><button class="btn sm ghost" data-ap="prev" type="button" ${idx === 0 ? 'disabled' : ''}>← Precedente</button><button class="btn sm ghost" data-ap="next" type="button" ${idx === lst.length - 1 ? 'disabled' : ''}>Successiva →</button><button class="btn sm" data-ap="chiudi" type="button">Chiudi</button></div>
    </footer>`;
}
async function azioneAppr(a) {
  if (!S.appr) return;
  const p = S.det; const {fase, idx} = S.appr;
  if (a === 'chiudi') { chiudiAppr(); return; }
  if (a === 'prev' || a === 'next') { S.appr.idx = Math.max(0, Math.min(TIPI[(p || S.pratiche.get(S.open)).tipo].check[fase].length - 1, idx + (a === 'next' ? 1 : -1))); renderAppr(); return; }
  if (a === 'vai') { chiudiAppr(); S.wizIntro = false; S.wizRiep = false; S.wizIdx = idx; S.wizSpiega = false; renderDrawer(false); vediFase(); return; }
  if (!p) return;
  const it = TIPI[p.tipo].check[fase][idx];
  const body = a === 'si' ? {check: {[it.id]: true}} : {dafare: {[it.id]: true}};
  if (await modifica(S.open, body)) { renderAppr(); toast(a === 'si' ? 'Sottofase segnata come fatta.' : 'Sottofase aggiunta alle cose da fare.'); }
}
function renderElenco(p, vf) {
  const fase = p.fase ?? 0, lst = TIPI[p.tipo]?.check[vf] || [], dis = canWrite() && S.det ? '' : 'disabled';
  const corrente = vf === Math.min(fase, 3) && fase < CONCLUSA;
  let ph = `<h3>Fase ${vf + 1} · ${esc(FASI[vf].n)}${corrente ? '' : ' <span class="chip">consultazione</span>'}</h3><p class="ph-desc">${esc(FASI[vf].d)}</p>`;
  if (corrente) ph += '<div class="actions tight"><button class="btn sm primary" data-wiz="guida" type="button">Torna alla procedura guidata</button></div>';
  ph += lst.map((it, i) => { const c = p.check?.[it.id], df = p.dafare?.[it.id];
    return `<label class="chk ${c ? 'on' : ''}"><input type="checkbox" data-chk="${it.id}" ${c ? 'checked' : ''} ${dis}><span class="tx">${esc(it.t)}${it.r ? '<span class="req">obbligatorio</span>' : ''}${df && !c ? ' <span class="chip warn">Da fare</span>' : ''}</span>${it.ref ? `<span class="ref">${esc(it.ref)}</span>` : ''}${c ? `<span class="by">Fatto il ${fmtTs(c.at)} da ${who(c.by)}</span>` : ''}<span class="ref"><button class="lnk sm" data-appr="${vf}:${i}" type="button">Approfondisci ›</button></span></label>`; }).join('');
  if (corrente) ph += avanzaHtml(p);
  else if (fase >= CONCLUSA && vf === 3) ph += `<div class="actions w"><button class="btn" data-act="reopen" type="button" ${dis}>Riapri in fase Pagamento</button></div>`;
  return ph;
}
function vediFase() {
  const b = $('.dr-body'), f = $('#dr-phase'); if (!b || !f) return;
  const d = f.getBoundingClientRect().top - b.getBoundingClientRect().top - 12;
  if (d < 0 || d > b.clientHeight / 3) b.scrollTop += d;
}
async function rispondi(azione, i) {
  const p = S.det; if (!p) return;
  const lst = TIPI[p.tipo].check[p.fase];
  const idx = i != null ? i : (S.wizIdx ?? lst.findIndex(it => statoVoce(p, it) === 'aperto'));
  const it = lst[idx]; if (!it) return;
  if (azione === 'spiega') { S.wizSpiega = true; S.wizIdx = idx; renderDrawer(false); return; }
  if (azione === 'vai') { S.wizRiep = false; S.wizSpiega = true; S.wizIdx = idx; renderDrawer(false); return; }
  const body = azione === 'si' ? {check: {[it.id]: true}} : {check: {[it.id]: false}, dafare: {[it.id]: true}};
  const ok = await modifica(S.open, body);
  if (ok && !S.wizRiep) { S.wizIdx = null; S.wizSpiega = false; renderDrawer(false); vediFase(); }
}

function renderForm(p) {
  const f = $('#dr-form'); const ro = canWrite() && S.det ? '' : 'disabled';
  let h = '<h3>Dati della pratica</h3><div class="form">';
  for (const c of CAMPI) {
    if (c.tipi && !c.tipi.includes(p.tipo)) continue;
    if (c.sub) { h += `<div class="form-sub">${esc(c.sub)}</div>`; continue; }
    const v = p[c.k]; const idf = 'fd-' + c.k; let inp;
    if (c.t === 'area') inp = `<textarea id="${idf}" data-k="${c.k}" maxlength="5000" ${ro}>${esc(v || '')}</textarea>`;
    else if (c.t === 'check') { h += `<div class="fld chkf full"><input type="checkbox" id="${idf}" data-k="${c.k}" ${v ? 'checked' : ''} ${ro}><label for="${idf}">${esc(c.l)}</label></div>`; continue; }
    else if (c.t === 'num') inp = `<input id="${idf}" data-k="${c.k}" data-t="num" inputmode="decimal" value="${esc(numIn(v))}" ${ro}>`;
    else inp = `<input id="${idf}" data-k="${c.k}" type="${c.t === 'date' ? 'date' : 'text'}" maxlength="500" value="${esc(v || '')}" ${ro}>`;
    h += `<div class="fld ${c.full ? 'full' : ''}"><label for="${idf}">${esc(c.l)}</label>${inp}${c.h ? `<span class="h">${esc(c.h)}</span>` : ''}</div>`;
  }
  h += '</div><div class="actions w"><button class="btn primary" type="submit" ' + ro + '>Salva i dati</button><span id="form-st" class="mut sm"></span></div>';
  f.innerHTML = h; S.formDirty = false;
}

/* ---------------- azioni ---------------- */
function avanza(force) {
  const p = S.det; if (!p) return; const fase = p.fase ?? 0;
  if (mancanti(p, fase).length && !force) { S.advWarn = true; renderDrawer(false); return; }
  S.advWarn = false; S.viewFase = Math.min(fase + 1, 3); S.modo = 'guida'; S.wizIdx = null; S.wizSpiega = false; S.wizRiep = false; S.wizIntro = null;
  modifica(S.open, {azione: {tipo: 'avanza', fase_attesa: fase, forza: !!force}}).then(ok => { if (ok) vediFase(); if (ok && fase + 1 >= CONCLUSA) toast('Pratica conclusa.'); });
}
async function creaPratica(campi, extra = {}) {
  try {
    const {id} = await api('POST', '/api/pratiche', {campi, ...extra});
    await caricaTutto(); openDrawer(id);
  } catch (e) { if (e.code) toast(e.message); }
}
function esempio() {
  const t = today();
  creaPratica({oggetto: 'ESEMPIO · Fornitura di toner per gli uffici della Direzione', beneficiario: 'Fornitore di esempio S.r.l.', importo: 2440, iva: 440,
    esercizio: String(t.getUTCFullYear()), capitolo: '(capitolo di esempio)', cig: '(CIG di esempio)', fattura: 'FE-123', dataRicezione: isoD(addDays(t, -12)),
    note: 'Pratica dimostrativa: un amministratore può eliminarla in fondo alla scheda.'},
  {tipo: 'beni', esempio: true, fase_iniziale: 1, check_iniziali: ['b_det', 'b_cig', 'b_cop', 'b_imp', 'b_ord', 'b_fat']});
}
function csv() {
  const rows = [['Tipologia', 'Fase', 'Sospesa', 'Oggetto', 'Beneficiario', 'CF/P.IVA', 'Importo', 'IVA', 'Esercizio', 'Capitolo', 'Impegno', 'CIG', 'CUP', 'Fattura', 'Ricezione SdI', 'Notifica titolo', 'Scadenza', 'Giorni residui', 'Ordine di pagamento', 'Data pagamento', 'Quietanza', 'Assegnata a', 'Adempimenti fase', 'Aggiornata']];
  const n = v => v == null || v === '' || isNaN(v) ? '' : String(v).replace('.', ',');
  for (const p of filtrate()) { const s = scadenza(p), a = avanzamento(p), r = residuo(p);
    rows.push([TIPI[p.tipo]?.n, faseNome(p.fase ?? 0), p.sospesa ? 'sì' : '', p.oggetto, p.beneficiario, p.cfpiva, n(p.importo), n(p.iva), p.esercizio, p.capitolo, p.impegno, p.cig, p.cup, p.fattura, p.dataRicezione, p.dataNotifica, s ? isoD(s.d) : '', r ?? '', p.op, p.dataPagamento, p.quietanza, S.utenti.get(p.assegnatario)?.nome || '', (p.fase ?? 0) < CONCLUSA ? `${a.fatti}/${a.tot}` : '', fmtTs(p.aggiornata)]); }
  // Il prefisso ' neutralizza le celle che Excel interpreterebbe come formule.
  const cella = c => { c = String(c ?? ''); if (/^[=+\-@\t\r]/.test(c) && isNaN(Number(c.replace(',', '.')))) c = "'" + c; return /[";\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; };
  const text = '﻿' + rows.map(r => r.map(cella).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type: 'text/csv;charset=utf-8'}));
  a.download = `pratiche-spesa-${isoD(today())}.csv`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-open],[data-act],[data-vf],[data-goto],[data-attiva],[data-reset],[data-wiz],[data-appr],[data-ap]'); if (!t) return;
  if (t.dataset.wiz) { wiz(t.dataset.wiz, t.dataset.i != null ? +t.dataset.i : null); return; }
  if (t.dataset.appr) { e.preventDefault(); const [f, i] = t.dataset.appr.split(':').map(Number); apriAppr(f, i); return; }
  if (t.dataset.ap) { e.preventDefault(); azioneAppr(t.dataset.ap); return; }
  if (t.dataset.open) { openDrawer(t.dataset.open); return; }
  if (t.dataset.vf != null) { S.viewFase = +t.dataset.vf; S.advWarn = false; const f = S.det?.fase ?? 0; S.modo = (S.viewFase === Math.min(f, 3) && f < CONCLUSA) ? 'guida' : 'elenco'; S.wizSpiega = false; renderDrawer(false); return; }
  if (t.dataset.goto) { const g = t.dataset.goto; S.f = {...S.f, fase: g === 'concluse' ? String(CONCLUSA) : 'aperte', stato: ['scadute', 'inscadenza', 'sospese'].includes(g) ? g : '', eserc: g === 'concluse' ? String(new Date().getFullYear()) : ''}; location.hash = 'pratiche'; return; }
  if (t.dataset.attiva) { utente(+t.dataset.attiva, {attivo: t.dataset.val === '1'}); return; }
  if (t.dataset.reset) { const u = S.utenti.get(+t.dataset.reset); utente(u.id, {reimposta_password: true}, 'Nuova password provvisoria per ' + u.nome); return; }
  const id = S.open, p = S.det;
  switch (t.dataset.act) {
    case 'close': closeDrawer(); break;
    case 'new': openNew(); break;
    case 'esempio': esempio(); break;
    case 'adv': avanza(false); break;
    case 'adv-force': avanza(true); break;
    case 'adv-cancel': S.advWarn = false; renderDrawer(false); break;
    case 'back': if (p) { S.advWarn = false; S.viewFase = p.fase - 1; S.modo = 'guida'; S.wizIdx = null; S.wizSpiega = false; S.wizRiep = false; S.wizIntro = false; modifica(id, {azione: {tipo: 'indietro', fase_attesa: p.fase}}); } break;
    case 'reopen': if (p) { S.viewFase = 3; S.modo = 'guida'; S.wizIdx = null; S.wizRiep = true; S.wizIntro = false; modifica(id, {azione: {tipo: 'riapri', fase_attesa: p.fase}}); } break;
    case 'sosp': S.sospAsk = true; renderDrawer(false); $('#sosp-m')?.focus(); break;
    case 'sosp-no': S.sospAsk = false; renderDrawer(false); break;
    case 'sosp-ok': { const m = $('#sosp-m').value.trim(); S.sospAsk = false; modifica(id, {azione: {tipo: 'sospendi', motivo: m}}); break; }
    case 'riprendi': modifica(id, {azione: {tipo: 'riprendi'}}); break;
    case 'del': S.delAsk = true; renderDrawer(false); break;
    case 'del-no': S.delAsk = false; renderDrawer(false); break;
    case 'del-ok': try { await api('DELETE', '/api/pratiche/' + id); closeDrawer(); await caricaTutto(); toast('Pratica eliminata.'); } catch (err) { if (err.code) toast(err.message); } break;
    case 'copia': { const code = $('.secret code'); try { await navigator.clipboard.writeText(S.segreto.pw); toast('Password copiata.'); } catch { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Testo selezionato: copialo con Ctrl+C.'); } break; }
    case 'chiudi-segreto': S.segreto = null; renderUtenti(); break;
  }
});
function wiz(az, i) {
  const p = S.det; if (!p && !['elenco', 'inizia', 'intro', 'riep'].includes(az)) return;
  switch (az) {
    case 'si': case 'so': rispondi(az, i); return;
    case 'spiega': case 'vai': rispondi(az, i).then(vediFase); return;
    case 'prev': { const lst = TIPI[p.tipo].check[p.fase]; let idx = S.wizIdx ?? lst.findIndex(it => statoVoce(p, it) === 'aperto'); if (idx < 0) idx = lst.length; S.wizIdx = Math.max(0, idx - 1); S.wizSpiega = false; S.wizIntro = false; break; }
    case 'riep': S.wizRiep = true; S.wizSpiega = false; S.wizIntro = false; break;
    case 'domande': case 'inizia': S.wizRiep = false; S.wizIdx = null; S.wizSpiega = false; S.wizIntro = false; renderDrawer(false); vediFase(); return;
    case 'intro': S.wizIntro = true; S.wizSpiega = false; renderDrawer(false); vediFase(); return;
    case 'elenco': S.modo = 'elenco'; S.wizSpiega = false; break;
    case 'guida': S.modo = 'guida'; S.wizRiep = false; S.wizIdx = null; break;
  }
  renderDrawer(false);
}
async function utente(id, body, titolo) {
  try {
    const r = await api('PATCH', '/api/utenti/' + id, body);
    if (r.password_provvisoria) S.segreto = {titolo, pw: r.password_provvisoria};
    await caricaTutto(); renderUtenti();
  } catch (e) { if (e.code) toast(e.message); renderUtenti(); }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.appr) { chiudiAppr(); return; }
  if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
  if (e.key === 'Enter' && e.target.matches('tr[data-open]')) openDrawer(e.target.dataset.open);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.chk) { S.advWarn = false; modifica(S.open, {check: {[t.dataset.chk]: t.checked}}); return; }
  if (t.id === 'as-sel') { modifica(S.open, {azione: {tipo: 'assegna', utente: t.value === '' ? null : Number(t.value)}}); return; }
  if (t.dataset.ruolo) { utente(+t.dataset.ruolo, {ruolo: t.value}); return; }
  if (t.closest('#dr-form')) { S.formDirty = true; const st = $('#form-st'); if (st) st.textContent = 'Modifiche non salvate'; }
  const fm = {'f-tipo': 'tipo', 'f-fase': 'fase', 'f-stato': 'stato', 'f-eserc': 'eserc'};
  if (fm[t.id]) { S.f[fm[t.id]] = t.value; renderPratiche(); }
  if (t.id === 'f-mie') { S.f.mie = t.checked; renderPratiche(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'f-q') { S.f.q = t.value; renderPratiche(); }
  if (t.closest('#dr-form')) { S.formDirty = true; const st = $('#form-st'); if (st) st.textContent = 'Modifiche non salvate'; }
});
document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  if (f.id === 'f-login') {
    $('#login-err').hidden = true;
    try { await api('POST', '/api/login', {username: $('#l-user').value.trim(), password: $('#l-pw').value}); $('#l-pw').value = ''; await avvio(); }
    catch (err) { $('#login-err').textContent = err.message; $('#login-err').hidden = false; }
  }
  if (f.id === 'f-pwd') {
    $('#pwd-err').hidden = true;
    const nuova = $('#p-new').value;
    if (nuova !== $('#p-new2').value) { $('#pwd-err').textContent = 'Le due nuove password non coincidono.'; $('#pwd-err').hidden = false; return; }
    try { await api('POST', '/api/password', {attuale: $('#p-old').value, nuova}); f.reset(); toast('Password aggiornata.'); await avvio(); }
    catch (err) { $('#pwd-err').textContent = err.message; $('#pwd-err').hidden = false; }
  }
  if (f.id === 'f-utente') {
    try {
      const nome = $('#u-nome').value.trim();
      const r = await api('POST', '/api/utenti', {nome, username: $('#u-user').value.trim(), ruolo: $('#u-ruolo').value});
      S.segreto = {titolo: 'Utenza creata per ' + nome, pw: r.password_provvisoria};
      await caricaTutto(); renderUtenti();
    } catch (err) { if (err.code) toast(err.message); }
  }
  if (f.id === 'new-form') {
    const og = $('#n-oggetto').value.trim(); if (!og) { $('#n-oggetto').focus(); toast("Indica l'oggetto della spesa."); return; }
    const imp = parseNum($('#n-imp').value); if (Number.isNaN(imp)) { toast('Importo non valido: usa il formato 1.234,56.'); return; }
    creaPratica({oggetto: og, beneficiario: $('#n-benef').value.trim(), importo: imp, esercizio: $('#n-es').value.trim(), capitolo: $('#n-cap').value.trim()}, {tipo: $('input[name=tipo]:checked').value});
  }
  if (f.id === 'dr-form') {
    const p = S.det; if (!p) return; const campi = {};
    for (const el of $$('[data-k]', f)) {
      const k = el.dataset.k; const v = el.type === 'checkbox' ? el.checked : el.dataset.t === 'num' ? parseNum(el.value) : el.value.trim();
      if (Number.isNaN(v)) { el.focus(); toast('Importo non valido: usa il formato 1.234,56.'); return; }
      const old = p[k] ?? (el.type === 'checkbox' ? false : el.dataset.t === 'num' ? null : '');
      if (v !== old) campi[k] = v;
    }
    if ('oggetto' in campi && !campi.oggetto) { toast("L'oggetto non può essere vuoto."); return; }
    if (!Object.keys(campi).length) { S.formDirty = false; $('#form-st').textContent = 'Nessuna modifica'; return; }
    S.formDirty = false;
    if (await modifica(S.open, {campi})) { const st = $('#form-st'); if (st) st.textContent = 'Salvato'; }
  }
});

/* ---------------- navigazione e avvio ---------------- */
const VISTE = ['cruscotto', 'pratiche', 'guida', 'utenti'];
function route() {
  let v = location.hash.slice(1); if (!VISTE.includes(v) || (v === 'utenti' && !isAdmin())) v = 'cruscotto';
  S.view = v;
  $$('nav.tabs a').forEach(a => { if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  VISTE.forEach(k => $('#v-' + k).hidden = k !== v);
  renderAll(true); window.scrollTo(0, 0);
}
function renderAll(cambioVista) {
  if (!S.me) return;
  if (S.view === 'cruscotto') renderCruscotto();
  if (S.view === 'pratiche') renderPratiche();
  if (S.view === 'guida') renderGuida();
  if (S.view === 'utenti' && cambioVista) renderUtenti();
  if (S.open && !S.newMode && !$('#drawer').hidden) { renderDrawer(false); renderAppr(); }
}
function schermata(id) { ['scr-login', 'scr-pwd', 'scr-app'].forEach(k => $('#' + k).hidden = k !== id); }
function showLogin(msg) {
  S.me = null; clearInterval(S.poll); closeDrawer(); schermata('scr-login');
  const e = $('#login-err'); if (msg) { e.textContent = msg; e.hidden = false; } else e.hidden = true;
  $('#l-user').focus();
}
function showPwd(forzato) {
  schermata('scr-pwd'); $('#pwd-cancel').hidden = forzato;
  $('#pwd-intro').textContent = forzato ? 'Al primo accesso, o dopo una reimpostazione, scegli una password personale di almeno 10 caratteri.' : 'Scegli una nuova password di almeno 10 caratteri.';
  $('#pwd-err').hidden = true; $('#p-old').focus();
}
async function avvio() {
  try { S.me = await api('GET', '/api/me'); } catch (e) { if (e.code !== 401) { schermata('scr-login'); $('#login-err').textContent = e.message; $('#login-err').hidden = false; } return; }
  if (S.me.cambio_password) { showPwd(true); return; }
  schermata('scr-app');
  $('#acc-name').textContent = S.me.nome; $('#acc-role').textContent = '· ' + RUOLI[S.me.ruolo];
  document.body.classList.toggle('ro', !canWrite());
  document.body.classList.toggle('no-admin', !isAdmin());
  banner(canWrite() ? '' : 'info', canWrite() ? '' : 'Profilo di consultazione: puoi vedere le pratiche ma non modificarle.');
  try { await caricaTutto(); } catch { /* gestito in api() */ }
  route();
  clearInterval(S.poll); S.poll = setInterval(controllaNovita, 10000);
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden) controllaNovita(); });
$('#btn-new').addEventListener('click', openNew);
$('#scrim').addEventListener('click', closeDrawer);
$('#btn-pwd').addEventListener('click', () => showPwd(false));
$('#pwd-cancel').addEventListener('click', () => schermata('scr-app'));
$('#btn-logout').addEventListener('click', async () => { try { await api('POST', '/api/logout'); } catch { /* ignora */ } showLogin(); });
document.addEventListener('click', e => { if (e.target.id === 'f-csv') csv(); });

(async () => {
  try {
    const m = await (await fetch('modello.json', {cache: 'no-store'})).json();
    FASI = m.FASI; TIPI = m.TIPI; ALL = m.ORDINE_TIPI; CAMPI = m.CAMPI; CONCLUSA = FASI.length;
  } catch { document.body.textContent = 'Impossibile caricare il modello delle pratiche dal server.'; return; }
  await avvio();
})();
