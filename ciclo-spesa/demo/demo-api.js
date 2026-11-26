'use strict';
/* Interfaccia di prova: simula nel browser il server di Ciclo della spesa.
   Dati fittizi, tenuti solo in memoria: ricaricando la pagina si riparte da capo. */
(function () {
  const realFetch = window.fetch.bind(window);
  let M = null, VOCI = {}, CAMPI = {};
  const now = () => Date.now();
  const iso = d => d.toISOString().slice(0, 10);
  const giorni = n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + n); return iso(d); };
  const anno = String(new Date().getFullYear());

  const utenti = new Map([
    [1, {id: 1, username: 'demo', nome: 'Utente di prova', ruolo: 'admin', attivo: true, pw: 'demo', cambio: false}],
    [2, {id: 2, username: 'collega.a', nome: 'Collega di prova A', ruolo: 'operatore', attivo: true, pw: 'x', cambio: false}],
    [3, {id: 3, username: 'collega.b', nome: 'Collega di prova B', ruolo: 'lettura', attivo: true, pw: 'x', cambio: false}],
  ]);
  let sessione = null, rev = 1, seq = 4;
  const pratiche = new Map(), eventi = [];
  const ev = (uid, pid, msg, ts) => eventi.push({ts: (ts || now()) / 1000, utente_id: uid, pratica_id: pid, msg});

  function semina() {
    const ck = (ids, uid, giorniFa) => Object.fromEntries(ids.map(i => [i, {ok: true, by: uid, at: now() - giorniFa * 864e5}]));
    const P = [
      {tipo: 'beni', fase: 0, assegnatario: 2, oggetto: 'Fornitura di carta e materiale di cancelleria', beneficiario: 'Cartoleria di prova S.r.l.', importo: 1830, iva: 330, capitolo: '1234 pg 1', check: ck(['b_det', 'b_cig', 'b_cop'], 2, 3)},
      {tipo: 'beni', fase: 1, assegnatario: 1, oggetto: 'Fornitura di toner per le stampanti della Direzione', beneficiario: 'Forniture d\'ufficio di prova S.p.A.', importo: 2440, iva: 440, capitolo: '1234 pg 2', cig: 'Z0000PROVA', impegno: '1001', fattura: 'FE-118', dataRicezione: giorni(-12), check: ck(['b_det', 'b_cig', 'b_cop', 'b_imp', 'b_ord', 'b_fat'], 1, 10), dafare: {b_ctr: {by: 1, at: now() - 2 * 864e5}}},
      {tipo: 'beni', fase: 2, assegnatario: 2, oggetto: 'Manutenzione dell\'impianto di climatizzazione', beneficiario: 'Impianti tecnici di prova S.r.l.', importo: 6100, iva: 1100, capitolo: '1250 pg 1', cig: 'B0000PROVA', impegno: '1002', fattura: '45/PA', dataRicezione: giorni(-27), check: ck(['b_det', 'b_cig', 'b_cop', 'b_imp', 'b_ord', 'b_fat', 'b_acc', 'b_ctr', 'b_reg', 'b_durc', 'b_48b', 'b_liq', 'b_pcc'], 2, 6)},
      {tipo: 'beni', fase: 1, assegnatario: 2, sospesa: true, motivoSospensione: 'DURC irregolare: chiesta regolarizzazione al fornitore', oggetto: 'Servizio di pulizia straordinaria dei locali', beneficiario: 'Servizi integrati di prova Soc. Coop.', importo: 3904, iva: 704, capitolo: '1250 pg 3', cig: 'Z1111PROVA', impegno: '1003', dataRicezione: giorni(-20), check: ck(['b_det', 'b_cig', 'b_cop', 'b_imp', 'b_ord', 'b_fat', 'b_acc', 'b_ctr', 'b_reg'], 2, 8)},
      {tipo: 'legali', fase: 1, assegnatario: 1, oggetto: 'Spese di lite liquidate con sentenza del TAR (caso di prova)', beneficiario: 'Avv. di prova, distrattario', importo: 3172, iva: 572, titolo: 'Sentenza di prova n. 0000/2026', rg: '0000/2025', dataNotifica: giorni(-130), capitolo: '1290 pg 1', check: ck(['l_tit', 'l_avv', 'l_qnt', 'l_cap', 'l_ben', 'l_doc'], 1, 40)},
      {tipo: 'legali', fase: 0, assegnatario: 1, sospesa: true, motivoSospensione: 'In attesa delle indicazioni dell\'Avvocatura dello Stato', oggetto: 'Compensi di difesa da ordinanza cautelare (caso di prova)', beneficiario: 'Parte ricorrente di prova', importo: 1268.8, dataNotifica: giorni(-30), check: ck(['l_tit'], 1, 25)},
      {tipo: 'compensi', fase: 3, assegnatario: 2, oggetto: 'Compenso del commissario straordinario, secondo semestre', beneficiario: 'Commissario di prova', istituzione: 'Istituzione AFAM di prova', periodo: 'Lug-Dic ' + anno, importo: 9000, scadenzaManuale: giorni(20), capitolo: '1300 pg 1', impegno: '1004', op: 'OP 2077', check: ck(['c_nom', 'c_per', 'c_imp', 'c_dic', 'c_att', 'c_rit', 'c_liq', 'c_op', 'c_ucb'], 2, 5)},
      {tipo: 'altro', fase: 4, assegnatario: 1, oggetto: 'Rimborso spese di missione (caso di prova)', beneficiario: 'Dipendente di prova', importo: 412.6, capitolo: '1320 pg 1', dataPagamento: giorni(-15), quietanza: 'Q-0099', check: ck(['a_att', 'a_cop', 'a_doc', 'a_liq', 'a_reg', 'a_op', 'a_pag', 'a_arc'], 1, 15)},
    ];
    P.forEach((p, i) => {
      const id = 'pdemo' + String(i).padStart(7, '0');
      const creata = now() - (45 - i * 4) * 864e5;
      pratiche.set(id, Object.assign({check: {}, dafare: {}, sospesa: false, motivoSospensione: '', esempio: true, esercizio: anno, creatoDa: p.assegnatario, creata, aggiornata: now() - (8 - i) * 36e5}, p));
      ev(p.assegnatario, id, 'Pratica creata', creata);
      Object.keys(p.check).forEach(k => ev(p.check[k].by, id, 'Completato: ' + VOCI[p.tipo][k].t, p.check[k].at));
      for (let f = 1; f <= Math.min(p.fase, M.FASI.length); f++) ev(p.assegnatario, id, f >= M.FASI.length ? 'Pratica conclusa' : 'Passata alla fase ' + M.FASI[f].n, creata + f * 3 * 864e5);
      if (p.sospesa) ev(p.assegnatario, id, 'Pratica sospesa: ' + p.motivoSospensione, now() - 2 * 864e5);
    });
    ev(1, null, 'Creata l\'utenza collega.a (operatore)', now() - 50 * 864e5);
    ev(1, null, 'Creata l\'utenza collega.b (lettura)', now() - 50 * 864e5);
  }

  async function prepara() {
    if (M) return;
    M = await (await realFetch('modello.json')).json();
    for (const [t, d] of Object.entries(M.TIPI)) VOCI[t] = Object.fromEntries(d.check.flat().map(i => [i.id, i]));
    M.CAMPI.forEach(c => { if (c.k) CAMPI[c.k] = c; });
    semina();
  }

  class E { constructor(s, m) { this.s = s; this.m = m; } }
  const risposta = (s, o) => new Response(JSON.stringify(o), {status: s, headers: {'Content-Type': 'application/json'}});
  const io = () => { const u = sessione && utenti.get(sessione); if (!u || !u.attivo) throw new E(401, 'Sessione scaduta: accedi di nuovo.'); return u; };
  const leggi = id => { const p = pratiche.get(id); if (!p) throw new E(404, 'La pratica non esiste più.'); return p; };
  const dettaglio = id => Object.assign({id}, JSON.parse(JSON.stringify(leggi(id))), {log: eventi.filter(e => e.pratica_id === id).sort((a, b) => b.ts - a.ts)});
  const nomeVuoto = k => CAMPI[k].t === 'num' ? null : CAMPI[k].t === 'check' ? false : '';

  function validaCampi(tipo, campi) {
    const out = {};
    for (const [k, v0] of Object.entries(campi || {})) {
      const c = CAMPI[k]; if (!c || (c.tipi && !c.tipi.includes(tipo))) throw new E(400, 'Campo non previsto: ' + k);
      let v = v0;
      if (c.t === 'num') { if (v === '' || v == null) v = null; else if (typeof v !== 'number' || !isFinite(v)) throw new E(400, 'Importo non valido nel campo «' + c.l + '».'); else v = Math.round(v * 100) / 100; }
      else if (c.t === 'check') v = !!v;
      else { v = v == null ? '' : String(v).trim(); if (c.t === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new E(400, 'Data non valida nel campo «' + c.l + '».'); }
      out[k] = v;
    }
    return out;
  }

  function azione(me, d, az) {
    const fase = d.fase, F = M.FASI, CONCL = F.length;
    if ('fase_attesa' in az && az.fase_attesa !== fase) throw new E(409, 'Un collega ha appena cambiato la fase di questa pratica.');
    switch (az.tipo) {
      case 'avanza': {
        const manc = M.TIPI[d.tipo].check[fase].filter(i => i.r && !d.check[i.id]);
        if (manc.length && !az.forza) throw new E(400, 'Mancano adempimenti obbligatori.');
        d.fase = fase + 1; if (d.fase >= CONCL) d.sospesa = false;
        return (d.fase >= CONCL ? 'Pratica conclusa' : 'Passata alla fase ' + F[d.fase].n) + (manc.length ? ' con ' + manc.length + ' adempimenti obbligatori non spuntati' : '');
      }
      case 'salta_fase': {
        if (fase >= CONCL) throw new E(400, 'La pratica è già conclusa.');
        let n = 0; d.dafare = d.dafare || {};
        M.TIPI[d.tipo].check[fase].forEach(i => { if (!d.check[i.id]) { d.check[i.id] = {ok: true, by: me.id, at: now(), gia: true}; n++; } delete d.dafare[i.id]; });
        d.fase = fase + 1; if (d.fase >= CONCL) d.sospesa = false;
        return 'Fase ' + F[fase].n + ' registrata come già svolta (' + n + ' sottofasi segnate come già svolte); ' + (d.fase >= CONCL ? 'pratica conclusa' : 'passata alla fase ' + F[d.fase].n);
      }
      case 'indietro': d.fase = fase - 1; return 'Riportata alla fase ' + F[d.fase].n;
      case 'riapri': d.fase = CONCL - 1; return 'Pratica riaperta in fase ' + F[CONCL - 1].n;
      case 'sospendi': d.sospesa = true; d.motivoSospensione = String(az.motivo || '').slice(0, 300); return 'Pratica sospesa' + (d.motivoSospensione ? ': ' + d.motivoSospensione : '');
      case 'riprendi': d.sospesa = false; d.motivoSospensione = ''; return 'Pratica ripresa';
      case 'assegna': {
        if (az.utente == null) { d.assegnatario = null; return 'Assegnatario rimosso'; }
        const u = utenti.get(az.utente); if (!u || !u.attivo || u.ruolo === 'lettura') throw new E(400, 'Si può assegnare la pratica solo a un operatore o amministratore attivo.');
        d.assegnatario = u.id; return u.id === me.id ? 'Presa in carico' : 'Assegnata a ' + u.nome;
      }
    }
    throw new E(400, 'Operazione sconosciuta.');
  }

  function api(metodo, path, b) {
    if (path === '/api/login' && metodo === 'POST') {
      const u = [...utenti.values()].find(x => x.username.toLowerCase() === String(b.username || '').toLowerCase());
      if (!u || !u.attivo || u.pw !== b.password) throw new E(401, 'Nome utente o password non corretti. Per la prova usa demo / demo.');
      sessione = u.id; return {ok: true};
    }
    if (path === '/api/logout') { sessione = null; return {ok: true}; }
    const me = io(); const admin = me.ruolo === 'admin', scr = me.ruolo !== 'lettura';
    if (path === '/api/password') {
      if (b.attuale !== me.pw) throw new E(400, 'La password attuale non è corretta.');
      if (!b.nuova || b.nuova.length < 10) throw new E(400, 'La password deve avere almeno 10 caratteri.');
      me.pw = b.nuova; me.cambio = false; ev(me.id, null, me.username + ' ha cambiato la propria password'); return {ok: true};
    }
    if (path === '/api/me') return {id: me.id, username: me.username, nome: me.nome, ruolo: me.ruolo, cambio_password: me.cambio};
    if (me.cambio) throw new E(403, 'Prima di continuare devi impostare una nuova password.');
    if (path === '/api/rev') return {rev};
    if (path === '/api/utenti' && metodo === 'GET') return [...utenti.values()].sort((a, b) => a.nome.localeCompare(b.nome)).map(u => Object.assign({id: u.id, nome: u.nome, ruolo: u.ruolo, attivo: u.attivo}, admin ? {username: u.username} : {}));
    if (path === '/api/pratiche' && metodo === 'GET') return {rev, pratiche: [...pratiche].map(([id, p]) => Object.assign({id}, JSON.parse(JSON.stringify(p))))};
    const m = path.match(/^\/api\/pratiche\/(\w+)$/);
    if (m && metodo === 'GET') return dettaglio(m[1]);
    if (path === '/api/pratiche' && metodo === 'POST') {
      if (!scr) throw new E(403, 'Il tuo profilo è di sola consultazione.');
      if (!M.TIPI[b.tipo]) throw new E(400, 'Tipologia non valida.');
      const d = Object.assign({tipo: b.tipo, fase: 0, check: {}, sospesa: false, motivoSospensione: '', assegnatario: me.id, creatoDa: me.id, creata: now(), aggiornata: now(), esempio: !!b.esempio}, validaCampi(b.tipo, b.campi));
      if (!(d.oggetto || '').trim()) throw new E(400, 'Indica l\'oggetto della spesa.');
      if (d.esempio) { (b.check_iniziali || []).forEach(i => { if (VOCI[b.tipo][i]) d.check[i] = {ok: true, by: me.id, at: now()}; }); if (Number.isInteger(b.fase_iniziale)) d.fase = b.fase_iniziale; }
      const id = 'p' + (seq++).toString(16).padStart(12, '0');
      pratiche.set(id, d); ev(me.id, id, 'Pratica creata'); rev++; return {id};
    }
    if (m && metodo === 'PATCH') {
      if (!scr) throw new E(403, 'Il tuo profilo è di sola consultazione.');
      const d = JSON.parse(JSON.stringify(leggi(m[1]))); const msgs = [];
      if (b.campi) {
        const n = validaCampi(d.tipo, b.campi); const camb = Object.keys(n).filter(k => (d[k] ?? nomeVuoto(k)) !== n[k]);
        camb.forEach(k => d[k] = n[k]); if (camb.length) msgs.push('Dati aggiornati: ' + camb.map(k => CAMPI[k].l).join(', '));
      }
      for (const [i, on] of Object.entries(b.check || {})) {
        const v = VOCI[d.tipo][i]; if (!v) throw new E(400, 'Adempimento sconosciuto.');
        if (on && !d.check[i]) { d.check[i] = {ok: true, by: me.id, at: now()}; if (d.dafare) delete d.dafare[i]; msgs.push('Completato: ' + v.t); }
        else if (!on && d.check[i]) { delete d.check[i]; msgs.push('Riaperto: ' + v.t); }
      }
      for (const [i, on] of Object.entries(b.dafare || {})) {
        const v = VOCI[d.tipo][i]; if (!v) throw new E(400, 'Adempimento sconosciuto.');
        d.dafare = d.dafare || {};
        if (on && !d.dafare[i] && !d.check[i]) { d.dafare[i] = {by: me.id, at: now()}; msgs.push('Da fare: ' + v.t); }
        else if (!on && d.dafare[i]) { delete d.dafare[i]; msgs.push('Tolto dalle cose da fare: ' + v.t); }
      }
      if (b.azione) msgs.push(azione(me, d, b.azione));
      if (msgs.length) { d.aggiornata = now(); pratiche.set(m[1], d); msgs.forEach(x => ev(me.id, m[1], x)); rev++; }
      return dettaglio(m[1]);
    }
    if (m && metodo === 'DELETE') {
      if (!admin) throw new E(403, 'Solo un amministratore può eliminare una pratica.');
      const d = leggi(m[1]); pratiche.delete(m[1]); ev(me.id, m[1], 'Pratica eliminata: ' + d.oggetto); rev++; return {ok: true};
    }
    if (!admin) throw new E(403, 'Operazione non disponibile.');
    const pw = () => 'prova-' + Math.random().toString(36).slice(2, 10);
    if (path === '/api/utenti' && metodo === 'POST') {
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(b.username || '')) throw new E(400, 'Nome utente non valido: 3-40 caratteri tra lettere, cifre, punto e trattino.');
      if ([...utenti.values()].some(u => u.username.toLowerCase() === b.username.toLowerCase())) throw new E(409, 'Esiste già un utente con questo nome utente.');
      const id = Math.max(...utenti.keys()) + 1, p = pw();
      utenti.set(id, {id, username: b.username, nome: (b.nome || '').trim() || b.username, ruolo: b.ruolo, attivo: true, pw: p, cambio: true});
      ev(me.id, null, 'Creata l\'utenza ' + b.username + ' (' + b.ruolo + ')'); rev++; return {id, password_provvisoria: p};
    }
    const mu = path.match(/^\/api\/utenti\/(\d+)$/);
    if (mu && metodo === 'PATCH') {
      const u = utenti.get(+mu[1]); if (!u) throw new E(404, 'Utente inesistente.'); let nuova = null;
      if ('ruolo' in b) { if (u.id === me.id) throw new E(400, 'Non puoi cambiare il tuo stesso ruolo.'); u.ruolo = b.ruolo; ev(me.id, null, 'Ruolo di ' + u.username + ' impostato a ' + b.ruolo); }
      if ('attivo' in b) { if (u.id === me.id) throw new E(400, 'Non puoi disattivare la tua stessa utenza.'); u.attivo = !!b.attivo; ev(me.id, null, 'Utenza ' + u.username + (u.attivo ? ' riattivata' : ' disattivata')); }
      if (b.reimposta_password) { nuova = pw(); u.pw = nuova; u.cambio = true; ev(me.id, null, 'Password di ' + u.username + ' reimpostata'); }
      rev++; return {ok: true, password_provvisoria: nuova};
    }
    if (path === '/api/registro') return [...eventi].sort((a, b) => b.ts - a.ts).slice(0, 500);
    throw new E(404, 'Operazione non disponibile.');
  }

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return realFetch(input, init);
    await prepara();
    await new Promise(r => setTimeout(r, 60));
    const metodo = (init && init.method) || 'GET';
    let body = {}; try { body = init && init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
    try { return risposta(metodo === 'POST' && url === '/api/pratiche' ? 201 : 200, api(metodo, url, body)); }
    catch (e) { if (e instanceof E) return risposta(e.s, {errore: e.m}); console.error(e); return risposta(500, {errore: 'Errore interno della simulazione.'}); }
  };

  document.addEventListener('DOMContentLoaded', () => {
    const u = document.getElementById('l-user'), p = document.getElementById('l-pw');
    if (u) u.value = 'demo'; if (p) p.value = 'demo';
  });
})();
