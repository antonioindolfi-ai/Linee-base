/*
 * Scadenzario – script di Excel (Office Script) da usare con Power Automate
 *
 * Riceve dal flusso il testo di una email, ne estrae le scadenze con le stesse regole di scadenzario.html
 * e restituisce l'elenco degli eventi da creare nel calendario Outlook.
 * Tiene un registro nel foglio «Registro» di questa cartella di lavoro. Il registro serve a evitare i duplicati
 * (la stessa scadenza ripetuta in risposte e inoltri) e a ricostruire che cosa è stato trovato e perché.
 *
 * Lo script non contatta nessun servizio: lavora solo sul testo ricevuto e su questa cartella di lavoro.
 */

/* ======================= Impostazioni (modificabili) ======================= */

/** true: crea un evento anche per le date ad affidabilità media, con il prefisso PREFISSO_MEDIA. */
const CREA_ANCHE_MEDIA: boolean = true;
/** Promemoria: quanti giorni prima della scadenza (almeno 1). */
const PROMEMORIA_GIORNI: number = 3;
/** Ora del promemoria per le scadenze senza orario (da 0 a 23). */
const ORA_PROMEMORIA: number = 9;
/** Santo patrono considerato festivo, nel formato gg/mm; "" per nessuno. Roma: 29/06. */
const SANTO_PATRONO: string = "29/06";
/** Testo anteposto al titolo degli eventi creati. */
const PREFISSO_ALTA: string = "[Da verificare] ";
const PREFISSO_MEDIA: string = "[Possibile scadenza] ";
/** true se il campo Corpo dell'evento interpreta l'HTML (a capo con <br>); false per testo semplice. */
const DESCRIZIONE_HTML: boolean = true;

/* ======================= Tipi ======================= */

interface Evento {
  titolo: string;
  inizio: string;
  fine: string;
  tuttoIlGiorno: boolean;
  descrizione: string;
  promemoriaMinuti: number;
}
interface Contesto { text: string; hlStart: number; hlEnd: number; }
interface Candidato {
  start: number; end: number; kind: string; date: Date; time: string; warns: string[];
  ctx: Contesto; category: string; score: number; conf: string; warnFeriale: boolean;
}
interface Categoria { id: string; short: string; re: RegExp | null; }
type Cella = string | number | boolean;

/* ======================= Funzione principale ======================= */

function main(workbook: ExcelScript.Workbook, oggetto: string, corpo: string, ricevuta: string, mittente: string, idEmail: string): Evento[] {
  const sogg = oggetto || "", mitt = mittente || "", testoGrezzo = corpo || "";
  const ms = Date.parse(ricevuta || "");
  const ricevutaRoma = oraDiRoma(isNaN(ms) ? Date.now() : ms);
  const testo = sembraHtml(testoGrezzo) ? htmlToText(testoGrezzo) : testoGrezzo.replace(/\r\n?/g, "\n");
  const candidati = estrai(testo, startOfDay(ricevutaRoma), sogg);

  const tabella = registro(workbook);
  const giaCreati = chiaviCreate(tabella);
  const adesso = fmtDataOra(oraDiRoma(Date.now()));
  const eventi: Evento[] = [];
  const righe: Cella[][] = [];
  for (const c of candidati) {
    const chiave = ymd(c.date) + "|" + c.time + "|" + normalizza(c.ctx.text).slice(0, 160);
    const daCreare = c.conf === "alta" || (c.conf === "media" && CREA_ANCHE_MEDIA);
    let esito: string;
    if (!daCreare) esito = "Non creato: affidabilità " + c.conf;
    else if (giaCreati[chiave]) esito = ESITO_DOPPIO;
    else {
      esito = ESITO_CREATO;
      giaCreati[chiave] = true;
      eventi.push(creaEvento(c, sogg, mitt, ricevutaRoma));
    }
    righe.push([adesso, ymd(c.date), c.time, catById(c.category).short, testoCella(titoloBase(c, sogg)), c.conf, esito,
      testoCella(c.ctx.text), testoCella(c.warns.join("; ")), testoCella(sogg), testoCella(mitt), fmtDataOra(ricevutaRoma),
      testoCella(chiave), testoCella(idEmail || "")]);
  }
  aggiungiRighe(tabella, righe);
  return eventi;
}

/* ======================= Eventi ======================= */

function titoloBase(c: Candidato, oggetto: string): string {
  const s = pulisciOggetto(oggetto);
  return catById(c.category).short + ": " + (s || c.ctx.text.slice(0, 70));
}
function creaEvento(c: Candidato, oggetto: string, mittente: string, ricevuta: Date): Evento {
  const titolo = ((c.conf === "alta" ? PREFISSO_ALTA : PREFISSO_MEDIA) + titoloBase(c, oggetto)).slice(0, 250);
  const giorni = Math.max(1, PROMEMORIA_GIORNI);
  let inizio: string, fine: string, tuttoIlGiorno: boolean, promemoria: number;
  if (c.time) {
    const h = parseInt(c.time.slice(0, 2), 10), mi = parseInt(c.time.slice(3, 5), 10);
    const a = new Date(Date.UTC(c.date.getUTCFullYear(), c.date.getUTCMonth(), c.date.getUTCDate(), h, mi));
    inizio = isoLocale(a); fine = isoLocale(new Date(a.getTime() + 3600000)); tuttoIlGiorno = false;
    promemoria = giorni * 1440;
  } else {
    inizio = ymd(c.date) + "T00:00:00"; fine = ymd(addDays(c.date, 1)) + "T00:00:00"; tuttoIlGiorno = true;
    promemoria = Math.max(0, giorni * 1440 - Math.min(23, Math.max(0, ORA_PROMEMORIA)) * 60);
  }
  const righe: string[] = [
    "Scadenza individuata automaticamente dallo Scadenzario: verificala sulla email originale.",
    "",
    "Frase: «" + c.ctx.text + "»",
  ];
  if (c.warns.length > 0) righe.push("Avvisi: " + c.warns.join("; "));
  righe.push("Email: " + (oggetto || "(senza oggetto)") + (mittente ? " – " + mittente : "") + " (ricevuta il " + fmtDataOra(ricevuta) + ")");
  righe.push("Affidabilità: " + c.conf);
  const descrizione = DESCRIZIONE_HTML ? righe.map((r) => escHtml(r)).join("<br>") : righe.join("\n");
  return { titolo: titolo, inizio: inizio, fine: fine, tuttoIlGiorno: tuttoIlGiorno, descrizione: descrizione, promemoriaMinuti: promemoria };
}
function isoLocale(d: Date): string { return ymd(d) + "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":00"; }
function escHtml(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function pulisciOggetto(s: string): string { return s.replace(/^\s*((re|r|fw|fwd|i|inoltro|rif|posta certificata|r\/i)\s*:\s*)+/i, "").trim(); }
function normalizza(s: string): string { return s.toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, " ").trim(); }

/* ======================= Registro nella cartella di lavoro ======================= */

const ESITO_CREATO = "Evento creato";
const ESITO_DOPPIO = "Già presente: non duplicato";
const COLONNE: string[] = ["Registrato il", "Data", "Ora", "Categoria", "Titolo", "Affidabilità", "Esito", "Frase di origine",
  "Avvisi", "Oggetto email", "Mittente", "Ricevuta il", "Chiave", "ID email"];

function registro(wb: ExcelScript.Workbook): ExcelScript.Table {
  const esistente = wb.getTable("RegistroScadenze");
  if (esistente) return esistente;
  let foglio = wb.getWorksheet("Registro");
  if (!foglio) foglio = wb.addWorksheet("Registro");
  const intestazione = foglio.getRangeByIndexes(0, 0, 1, COLONNE.length);
  intestazione.setValues([COLONNE]);
  const t = foglio.addTable(intestazione, true);
  t.setName("RegistroScadenze");
  return t;
}
function chiaviCreate(t: ExcelScript.Table): { [k: string]: boolean } {
  const out: { [k: string]: boolean } = {};
  if (t.getRowCount() === 0) return out;
  const colChiave = t.getColumnByName("Chiave"), colEsito = t.getColumnByName("Esito");
  if (!colChiave || !colEsito) return out;
  const chiavi = colChiave.getRangeBetweenHeaderAndTotal().getValues();
  const esiti = colEsito.getRangeBetweenHeaderAndTotal().getValues();
  for (let i = 0; i < chiavi.length; i++) {
    const k = String(chiavi[i][0]).replace(/^'/, "");
    if (k && i < esiti.length && String(esiti[i][0]) === ESITO_CREATO) out[k] = true;
  }
  return out;
}
function aggiungiRighe(t: ExcelScript.Table, righe: Cella[][]): void {
  if (righe.length === 0) return;
  let resto = righe;
  if (t.getRowCount() === 1) { // una tabella appena creata può avere una riga vuota: la riempie
    const corpo = t.getRangeBetweenHeaderAndTotal();
    const valori = corpo.getValues();
    if (valori.length === 1 && valori[0].every((v) => v === "")) { corpo.setValues([righe[0]]); resto = righe.slice(1); }
  }
  if (resto.length > 0) t.addRows(-1, resto);
}
/** Testo sicuro per una cella: niente caratteri di controllo e nessuna formula (= + - @ iniziali diventano testo). */
function testoCella(s: string): string {
  const t = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 32000);
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}

/* ======================= Testo della email ======================= */

function sembraHtml(s: string): boolean { return /<(html|body|div|p|br|span|table|td|font)[\s>\/]/i.test(s); }
const ENTITA: { [k: string]: string } = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", agrave: "à", aacute: "á", egrave: "è", eacute: "é",
  igrave: "ì", iacute: "í", ograve: "ò", oacute: "ó", ugrave: "ù", uacute: "ú", Agrave: "À", Egrave: "È", Eacute: "É",
  Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù", laquo: "«", raquo: "»", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", hellip: "…", euro: "€", deg: "°", ordm: "º", ordf: "ª", middot: "·", bull: "•", sect: "§",
  copy: "©", reg: "®", trade: "™", ccedil: "ç", Ccedil: "Ç", ntilde: "ñ", auml: "ä", euml: "ë", iuml: "ï", ouml: "ö",
  uuml: "ü", acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û", times: "×", shy: "", zwnj: "", zwj: "",
};
function decodificaEntita(s: string): string {
  const re = /&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,8});/g;
  let out = "", ultimo = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out += s.slice(ultimo, m.index);
    const e = m[1];
    let r = m[0];
    if (e.charAt(0) === "#") {
      const n = e.charAt(1) === "x" || e.charAt(1) === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (n > 0 && n < 0x110000 && !(n >= 0xD800 && n <= 0xDFFF)) r = String.fromCodePoint(n);
    } else if (Object.prototype.hasOwnProperty.call(ENTITA, e)) r = ENTITA[e];
    out += r;
    ultimo = m.index + m[0].length;
  }
  return out + s.slice(ultimo);
}
function htmlToText(html: string): string {
  let s = html.replace(/[\r\n]+/g, " ");                                        // nell'HTML gli a capo valgono come spazi
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(head|style|script|title|xml|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<br\b[^>]*>/gi, "\n").replace(/<hr\b[^>]*>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n");
  s = s.replace(/<\/(td|th)\s*>/gi, " ");
  s = s.replace(/<[^>]*>/g, "");
  s = decodificaEntita(s);
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ======================= Date (sempre come giorni di calendario, senza fuso) ======================= */

function pad(n: number): string { return (n < 10 ? "0" : "") + n; }
function D(y: number, m: number, d: number): Date { return new Date(Date.UTC(y, m - 1, d)); }
function valid(y: number, m: number, d: number): Date | null {
  const x = D(y, m, d);
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x : null;
}
function addDays(d: Date, n: number): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)); }
function startOfDay(d: Date): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function ymd(d: Date): string { return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
function fmtShort(d: Date): string { return pad(d.getUTCDate()) + "/" + pad(d.getUTCMonth() + 1) + "/" + d.getUTCFullYear(); }
function fmtDataOra(d: Date): string { return fmtShort(d) + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); }
/** Ora di Roma (ora legale dall'ultima domenica di marzo all'ultima di ottobre, alle 01:00 UTC). */
function ultimaDomenicaUTC(y: number, mese: number): number {
  const ultimo = new Date(Date.UTC(y, mese, 0));
  return Date.UTC(y, mese - 1, ultimo.getUTCDate() - ultimo.getUTCDay(), 1, 0, 0);
}
function oraDiRoma(ms: number): Date {
  const y = new Date(ms).getUTCFullYear();
  const legale = ms >= ultimaDomenicaUTC(y, 3) && ms < ultimaDomenicaUTC(y, 10);
  return new Date(ms + (legale ? 2 : 1) * 3600000);
}

/* ======================= Festività italiane ======================= */

function easter(y: number): Date { // algoritmo gregoriano anonimo (Meeus/Jones/Butcher)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return D(y, month, day);
}
const festeCache: { [anno: string]: { [giorno: string]: string } } = {};
function holidays(y: number): { [giorno: string]: string } {
  const chiave = String(y);
  if (festeCache[chiave]) return festeCache[chiave];
  const m: { [giorno: string]: string } = {};
  const fisse: [number, number, string][] = [[1, 1, "Capodanno"], [1, 6, "Epifania"], [4, 25, "Festa della Liberazione"],
    [5, 1, "Festa del Lavoro"], [6, 2, "Festa della Repubblica"], [8, 15, "Ferragosto"], [11, 1, "Ognissanti"],
    [12, 8, "Immacolata"], [12, 25, "Natale"], [12, 26, "Santo Stefano"]];
  for (const f of fisse) m[y + "-" + pad(f[0]) + "-" + pad(f[1])] = f[2];
  if (y >= 2026) m[y + "-10-04"] = "San Francesco"; // festività nazionale ripristinata dal 2026
  const e = easter(y);
  m[ymd(e)] = "Pasqua";
  m[ymd(addDays(e, 1))] = "Lunedì dell’Angelo";
  const p = /^(\d{1,2})\/(\d{1,2})$/.exec(SANTO_PATRONO);
  if (p) {
    const k = y + "-" + pad(parseInt(p[2], 10)) + "-" + pad(parseInt(p[1], 10));
    if (!m[k]) m[k] = "Santo patrono";
  }
  festeCache[chiave] = m;
  return m;
}
function holidayName(d: Date): string { return holidays(d.getUTCFullYear())[ymd(d)] || ""; }
function isWorkday(d: Date): boolean { return d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidayName(d); }
function dayWarnings(d: Date): string[] {
  const w: string[] = [], h = holidayName(d);
  if (h) w.push("Cade in un giorno festivo (" + h + ")");
  else if (d.getUTCDay() === 0) w.push("Cade di domenica");
  else if (d.getUTCDay() === 6) w.push("Cade di sabato");
  return w;
}

/* ======================= Estrazione (stesse regole di scadenzario.html) ======================= */

const CATS: Categoria[] = [
  { id: "udienza", short: "Udienza", re: /udienz|camera di consiglio|comparizion/ },
  { id: "sindacato", short: "Sindacato ispettivo", re: /interrogazion|interpellanz|sindacato ispettivo|question time|atto (?:camera|senato)|\b[345]-\d{4,6}\b/ },
  { id: "contenzioso", short: "Contenzioso", re: /ricors|avvocatura|\btar\b|consiglio di stato|tribunal|corte dei conti|corte d'appello|sentenz|ordinanz|memori[ae]|controdeduz|relazione (?:difensiva|istruttoria)|costituzione in giudizio|decreto ingiuntiv|atto di citazione|diffida|contenzios|patrocinio|giudizio/ },
  { id: "liquidazioni", short: "Liquidazione", re: /liquidaz|pagament|fattur|parcell|spese legali|compens|gettoni|emolument|impegno di spesa/ },
  { id: "adempimenti", short: "Adempimento", re: /performance|anticorruzion|ptpct|\bpiao\b|trasparenz|obiettiv|monitoraggi|privacy|gdpr|dati personali|rendicontaz/ },
  { id: "riunione", short: "Riunione", re: /riunion|incontro|convocazion|convocat[aoie]|\bcall\b|videoconferenz|\bteams\b|seduta|tavolo tecnico|appuntamento|webinar|conferenza di servizi/ },
  { id: "scadenza", short: "Scadenza", re: null },
];
function catById(id: string): Categoria {
  for (const c of CATS) if (c.id === id) return c;
  return CATS[CATS.length - 1];
}

const LET = "\\wàèéìòùÀÈÉÌÒÙ";
const PRIMA = "(^|[^" + LET + "])"; // carattere che precede la data (al posto del lookbehind di scadenzario.html)
const EB = "(?![" + LET + "])";
const WDRE = "luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica";
const MFULL = "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre";
const MABBR = "gen|feb|mar|apr|mag|giu|lug|ago|sett|set|ott|nov|dic";
const MONTH: { [k: string]: number } = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12 };
const NUMW: { [k: string]: number } = { uno: 1, un: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9,
  dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18,
  diciannove: 19, venti: 20, trenta: 30, quaranta: 40, quarantacinque: 45, sessanta: 60, novanta: 90, centoventi: 120, centottanta: 180 };
const NUMRE = Object.keys(NUMW).sort((a, b) => b.length - a.length).join("|");

const RE_NUM = /(^|[^\d./-])(\d{1,2})([./-])(\d{1,2})\3(\d{4}|\d{2})(?!\d|[./-]\d)/g;
const RE_NUM_NO_ANNO = /(^|[^\d./-])(\d{1,2})([./])(\d{1,2})(?![\d/]|[.-]\d)/g;
const RE_TEXT = new RegExp(PRIMA + "(?:(" + WDRE + ")(?:\\s*,\\s*|\\s+))?(\\d{1,2})\\s*(?:°|º)?\\s*(?:(" + MFULL + ")" + EB + "|(" + MABBR
  + ")(?:\\.|(?=\\s*(?:'\\d{2}|\\d{4})" + EB + ")))(?:\\s*,?\\s*(\\d{4})" + EB + "|\\s*'(\\d{2})" + EB + ")?", "gi");
const RE_REL = new RegExp(PRIMA + "(?:entro\\s+e\\s+non\\s+oltre|entro|non\\s+oltre|nel\\s+termine(?:\\s+(?:perentorio|massimo|ultimo))?\\s+di|termine(?:\\s+(?:perentorio|massimo))?\\s+di)"
  + "\\s+(?:(?:i|il|gli)\\s+)?(?:successivi\\s+|prossimi\\s+)?(\\d{1,3}|" + NUMRE + ")\\s*(?:\\(\\s*[a-zà-ù]+\\s*\\)\\s*)?(giorni|giorno|gg|settimane|settimana|mesi|mese)"
  + EB + "\\.?(?:\\s+(lavorativi|feriali|utili|naturali(?:\\s+e\\s+consecutivi)?|solari|liberi|di\\s+calendario)" + EB + ")?", "gi");
const RE_QUICK = new RegExp(PRIMA + "(?:entro|per|non\\s+oltre|al\\s+pi[uù]\\s+tardi)\\s+(?:la\\s+giornata\\s+di\\s+|il\\s+giorno\\s+di\\s+)?"
  + "(oggi|stasera|dopodomani|domani|fine\\s+giornata|(?:la\\s+)?fine\\s+(?:della\\s+)?settimana|(?:la\\s+)?fine\\s+(?:del\\s+)?mese"
  + "|(?:la\\s+)?fine\\s+(?:dell['’]\\s*)?anno|(?:il\\s+)?prossimo\\s+(?:" + WDRE + ")|(?:" + WDRE + ")(?:\\s+prossimo)?)" + EB, "gi");

function tutte(re: RegExp, s: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) { out.push(m); if (m[0].length === 0) re.lastIndex++; }
  return out;
}
function wdIdx(s: string): number {
  return ["domenica", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato"].indexOf(s.toLowerCase().replace("ì", "i"));
}
function inferYear(m: number, d: number, ref: Date): Date | null {
  let x = valid(ref.getUTCFullYear(), m, d);
  if (!x) return null;
  if (x.getTime() < addDays(startOfDay(ref), -90).getTime()) x = valid(ref.getUTCFullYear() + 1, m, d);
  return x;
}
function addWorkdays(d: Date, n: number): Date {
  let x = d, k = 0;
  while (k < n) { x = addDays(x, 1); if (isWorkday(x)) k++; }
  return x;
}
function addMonths(d: Date, n: number): Date {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d.getUTCDate(), last)));
}
function findTime(text: string, start: number, end: number): string {
  const after = text.slice(end, end + 45);
  let m = /^[\s,;–-]*((?:entro\s+le|a\s+partire\s+dalle|dalle|alle|ore|h\.?)\s*(?:ore\s*)?)?(\d{1,2})(?:[:.](\d{2})(?!\d))?(?![\d/])/i.exec(after);
  if (m && (m[1] || typeof m[3] === "string")) {
    const h = parseInt(m[2], 10), mi = typeof m[3] === "string" ? parseInt(m[3], 10) : 0;
    if (h <= 23 && mi <= 59) return pad(h) + ":" + pad(mi);
  }
  const before = text.slice(Math.max(0, start - 45), start);
  m = new RegExp("(?:alle\\s+ore|alle|ore|h\\.?)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:del(?:\\s+giorno)?|di|,)?\\s*(?:" + WDRE + ")?\\s*,?\\s*$", "i").exec(before);
  if (m) {
    const h = parseInt(m[1], 10), mi = typeof m[2] === "string" ? parseInt(m[2], 10) : 0;
    if (h <= 23 && mi <= 59) return pad(h) + ":" + pad(mi);
  }
  return "";
}
function sentence(text: string, start: number, end: number): Contesto {
  const s = Math.max(0, start - 220), e = Math.min(text.length, end + 220);
  const before = text.slice(s, start), after = text.slice(end, e);
  const nl = before.lastIndexOf("\n");
  let bs = nl >= 0 ? nl + 1 : 0;
  const reFine = /[.!?;](?=\s+[A-ZÀ-Ú])/g;
  let sm: RegExpExecArray | null, ultimo = -1;
  while ((sm = reFine.exec(before)) !== null) ultimo = sm.index;
  if (ultimo >= 0 && ultimo + 1 > bs) bs = ultimo + 1;
  let ae = after.length;
  const an = after.indexOf("\n");
  if (an >= 0) ae = an;
  const am = /[.!?;](?=\s+[A-ZÀ-Ú]|\s*$)/.exec(after);
  if (am && am.index + 1 < ae) ae = am.index + 1;
  // se la frase è spezzata a capo (testo a larghezza fissa) la allunga di 1 riga, ma non se la riga finisce con la punteggiatura o la successiva è un elenco
  if (ae === an && an >= 0 && an < 60 && !/[.!?;:]\s*$/.test(after.slice(0, an)) && !/^\s*[-•*–]/.test(after.slice(an + 1))) { const nx = after.indexOf("\n", an + 1); ae = nx > 0 ? nx : after.length; }
  return { text: text.slice(s + bs, end + ae).replace(/\s+/g, " ").trim(), hlStart: start - (s + bs), hlEnd: end - (s + bs) };
}
function classify(ctx: string, subject: string): string {
  const c = ctx.toLowerCase(), sj = (subject || "").toLowerCase();
  for (const cat of CATS) if (cat.re && cat.re.test(c)) return cat.id;
  for (const cat of CATS) if (cat.re && cat.re.test(sj)) return cat.id;
  return "scadenza";
}
function isQuotedHeader(text: string, start: number): boolean {
  const ls = text.lastIndexOf("\n", start - 1) + 1, le = text.indexOf("\n", start);
  const line = text.slice(ls, le < 0 ? text.length : le);
  if (/^\s*>*\s*(inviato|data|date|sent|inviato il)\s*:/i.test(line)) return true;
  if (/^\s*>*\s*(il giorno|in data|on)\b/i.test(line)) {
    const block = text.slice(ls, ls + 350).split(/\n\s*\n/)[0];
    if (/(ha scritto|wrote)\s*:/i.test(block)) return true;
  }
  return false;
}
function score(c: Candidato, text: string, ref: Date): number {
  const pre = text.slice(Math.max(0, c.start - 70), c.start).toLowerCase().replace(/\s+/g, " ");
  const near = pre.slice(-32), post = text.slice(c.end, c.end + 60).toLowerCase().replace(/\s+/g, " ");
  let s = 0;
  if (c.kind !== "abs") s += 4;
  else {
    if (/(entro|non oltre|scadenz|scade|termin[ei]|fissat[aoie]|rinviat[aoie]|differit[aoie]|prorogat[aoie]|posticipat[aoie]|anticipat[aoie]|deadline|ultimo giorno|improrogabil|perentori|tassativ|previst[aoie] per|programmat[aoie] per|per il giorno|si terr[aà]|avr[aà] luogo|convocat[aoie]|indett[aoie]|fino al|appuntamento)/.test(pre.slice(-48))
      || /\bper (?:il|giorno)\s*$/.test(near)) s += 3;
    if (/(udienz|riunion|incontro|seduta|\bcall\b|videoconferenz|convocazion|tavolo|webinar|camera di consiglio|evento)/.test(pre.slice(-60))) s += 2;
    if (/^[^.\n]{0,40}(si terr|avr[aà] luogo|scadenza|scade|è fissat|sono convocat|è convocat|termine ultimo|ultimo giorno)/.test(post)) s += 3;
    else if (/^[^.\n]{0,40}(riunion|udienz|incontro)/.test(post)) s += 2;
    const eventDel = /(udienz[ae]|riunion[ei]|sedut[ae]|incontr[oi]|camera di consiglio|convocazion[ei]|termine|scadenza|call)\s+(?:fissat[ao]\s+)?(?:del|per\s+il|per)\s*(?:giorno\s+)?$/.test(near);
    const isRef = /(?:\bdel|\bin data|\bdatat[ao]|\bpervenut[ao]|\bricevut[ao]|\binviat[ao]|\btrasmess[ao]|\bsottoscritt[ao]|\bfirmat[ao]|\bemess[ao]|\bdepositat[ao]|\bnotificat[ao]|\bpubblicat[ao]|\bsvolt[ao]si|\btenut[ao]si|\bprotocollat[ao]|\bdecorrenza)\s*(?:il\s+|in\s+data\s+|giorno\s+|data\s+)?$/.test(near);
    if (isRef && !eventDel) s -= 3;
    if (/(?:legge|\bl\.|d\.\s?lgs\.?|dlgs|d\.\s?l\.|\bdl\b|d\.\s?p\.\s?r\.|\bdpr\b|d\.\s?m\.|\bdm\b|dpcm|decreto(?:\s+\w+)?|circolare|\bnota|sentenza|ordinanza|delibera(?:zione)?|regolamento|direttiva|prot(?:ocollo)?\.?)\s*(?:n\.?\s*[\w\/.-]+\s*)?(?:,\s*)?(?:del\s*)?$/.test(near)) s -= 4;
    if (/^\s*,?\s*(?:n\.|n°|num\.)\s*\d/.test(post)) s -= 4;
    if (c.time) s += 1;
  }
  const ctx = c.ctx.text.toLowerCase();
  if (/ammesso ricorso|può essere proposto ricorso|possibile (?:proporre|presentare) ricorso|ricorso straordinario al presidente/.test(ctx)) {
    s -= 6; c.warns.push("Sembra una formula di rito sui termini di impugnazione");
  }
  if (c.category !== "scadenza") s += 1;
  const today = startOfDay(ref);
  if (c.date.getTime() < today.getTime()) { s -= 5; c.warns.push("Data già passata rispetto alla email"); }
  if (c.date.getTime() > addDays(today, 365 * 3).getTime()) s -= 2;
  return s;
}

/** Estrae le possibili scadenze da un testo. ref è il giorno della email (come giorno di calendario). */
function estrai(rawText: string, ref: Date, subject: string): Candidato[] {
  const text = (subject ? "Oggetto: " + subject + "\n" : "") + rawText
    .replace(/\r\n?/g, "\n").replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "")
    .replace(/^[ \t]*>[ >\t]*/gm, "");
  const found: Candidato[] = [];
  const taken: number[][] = [];
  function overlaps(a: number, b: number): boolean {
    for (const t of taken) if (a < t[1] && b > t[0]) return true;
    return false;
  }
  function push(start: number, end: number, kind: string, date: Date | null, warns: string[], warnFeriale: boolean): void {
    if (!date || overlaps(start, end) || isQuotedHeader(text, start)) return;
    taken.push([start, end]);
    found.push({ start: start, end: end, kind: kind, date: date, time: "", warns: warns, ctx: { text: "", hlStart: 0, hlEnd: 0 },
      category: "scadenza", score: 0, conf: "bassa", warnFeriale: warnFeriale });
  }

  for (const m of tutte(RE_NUM, text)) {
    const start = m.index + m[1].length;
    let y = parseInt(m[5], 10);
    if (m[5].length === 2) { if (m[3] === ".") continue; y += 2000; }
    if (y < 1990 || y > 2100) continue;
    push(start, m.index + m[0].length, "abs", valid(y, parseInt(m[4], 10), parseInt(m[2], 10)), [], false);
  }
  for (const m of tutte(RE_TEXT, text)) {
    const start = m.index + m[1].length, end = m.index + m[0].length;
    const mon = MONTH[(m[4] ? m[4] : m[5]).slice(0, 3).toLowerCase()];
    const day = parseInt(m[3], 10);
    const warns: string[] = [];
    let date: Date | null;
    if (m[6]) date = valid(parseInt(m[6], 10), mon, day);
    else if (m[7]) date = valid(2000 + parseInt(m[7], 10), mon, day);
    else { date = inferYear(mon, day, ref); if (date) warns.push("Anno non indicato: dedotto " + date.getUTCFullYear()); }
    if (date && m[2] && wdIdx(m[2]) !== date.getUTCDay()) warns.push("Il giorno della settimana indicato (" + m[2] + ") non corrisponde alla data: verificare");
    push(start, end, "abs", date, warns, false);
  }
  for (const m of tutte(RE_REL, text)) {
    const start = m.index + m[1].length, end = m.index + m[0].length;
    const nRaw = m[2].toLowerCase();
    const n = Object.prototype.hasOwnProperty.call(NUMW, nRaw) ? NUMW[nRaw] : parseInt(nRaw, 10);
    const unit = m[3].toLowerCase(), qual = (m[4] || "").toLowerCase();
    if (!n || n > 400) continue;
    const r0 = startOfDay(ref);
    let d: Date;
    if (/^(giorni|giorno|gg)$/.test(unit)) d = /lavorativ|feriali|utili/.test(qual) ? addWorkdays(r0, n) : addDays(r0, n);
    else if (/^settiman/.test(unit)) d = addDays(r0, 7 * n);
    else d = addMonths(r0, n);
    const warns = ["Termine relativo: " + n + " " + unit + (qual ? " " + qual : "") + " calcolati dalla data della email (" + fmtShort(r0) + "). Verificare la data di decorrenza effettiva"];
    let feriale = false;
    for (let y = r0.getUTCFullYear(); y <= d.getUTCFullYear(); y++) {
      if (r0.getTime() <= D(y, 8, 31).getTime() && d.getTime() >= D(y, 8, 1).getTime()) { feriale = true; break; }
    }
    push(start, end, "rel", d, warns, feriale);
  }
  for (const m of tutte(RE_QUICK, text)) {
    const start = m.index + m[1].length, end = m.index + m[0].length;
    const w = m[2].toLowerCase().replace(/\s+/g, " "), r0 = startOfDay(ref);
    let d: Date | null = null;
    if (/oggi|stasera|fine giornata/.test(w)) d = r0;
    else if (w === "dopodomani") d = addDays(r0, 2);
    else if (w === "domani") d = addDays(r0, 1);
    else if (/settimana/.test(w)) { const dw = r0.getUTCDay(); d = addDays(r0, dw === 6 ? 6 : dw === 0 ? 5 : 5 - dw); }
    else if (/mese/.test(w)) d = D(r0.getUTCFullYear(), r0.getUTCMonth() + 2, 0);
    else if (/anno/.test(w)) d = D(r0.getUTCFullYear(), 12, 31);
    else {
      const wm = new RegExp(WDRE, "i").exec(w);
      if (wm) { const t = wdIdx(wm[0]); let k = (t - r0.getUTCDay() + 7) % 7; if (k === 0) k = 7; d = addDays(r0, k); }
    }
    push(start, end, "quick", d, ["Data dedotta da \"" + text.slice(start, end).trim() + "\" rispetto alla email del " + fmtShort(r0)], false);
  }
  for (const m of tutte(RE_NUM_NO_ANNO, text)) {
    const start = m.index + m[1].length, end = m.index + m[0].length;
    const near = text.slice(Math.max(0, start - 30), start).toLowerCase();
    const wide = text.slice(Math.max(0, start - 80), start).toLowerCase();
    if (!/(entro(?: e non oltre)?(?: il)?|non oltre il|il giorno|giorno|fino al|scadenza(?: del| il)?|udienza(?: del)?|termine del|per il|previst[aoie] per il|fissat[aoie] per il|rinviat[aoie] al)\s*$/.test(near)
      && !(/(scadenz|scade|termine|entro|udienz|riunion|consegna)/.test(wide) && /(?:è|sarà|e'|resta)\s+(?:il|fissat[ao] al)\s*$/.test(near))) continue;
    const date = inferYear(parseInt(m[4], 10), parseInt(m[2], 10), ref);
    const warns: string[] = [];
    if (date) warns.push("Anno non indicato: dedotto " + date.getUTCFullYear());
    push(start, end, "abs", date, warns, false);
  }

  for (const c of found) {
    if (c.kind === "abs") c.time = findTime(text, c.start, c.end);
    c.ctx = sentence(text, c.start, c.end);
    c.category = classify(c.ctx.text, subject);
    if (c.warnFeriale && (c.category === "contenzioso" || c.category === "udienza"))
      c.warns.push("Il periodo comprende la sospensione feriale dei termini processuali (1–31 agosto): verificare");
    for (const w of dayWarnings(c.date)) c.warns.push(w);
    c.score = score(c, text, ref);
    c.conf = c.score >= 3 ? "alta" : c.score >= 1 ? "media" : "bassa";
  }
  // unisce i duplicati (stessa data e ora) tenendo il più affidabile
  const keys: string[] = [];
  const best: { [k: string]: Candidato } = {};
  for (const c of found) {
    const k = ymd(c.date) + "|" + c.time;
    if (!Object.prototype.hasOwnProperty.call(best, k)) { keys.push(k); best[k] = c; }
    else if (c.score > best[k].score) best[k] = c;
  }
  // una data senza ora è assorbita da quella con ora dello stesso giorno, se esiste
  const kept: Candidato[] = [];
  for (const k of keys) {
    const c = best[k];
    let assorbita = false;
    if (!c.time) {
      for (const k2 of keys) {
        const o = best[k2];
        if (o !== c && o.time && ymd(o.date) === ymd(c.date) && o.score >= c.score) { assorbita = true; break; }
      }
    }
    if (!assorbita) kept.push(c);
  }
  kept.sort((a, b) => (a.date.getTime() - b.date.getTime()) || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return kept;
}
