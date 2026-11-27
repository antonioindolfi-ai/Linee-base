#!/usr/bin/env python3
"""Ciclo della spesa - server autonomo per la rete interna.

Usa solo la libreria standard di Python (3.8 o successivo): nessun pacchetto
da installare e nessuna connessione verso l'esterno. I dati restano in un file
SQLite sul server; la pagina, i caratteri e gli script sono serviti da qui.

Uso su un solo PC, con copia per la consultazione sulla cartella condivisa:
  python ciclo_spesa.py inserimento --condivisa CARTELLA      (PC di chi inserisce)
  python ciclo_spesa.py consultazione --condivisa CARTELLA    (PC di chi consulta)

Uso come server per piu' utenti:
  python ciclo_spesa.py crea-admin USERNAME
  python ciclo_spesa.py avvia [--host 0.0.0.0] [--porta 8080] [--cert C --key K]
  python ciclo_spesa.py reimposta-password USERNAME
  python ciclo_spesa.py backup FILE_DESTINAZIONE
"""
import argparse
import datetime
import getpass
import hashlib
import hmac
import http.server
import json
import math
import os
import re
import secrets
import sqlite3
import ssl
import sys
import threading
import time
import shutil
import urllib.parse
import webbrowser

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")
DB_DEFAULT = os.path.join(BASE, "dati", "ciclo_spesa.sqlite3")
NOME_COPIA = "ciclo_spesa_consultazione.sqlite3"


def cartella_utente():
    """Cartella privata dell'utente di Windows (o di Linux) per i dati locali dell'app."""
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "CicloSpesa")

with open(os.path.join(STATIC, "modello.json"), encoding="utf-8") as _f:
    MODELLO = json.load(_f)
TIPI = MODELLO["TIPI"]
FASI = MODELLO["FASI"]
CONCLUSA = len(FASI)
CAMPI = {c["k"]: c for c in MODELLO["CAMPI"] if "k" in c}
VOCI = {t: {i["id"]: i for fase in d["check"] for i in fase} for t, d in TIPI.items()}

RUOLI = ("admin", "operatore", "lettura")
SESSIONE_SECONDI = 8 * 3600
PBKDF2_ITER = 310000
MAX_FALLIMENTI = 5
BLOCCO_SECONDI = 15 * 60
MAX_BODY = 1024 * 1024
LUNGH_MAX = {"note": 5000}
DATA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
USER_RE = re.compile(r"^[A-Za-z0-9._-]{3,40}$")

STATIC_FILES = {}
for _root, _dirs, _files in os.walk(STATIC):
    for _n in _files:
        _p = os.path.join(_root, _n)
        STATIC_FILES["/" + os.path.relpath(_p, STATIC).replace(os.sep, "/")] = _p
MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml"}

CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self' data:; "
       "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
       "base-uri 'none'; form-action 'self'; object-src 'none'")


class Errore(Exception):
    def __init__(self, stato, msg):
        super().__init__(msg)
        self.stato = stato
        self.msg = msg


# --------------------------------------------------------------------------
# Archivio
# --------------------------------------------------------------------------
def percorso_di_rete(path):
    """Vero se il file sta su una cartella di rete (percorso UNC o unità di rete di Windows)."""
    p = os.path.abspath(path)
    if any(x.startswith("\\\\") or x.startswith("//") for x in (path, p)):
        return True
    if os.name == "nt":
        try:
            import ctypes
            return ctypes.windll.kernel32.GetDriveTypeW(os.path.splitdrive(p)[0] + "\\") == 4  # DRIVE_REMOTE
        except Exception:
            return False
    return False


def hash_password(pw, salt=None):
    salt = salt or secrets.token_bytes(16)
    return salt, hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, PBKDF2_ITER)


def password_valida(pw):
    return isinstance(pw, str) and len(pw) >= 10 and len(pw) <= 200


class Archivio:
    def __init__(self, path):
        cartella = os.path.dirname(os.path.abspath(path))
        os.makedirs(cartella, exist_ok=True)
        if os.name == "posix":
            os.chmod(cartella, 0o700)  # solo l'utenza che esegue il server
        self.path = path
        self.lock = threading.RLock()
        nuovo = not os.path.exists(path)
        self.c = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        if nuovo and os.name == "posix":
            os.chmod(path, 0o600)
        self.c.row_factory = sqlite3.Row
        # Su una cartella di rete SQLite non può usare la modalità WAL (servirebbe memoria
        # condivisa locale): in quel caso si usa la modalità tradizionale e si avvisa.
        self.in_rete = percorso_di_rete(path)
        self.c.execute("PRAGMA journal_mode=%s" % ("DELETE" if self.in_rete else "WAL"))
        self.c.execute("PRAGMA foreign_keys=ON")
        self.c.executescript("""
        CREATE TABLE IF NOT EXISTS utenti(
          id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE,
          nome TEXT NOT NULL, ruolo TEXT NOT NULL, salt BLOB NOT NULL, hash BLOB NOT NULL,
          attivo INTEGER NOT NULL DEFAULT 1, cambio_password INTEGER NOT NULL DEFAULT 1,
          fallimenti INTEGER NOT NULL DEFAULT 0, bloccato_fino REAL NOT NULL DEFAULT 0,
          creato REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessioni(
          token_hash TEXT PRIMARY KEY, utente_id INTEGER NOT NULL REFERENCES utenti(id),
          scade REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS pratiche(
          id TEXT PRIMARY KEY, dati TEXT NOT NULL, creata REAL NOT NULL, aggiornata REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS eventi(
          id INTEGER PRIMARY KEY, ts REAL NOT NULL, utente_id INTEGER, pratica_id TEXT, msg TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS eventi_pratica ON eventi(pratica_id, ts);
        CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
        INSERT OR IGNORE INTO meta(k, v) VALUES('rev', '0');
        """)
        # Hash fittizio per rendere uniforme il tempo di risposta del login.
        self._finto = hash_password("password-inesistente")
        self.al_cambio = None  # funzione chiamata a ogni modifica (pubblicazione della copia)

    # ---- utilita ----
    def rev(self):
        return int(self.c.execute("SELECT v FROM meta WHERE k='rev'").fetchone()[0])

    def _bump(self):
        self.c.execute("UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k='rev'")
        if self.al_cambio:
            self.al_cambio()

    def meta(self, k):
        r = self.c.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
        return r[0] if r else None

    def utente_locale(self, username, nome):
        """Utenza che rappresenta l'utente di Windows nella modalita' inserimento."""
        with self.lock:
            r = self.c.execute("SELECT * FROM utenti WHERE username=?", (username,)).fetchone()
            if not r:
                salt, h = hash_password(secrets.token_urlsafe(32))  # password inutilizzabile: si entra solo dal PC
                self.c.execute("INSERT INTO utenti(username, nome, ruolo, salt, hash, cambio_password, creato) VALUES(?,?,?,?,?,0,?)",
                               (username, nome, "admin", salt, h, time.time()))
                self.evento(None, None, "Prima apertura della postazione di inserimento da parte di %s" % nome)
                r = self.c.execute("SELECT * FROM utenti WHERE username=?", (username,)).fetchone()
            return dict(r)

    def pubblica(self, cartella, autore):
        """Scrive sulla cartella condivisa una copia coerente per la consultazione, senza password ne' sessioni."""
        tmp = os.path.join(cartella, ".%s.%s.tmp" % (NOME_COPIA, secrets.token_hex(4)))
        try:
            dst = sqlite3.connect(tmp)
            try:
                with self.lock:
                    self.c.backup(dst)
                dst.execute("PRAGMA journal_mode=DELETE")
                dst.execute("DELETE FROM sessioni")
                dst.execute("UPDATE utenti SET salt=x'', hash=x'', fallimenti=0, bloccato_fino=0")
                dst.execute("INSERT OR REPLACE INTO meta(k, v) VALUES('pubblicata', ?)", (str(time.time()),))
                dst.execute("INSERT OR REPLACE INTO meta(k, v) VALUES('autore', ?)", (autore,))
                dst.commit()
                dst.execute("VACUUM")
            finally:
                dst.close()
            for _ in range(10):
                try:
                    os.replace(tmp, os.path.join(cartella, NOME_COPIA))
                    return
                except PermissionError:  # su Windows: copia aperta in quel momento da chi consulta
                    time.sleep(0.5)
            raise OSError("la copia sulla cartella condivisa e' in uso, riprovo tra poco")
        finally:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

    def evento(self, uid, pid, msg):
        self.c.execute("INSERT INTO eventi(ts, utente_id, pratica_id, msg) VALUES(?,?,?,?)",
                       (time.time(), uid, pid, msg[:1000]))

    # ---- utenti ----
    def crea_utente(self, username, nome, ruolo, password, cambio=True, da=None):
        if not USER_RE.match(username or ""):
            raise Errore(400, "Nome utente non valido: 3-40 caratteri tra lettere, cifre, punto, trattino e trattino basso.")
        if ruolo not in RUOLI:
            raise Errore(400, "Ruolo non valido.")
        nome = (nome or "").strip()[:80] or username
        if not password_valida(password):
            raise Errore(400, "La password deve avere almeno 10 caratteri.")
        salt, h = hash_password(password)
        with self.lock:
            try:
                cur = self.c.execute(
                    "INSERT INTO utenti(username, nome, ruolo, salt, hash, cambio_password, creato) VALUES(?,?,?,?,?,?,?)",
                    (username, nome, ruolo, salt, h, 1 if cambio else 0, time.time()))
            except sqlite3.IntegrityError:
                raise Errore(409, "Esiste già un utente con questo nome utente.")
            self.evento(da, None, "Creato l'utente %s (%s)" % (username, ruolo))
            self._bump()
            return cur.lastrowid

    def imposta_password(self, uid, password, cambio, da=None, msg=None):
        if not password_valida(password):
            raise Errore(400, "La password deve avere almeno 10 caratteri.")
        salt, h = hash_password(password)
        with self.lock:
            self.c.execute("UPDATE utenti SET salt=?, hash=?, cambio_password=?, fallimenti=0, bloccato_fino=0 WHERE id=?",
                           (salt, h, 1 if cambio else 0, uid))
            self.c.execute("DELETE FROM sessioni WHERE utente_id=?", (uid,))
            if msg:
                self.evento(da, None, msg)

    def verifica(self, username, password):
        with self.lock:
            u = self.c.execute("SELECT * FROM utenti WHERE username=?", (username or "",)).fetchone()
            ora = time.time()
            if not u or not u["attivo"]:
                hmac.compare_digest(hash_password(password or "", self._finto[0])[1], self._finto[1])
                return None
            if u["bloccato_fino"] > ora:
                raise Errore(429, "Troppi tentativi errati: riprova tra qualche minuto.")
            _, h = hash_password(password or "", u["salt"])
            if not hmac.compare_digest(h, u["hash"]):
                f = u["fallimenti"] + 1
                blocco = ora + BLOCCO_SECONDI if f >= MAX_FALLIMENTI else 0
                self.c.execute("UPDATE utenti SET fallimenti=?, bloccato_fino=? WHERE id=?",
                               (0 if blocco else f, blocco, u["id"]))
                if blocco:
                    self.evento(None, None, "Utenza %s bloccata per 15 minuti dopo %d tentativi errati" % (u["username"], f))
                return None
            self.c.execute("UPDATE utenti SET fallimenti=0, bloccato_fino=0 WHERE id=?", (u["id"],))
            return u

    def nuova_sessione(self, uid):
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.c.execute("DELETE FROM sessioni WHERE scade < ?", (time.time(),))
            self.c.execute("INSERT INTO sessioni(token_hash, utente_id, scade) VALUES(?,?,?)",
                           (hashlib.sha256(token.encode()).hexdigest(), uid, time.time() + SESSIONE_SECONDI))
        return token

    def utente_da_token(self, token):
        if not token:
            return None
        th = hashlib.sha256(token.encode()).hexdigest()
        with self.lock:
            r = self.c.execute(
                "SELECT u.* FROM sessioni s JOIN utenti u ON u.id=s.utente_id WHERE s.token_hash=? AND s.scade>? AND u.attivo=1",
                (th, time.time())).fetchone()
            return r

    def chiudi_sessione(self, token):
        if token:
            with self.lock:
                self.c.execute("DELETE FROM sessioni WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))

    def utenti(self, admin):
        rows = self.c.execute("SELECT id, username, nome, ruolo, attivo FROM utenti ORDER BY nome COLLATE NOCASE").fetchall()
        out = []
        for r in rows:
            d = {"id": r["id"], "nome": r["nome"], "ruolo": r["ruolo"], "attivo": bool(r["attivo"])}
            if admin:
                d["username"] = r["username"]
            out.append(d)
        return out

    def modifica_utente(self, me, uid, body):
        with self.lock:
            u = self.c.execute("SELECT * FROM utenti WHERE id=?", (uid,)).fetchone()
            if not u:
                raise Errore(404, "Utente inesistente.")
            nuova = None
            if "nome" in body:
                nome = str(body["nome"]).strip()[:80]
                if not nome:
                    raise Errore(400, "Il nome non può essere vuoto.")
                self.c.execute("UPDATE utenti SET nome=? WHERE id=?", (nome, uid))
            if "ruolo" in body:
                if body["ruolo"] not in RUOLI:
                    raise Errore(400, "Ruolo non valido.")
                if uid == me["id"] and body["ruolo"] != "admin":
                    raise Errore(400, "Non puoi togliere a te stesso il ruolo di amministratore.")
                self.c.execute("UPDATE utenti SET ruolo=? WHERE id=?", (body["ruolo"], uid))
                self.evento(me["id"], None, "Ruolo di %s impostato a %s" % (u["username"], body["ruolo"]))
            if "attivo" in body:
                att = bool(body["attivo"])
                if uid == me["id"] and not att:
                    raise Errore(400, "Non puoi disattivare la tua stessa utenza.")
                self.c.execute("UPDATE utenti SET attivo=? WHERE id=?", (1 if att else 0, uid))
                if not att:
                    self.c.execute("DELETE FROM sessioni WHERE utente_id=?", (uid,))
                self.evento(me["id"], None, "Utenza %s %s" % (u["username"], "riattivata" if att else "disattivata"))
            if body.get("reimposta_password"):
                nuova = secrets.token_urlsafe(9)
                self.imposta_password(uid, nuova, True, me["id"], "Password di %s reimpostata" % u["username"])
            self._bump()
            return nuova

    # ---- pratiche ----
    def elenco(self):
        rows = self.c.execute("SELECT id, dati FROM pratiche").fetchall()
        out = []
        for r in rows:
            d = json.loads(r["dati"])
            d["id"] = r["id"]
            out.append(d)
        return out

    def leggi(self, pid):
        r = self.c.execute("SELECT dati FROM pratiche WHERE id=?", (pid,)).fetchone()
        if not r:
            raise Errore(404, "La pratica non esiste più: forse è stata eliminata da un collega.")
        return json.loads(r["dati"])

    def dettaglio(self, pid):
        d = self.leggi(pid)
        d["id"] = pid
        d["log"] = [dict(ts=r["ts"], utente_id=r["utente_id"], msg=r["msg"]) for r in self.c.execute(
            "SELECT ts, utente_id, msg FROM eventi WHERE pratica_id=? ORDER BY ts DESC, id DESC LIMIT 300", (pid,))]
        return d

    def _scrivi(self, pid, d, nuova=False):
        now = time.time()
        d["aggiornata"] = now * 1000
        if nuova:
            self.c.execute("INSERT INTO pratiche(id, dati, creata, aggiornata) VALUES(?,?,?,?)",
                           (pid, json.dumps(d, ensure_ascii=False), now, now))
        else:
            self.c.execute("UPDATE pratiche SET dati=?, aggiornata=? WHERE id=?",
                           (json.dumps(d, ensure_ascii=False), now, pid))
        self._bump()

    def crea(self, me, body):
        tipo = body.get("tipo")
        if tipo not in TIPI:
            raise Errore(400, "Tipologia non valida.")
        d = {"tipo": tipo, "fase": 0, "check": {}, "dafare": {}, "sospesa": False, "motivoSospensione": "",
             "assegnatario": me["id"], "creatoDa": me["id"], "creata": time.time() * 1000,
             "esempio": bool(body.get("esempio"))}
        d.update(valida_campi(tipo, body.get("campi") or {}))
        if not (d.get("oggetto") or "").strip():
            raise Errore(400, "Indica l'oggetto della spesa.")
        if d["esempio"]:
            ts = time.time() * 1000
            for i in (body.get("check_iniziali") or [])[:30]:
                if i in VOCI[tipo]:
                    d["check"][i] = {"ok": True, "by": me["id"], "at": ts}
            f = body.get("fase_iniziale")
            if isinstance(f, int) and 0 <= f < CONCLUSA:
                d["fase"] = f
        pid = "p" + secrets.token_hex(6)
        with self.lock:
            self._scrivi(pid, d, nuova=True)
            self.evento(me["id"], pid, "Pratica creata")
        return pid

    def modifica(self, me, pid, body):
        with self.lock:
            d = self.leggi(pid)
            tipo = d["tipo"]
            msgs = []
            campi = body.get("campi")
            if campi:
                nuovi = valida_campi(tipo, campi)
                cambiati = [k for k, v in nuovi.items() if d.get(k, None if CAMPI[k]["t"] == "num" else ("" if CAMPI[k]["t"] != "check" else False)) != v]
                if "oggetto" in nuovi and not nuovi["oggetto"].strip():
                    raise Errore(400, "L'oggetto non può essere vuoto.")
                for k in cambiati:
                    d[k] = nuovi[k]
                if cambiati:
                    msgs.append("Dati aggiornati: " + ", ".join(CAMPI[k]["l"] for k in cambiati))
            for iid, on in (body.get("check") or {}).items():
                voce = VOCI[tipo].get(iid)
                if not voce:
                    raise Errore(400, "Adempimento sconosciuto.")
                was = bool(d["check"].get(iid))
                if bool(on) and not was:
                    d["check"][iid] = {"ok": True, "by": me["id"], "at": time.time() * 1000}
                    d.setdefault("dafare", {}).pop(iid, None)
                    msgs.append("Completato: " + voce["t"])
                elif not on and was:
                    d["check"].pop(iid, None)
                    msgs.append("Riaperto: " + voce["t"])
            for iid, on in (body.get("dafare") or {}).items():
                voce = VOCI[tipo].get(iid)
                if not voce:
                    raise Errore(400, "Adempimento sconosciuto.")
                dafare = d.setdefault("dafare", {})
                if bool(on) and iid not in dafare and not d["check"].get(iid):
                    dafare[iid] = {"by": me["id"], "at": time.time() * 1000}
                    msgs.append("Da fare: " + voce["t"])
                elif not on and iid in dafare:
                    dafare.pop(iid, None)
                    msgs.append("Tolto dalle cose da fare: " + voce["t"])
            az = body.get("azione")
            if az:
                msgs.append(self._azione(me, d, az))
            if not msgs:
                return self.dettaglio(pid), False
            self._scrivi(pid, d)
            for m in msgs:
                self.evento(me["id"], pid, m)
            return self.dettaglio(pid), True

    def _azione(self, me, d, az):
        tipo = az.get("tipo")
        fase = d.get("fase", 0)
        if "fase_attesa" in az and az["fase_attesa"] != fase:
            raise Errore(409, "Un collega ha appena cambiato la fase di questa pratica. La scheda è stata aggiornata: verifica e riprova.")
        if tipo == "avanza":
            if fase >= CONCLUSA:
                raise Errore(400, "La pratica è già conclusa.")
            manc = [i for i in TIPI[d["tipo"]]["check"][fase] if i.get("r") and not d["check"].get(i["id"])]
            if manc and not az.get("forza"):
                raise Errore(400, "Mancano adempimenti obbligatori.")
            d["fase"] = fase + 1
            if d["fase"] >= CONCLUSA:
                d["sospesa"] = False
            m = "Pratica conclusa" if d["fase"] >= CONCLUSA else "Passata alla fase " + FASI[d["fase"]]["n"]
            if manc:
                m += " con %d adempimenti obbligatori non spuntati" % len(manc)
            return m
        if tipo == "salta_fase":
            if fase >= CONCLUSA:
                raise Errore(400, "La pratica è già conclusa.")
            ts = time.time() * 1000
            n = 0
            for voce in TIPI[d["tipo"]]["check"][fase]:
                if not d["check"].get(voce["id"]):
                    d["check"][voce["id"]] = {"ok": True, "by": me["id"], "at": ts, "gia": True}
                    n += 1
                d.setdefault("dafare", {}).pop(voce["id"], None)
            nome = FASI[fase]["n"]
            d["fase"] = fase + 1
            if d["fase"] >= CONCLUSA:
                d["sospesa"] = False
            dopo = "pratica conclusa" if d["fase"] >= CONCLUSA else "passata alla fase " + FASI[d["fase"]]["n"]
            return "Fase %s registrata come già svolta (%d sottofasi segnate come già svolte); %s" % (nome, n, dopo)
        if tipo == "indietro":
            if fase <= 0 or fase >= CONCLUSA:
                raise Errore(400, "Operazione non consentita in questa fase.")
            d["fase"] = fase - 1
            return "Riportata alla fase " + FASI[d["fase"]]["n"]
        if tipo == "riapri":
            if fase < CONCLUSA:
                raise Errore(400, "La pratica non è conclusa.")
            d["fase"] = CONCLUSA - 1
            return "Pratica riaperta in fase " + FASI[-1]["n"]
        if tipo == "sospendi":
            mot = str(az.get("motivo") or "").strip()[:300]
            d["sospesa"] = True
            d["motivoSospensione"] = mot
            return "Pratica sospesa" + (": " + mot if mot else "")
        if tipo == "riprendi":
            d["sospesa"] = False
            d["motivoSospensione"] = ""
            return "Pratica ripresa"
        if tipo == "assegna":
            uid = az.get("utente")
            if uid is None:
                d["assegnatario"] = None
                return "Assegnatario rimosso"
            u = self.c.execute("SELECT nome FROM utenti WHERE id=? AND attivo=1 AND ruolo!='lettura'", (uid,)).fetchone()
            if not u:
                raise Errore(400, "Si può assegnare la pratica solo a un collega attivo con ruolo di operatore o amministratore.")
            d["assegnatario"] = uid
            return "Presa in carico" if uid == me["id"] else "Assegnata a " + u["nome"]
        raise Errore(400, "Operazione sconosciuta.")

    def elimina(self, me, pid):
        with self.lock:
            d = self.leggi(pid)
            self.c.execute("DELETE FROM pratiche WHERE id=?", (pid,))
            self.evento(me["id"], pid, "Pratica eliminata: " + (d.get("oggetto") or "")[:200])
            self._bump()

    def registro(self, limite=500):
        return [dict(r) for r in self.c.execute(
            "SELECT e.ts, e.utente_id, e.pratica_id, e.msg FROM eventi e ORDER BY e.ts DESC, e.id DESC LIMIT ?", (limite,))]

    def backup(self, dest):
        dst = sqlite3.connect(dest)
        with self.lock:
            self.c.backup(dst)
        dst.close()


def valida_campi(tipo, campi):
    if not isinstance(campi, dict):
        raise Errore(400, "Dati non validi.")
    out = {}
    for k, v in campi.items():
        c = CAMPI.get(k)
        if not c or (c.get("tipi") and tipo not in c["tipi"]):
            raise Errore(400, "Campo non previsto: %s" % k)
        t = c["t"]
        if t == "num":
            if v is None or v == "":
                v = None
            elif isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > 1e12:
                raise Errore(400, "Importo non valido nel campo «%s»." % c["l"])
            else:
                v = round(float(v), 2)
        elif t == "check":
            v = bool(v)
        elif t == "date":
            v = "" if v is None else str(v)
            if v:
                if not DATA_RE.match(v):
                    raise Errore(400, "Data non valida nel campo «%s»." % c["l"])
                try:
                    datetime.date.fromisoformat(v)
                except ValueError:
                    raise Errore(400, "Data non valida nel campo «%s»." % c["l"])
        else:
            v = "" if v is None else str(v).strip()
            if len(v) > LUNGH_MAX.get(k, 500):
                raise Errore(400, "Testo troppo lungo nel campo «%s»." % c["l"])
        out[k] = v
    return out


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
class Gestore(http.server.BaseHTTPRequestHandler):
    server_version = "CicloSpesa"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    archivio = None
    cookie_secure = False
    modo = "server"          # "server", "inserimento" oppure "consultazione"
    porta = 0
    token_avvio = None       # codice del collegamento aperto all'avvio (modalita' locali)
    sessioni_locali = set()
    utente = None            # utente della postazione (modalita' locali)
    pubblicatore = None
    lettore = None

    def log_message(self, fmt, *args):
        sys.stderr.write("%s [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    # ---- risposte ----
    def _intestazioni(self, stato, tipo, lunghezza, extra=None):
        self.send_response(stato)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(lunghezza))
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()

    def _json(self, stato, obj, extra=None):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._intestazioni(stato, "application/json; charset=utf-8", len(b), extra)
        self.wfile.write(b)

    def _cookie(self, nome):
        for parte in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = parte.strip().partition("=")
            if k == nome:
                return v
        return None

    def _nome_cookie(self):
        return "cs_sess" if self.modo == "server" else "cs_loc_%d" % self.porta

    def _set_cookie(self, valore, max_age):
        c = "%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d" % (self._nome_cookie(), valore, max_age)
        if self.cookie_secure:
            c += "; Secure"
        return ("Set-Cookie", c)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise Errore(413, "Richiesta troppo grande.")
        raw = self.rfile.read(n) if n else b""
        if not raw:
            return {}
        try:
            b = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise Errore(400, "Richiesta non valida.")
        if not isinstance(b, dict):
            raise Errore(400, "Richiesta non valida.")
        return b

    # ---- metodi ----
    def do_GET(self):
        self._gestisci("GET")

    def do_POST(self):
        self._gestisci("POST")

    def do_PATCH(self):
        self._gestisci("PATCH")

    def do_DELETE(self):
        self._gestisci("DELETE")

    def _sessione_locale(self):
        t = self._cookie(self._nome_cookie())
        return bool(t) and any(hmac.compare_digest(t, x) for x in self.sessioni_locali)

    def _pagina(self, stato, titolo, testo, extra=None):
        b = ("<!doctype html><html lang=\"it\"><head><meta charset=\"utf-8\"><title>Ciclo della spesa</title>"
             "<link rel=\"stylesheet\" href=\"/vendor/bootstrap-italia/css/bootstrap-italia.min.css\"></head>"
             "<body><main class=\"container py-5\"><h1 class=\"h3\">%s</h1><p>%s</p></main></body></html>" % (titolo, testo)).encode("utf-8")
        self._intestazioni(stato, "text/html; charset=utf-8", len(b), extra)
        self.wfile.write(b)

    def _gestisci(self, metodo):
        parti = urllib.parse.urlsplit(self.path)
        path = parti.path
        try:
            if self.modo != "server":
                # Solo questo computer: rifiuta richieste arrivate con un nome diverso (difesa dal DNS rebinding).
                if self.headers.get("Host") not in ("127.0.0.1:%d" % self.porta, "localhost:%d" % self.porta):
                    raise Errore(403, "Richiesta non consentita.")
                if path == "/accesso" and metodo == "GET":
                    t = urllib.parse.parse_qs(parti.query).get("t", [""])[0]
                    if not (self.token_avvio and hmac.compare_digest(t, self.token_avvio)):
                        return self._pagina(403, "Collegamento non valido",
                                            "Apri l'applicazione dal collegamento mostrato nella finestra del programma, oppure chiudi il programma e avvialo di nuovo.")
                    s = secrets.token_urlsafe(32)
                    self.sessioni_locali.add(s)
                    return self._pagina(200, "Ciclo della spesa", "<a href=\"/\">Apri l'applicazione</a>",
                                        [self._set_cookie(s, 12 * 3600), ("Refresh", "0; url=/")])
                if path in ("/", "/index.html") and not self._sessione_locale():
                    return self._pagina(403, "Apri l'applicazione dal programma",
                                        "Per motivi di sicurezza l'applicazione si apre solo dal collegamento mostrato nella finestra del programma "
                                        "(o automaticamente all'avvio). Se hai chiuso il browser, usa quel collegamento oppure chiudi e riavvia il programma.")
            if path.startswith("/api/"):
                self._api(metodo, path)
            elif metodo == "GET":
                self._statico(path)
            else:
                raise Errore(405, "Metodo non consentito.")
        except Errore as e:
            self._json(e.stato, {"errore": e.msg})
        except Exception:  # pragma: no cover
            import traceback
            traceback.print_exc()
            self._json(500, {"errore": "Errore interno del server. Il dettaglio è nel registro del server."})

    def _statico(self, path):
        if path == "/":
            path = "/index.html"
        f = STATIC_FILES.get(path)
        if not f:
            raise Errore(404, "Pagina non trovata.")
        with open(f, "rb") as fh:
            b = fh.read()
        self._intestazioni(200, MIME.get(os.path.splitext(f)[1], "application/octet-stream"), len(b))
        self.wfile.write(b)

    def _api(self, metodo, path):
        A = self.archivio
        token = self._cookie("cs_sess")
        if metodo != "GET":
            # Protezione da richieste provenienti da altri siti.
            if self.headers.get("X-CS") != "1":
                raise Errore(403, "Richiesta non consentita.")
            origin = self.headers.get("Origin")
            if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get("Host"):
                raise Errore(403, "Richiesta non consentita.")
        body = self._body() if metodo in ("POST", "PATCH") else {}

        if self.modo != "server":
            return self._api_locale(metodo, path, body)

        if path == "/api/login" and metodo == "POST":
            u = A.verifica(str(body.get("username") or ""), str(body.get("password") or ""))
            if not u:
                raise Errore(401, "Nome utente o password non corretti.")
            tok = A.nuova_sessione(u["id"])
            return self._json(200, {"ok": True}, [self._set_cookie(tok, SESSIONE_SECONDI)])
        if path == "/api/logout" and metodo == "POST":
            A.chiudi_sessione(token)
            return self._json(200, {"ok": True}, [self._set_cookie("", 0)])

        me = A.utente_da_token(token)
        if not me:
            raise Errore(401, "Sessione scaduta: accedi di nuovo.")
        admin = me["ruolo"] == "admin"
        scrittura = me["ruolo"] in ("admin", "operatore")

        if path == "/api/password" and metodo == "POST":
            if not A.verifica(me["username"], str(body.get("attuale") or "")):
                raise Errore(400, "La password attuale non è corretta.")
            if body.get("nuova") == body.get("attuale"):
                raise Errore(400, "La nuova password deve essere diversa da quella attuale.")
            A.imposta_password(me["id"], body.get("nuova"), False, me["id"], "%s ha cambiato la propria password" % me["username"])
            tok = A.nuova_sessione(me["id"])
            return self._json(200, {"ok": True}, [self._set_cookie(tok, SESSIONE_SECONDI)])

        if path == "/api/me" and metodo == "GET":
            return self._json(200, {"id": me["id"], "username": me["username"], "nome": me["nome"],
                                    "ruolo": me["ruolo"], "cambio_password": bool(me["cambio_password"]), "modo": "server"})
        if me["cambio_password"]:
            raise Errore(403, "Prima di continuare devi impostare una nuova password.")
        if path == "/api/rev" and metodo == "GET":
            return self._json(200, {"rev": A.rev()})
        return self._api_dati(A, me, metodo, path, body)

    def _api_locale(self, metodo, path, body):
        if not self._sessione_locale():
            raise Errore(401, "Apri l'applicazione dal collegamento mostrato nella finestra del programma.")
        if self.lettore:
            self.lettore.aggiorna()
        A = self.archivio
        if A is None:
            raise Errore(503, "Nessuna copia disponibile: " + (self.lettore.errore or "cartella condivisa non raggiungibile."))
        me = self.utente
        stato = self.pubblicatore.stato() if self.pubblicatore else self.lettore.stato()
        if path == "/api/me" and metodo == "GET":
            return self._json(200, {"id": me["id"], "username": me["username"], "nome": me["nome"], "ruolo": me["ruolo"],
                                    "cambio_password": False, "modo": self.modo, "stato": stato})
        if path == "/api/rev" and metodo == "GET":
            return self._json(200, {"rev": A.rev(), "stato": stato})
        if path.startswith(("/api/login", "/api/logout", "/api/password")) or (path.startswith("/api/utenti") and metodo != "GET"):
            raise Errore(403, "Operazione non prevista sulla postazione.")
        return self._api_dati(A, me, metodo, path, body)

    def _api_dati(self, A, me, metodo, path, body):
        admin = me["ruolo"] == "admin"
        scrittura = me["ruolo"] in ("admin", "operatore")
        if path == "/api/utenti" and metodo == "GET":
            return self._json(200, A.utenti(admin))
        if path == "/api/pratiche" and metodo == "GET":
            with A.lock:
                return self._json(200, {"rev": A.rev(), "pratiche": A.elenco()})

        m = re.match(r"^/api/pratiche/(p[0-9a-f]{12})$", path)
        if m and metodo == "GET":
            return self._json(200, A.dettaglio(m.group(1)))

        if path == "/api/pratiche" and metodo == "POST":
            if not scrittura:
                raise Errore(403, "Il tuo profilo è di sola consultazione.")
            return self._json(201, {"id": A.crea(me, body)})
        if m and metodo == "PATCH":
            if not scrittura:
                raise Errore(403, "Il tuo profilo è di sola consultazione.")
            d, _ = A.modifica(me, m.group(1), body)
            return self._json(200, d)
        if m and metodo == "DELETE":
            if not admin:
                raise Errore(403, "Solo un amministratore può eliminare una pratica.")
            A.elimina(me, m.group(1))
            return self._json(200, {"ok": True})

        if not admin:
            raise Errore(403 if path.startswith(("/api/utenti", "/api/registro")) else 404, "Operazione non disponibile.")
        if path == "/api/utenti" and metodo == "POST":
            pw = secrets.token_urlsafe(9)
            uid = A.crea_utente(str(body.get("username") or "").strip(), body.get("nome"), body.get("ruolo"), pw, True, me["id"])
            return self._json(201, {"id": uid, "password_provvisoria": pw})
        mu = re.match(r"^/api/utenti/(\d+)$", path)
        if mu and metodo == "PATCH":
            nuova = A.modifica_utente(me, int(mu.group(1)), body)
            return self._json(200, {"ok": True, "password_provvisoria": nuova})
        if path == "/api/registro" and metodo == "GET":
            return self._json(200, A.registro())
        raise Errore(404, "Operazione non disponibile.")


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


class Pubblicatore(threading.Thread):
    """Aggiorna la copia per la consultazione poco dopo ogni modifica."""

    def __init__(self, archivio, cartella, autore):
        super().__init__(daemon=True)
        self.A, self.cartella, self.autore = archivio, cartella, autore
        self.ev = threading.Event()
        self.ultima = None
        self.errore = None
        archivio.al_cambio = self.ev.set

    def esegui(self):
        try:
            if not os.path.isdir(self.cartella):
                raise OSError("cartella non raggiungibile: %s" % self.cartella)
            self.A.pubblica(self.cartella, self.autore)
            self.ultima, self.errore = time.time(), None
        except Exception as e:
            self.errore = str(e)
            threading.Timer(30, self.ev.set).start()  # nuovo tentativo tra 30 secondi

    def run(self):
        while True:
            self.ev.wait()
            time.sleep(2)  # raccoglie le modifiche ravvicinate in una sola copia
            self.ev.clear()
            self.esegui()

    def stato(self):
        return {"ultima": self.ultima, "errore": self.errore}


class Lettore:
    """Nella consultazione: copia in locale la versione pubblicata e la ricarica quando cambia."""

    def __init__(self, cartella, locale_dir):
        self.sorgente = os.path.join(cartella, NOME_COPIA)
        self.locale_dir = locale_dir
        self.firma = None
        self.turno = 0
        self.errore = None
        self.verificato = 0
        self.lock = threading.Lock()

    def aggiorna(self, forza=False):
        with self.lock:
            if not forza and time.time() - self.verificato < 5:
                return
            self.verificato = time.time()
            try:
                st = os.stat(self.sorgente)
                firma = (st.st_mtime, st.st_size)
                if firma == self.firma and Gestore.archivio is not None:
                    self.errore = None
                    return
                self.turno = 1 - self.turno  # due file alternati: su Windows non si sovrascrive un file aperto
                dest = os.path.join(self.locale_dir, "consultazione-%s.sqlite3" % "ab"[self.turno])
                for est in ("", "-wal", "-shm"):
                    if os.path.exists(dest + est):
                        os.remove(dest + est)
                shutil.copyfile(self.sorgente, dest)
                vecchio = Gestore.archivio
                Gestore.archivio = Archivio(dest)
                if vecchio is not None:
                    threading.Timer(10, vecchio.c.close).start()
                self.firma, self.errore = firma, None
            except FileNotFoundError:
                self.errore = "nella cartella condivisa non c'e' ancora una copia pubblicata (%s)" % self.sorgente
            except OSError as e:
                self.errore = "cartella condivisa non raggiungibile: %s" % e

    def stato(self):
        A = Gestore.archivio
        pub = A.meta("pubblicata") if A else None
        return {"pubblicata": float(pub) if pub else None, "autore": (A.meta("autore") if A else None), "errore": self.errore}


# --------------------------------------------------------------------------
# Riga di comando
# --------------------------------------------------------------------------
def chiedi_password():
    while True:
        p1 = getpass.getpass("Password (almeno 10 caratteri): ")
        if not password_valida(p1):
            print("Password troppo corta.")
            continue
        if p1 != getpass.getpass("Ripeti la password: "):
            print("Le due password non coincidono.")
            continue
        return p1


def main():
    ap = argparse.ArgumentParser(description="Ciclo della spesa - server per la rete interna")
    ap.add_argument("--db", default=None, help="file del database (predefinito: dati/ciclo_spesa.sqlite3; per l'inserimento, la cartella CicloSpesa nel profilo dell'utente)")
    sub = ap.add_subparsers(dest="cmd")
    a = sub.add_parser("avvia", help="avvia il server")
    a.add_argument("--host", default="127.0.0.1", help="indirizzo di ascolto; 0.0.0.0 per la rete interna (predefinito 127.0.0.1)")
    a.add_argument("--porta", type=int, default=8080)
    a.add_argument("--cert", help="certificato TLS (PEM) per servire in HTTPS")
    a.add_argument("--key", help="chiave privata TLS (PEM)")
    a.add_argument("--dietro-proxy-https", action="store_true",
                   help="segna il cookie come Secure quando l'HTTPS è gestito da un proxy interno")
    c = sub.add_parser("crea-admin", help="crea un utente amministratore")
    c.add_argument("username")
    r = sub.add_parser("reimposta-password", help="reimposta la password di un utente")
    r.add_argument("username")
    b = sub.add_parser("backup", help="copia coerente del database, anche a server avviato")
    b.add_argument("destinazione")
    i = sub.add_parser("inserimento", help="postazione di chi inserisce: solo su questo PC, con copia per la consultazione sulla condivisa")
    i.add_argument("--condivisa", required=True, help="cartella della condivisa riservata alla consultazione")
    i.add_argument("--porta", type=int, default=8765)
    i.add_argument("--non-aprire", action="store_true", help="non aprire automaticamente il browser")
    k = sub.add_parser("consultazione", help="postazione di chi consulta: sola lettura della copia sulla condivisa")
    k.add_argument("--condivisa", required=True, help="cartella della condivisa in cui si trova la copia")
    k.add_argument("--porta", type=int, default=8766)
    k.add_argument("--non-aprire", action="store_true", help="non aprire automaticamente il browser")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    if not args.cmd:
        ap.print_help()
        return 1
    if args.cmd in ("inserimento", "consultazione"):
        return postazione(args)

    A = Archivio(args.db or DB_DEFAULT)
    if args.cmd == "crea-admin":
        nome = input("Nome e cognome da mostrare: ").strip()
        A.crea_utente(args.username, nome, "admin", chiedi_password(), cambio=False)
        print("Amministratore %s creato." % args.username)
        return 0
    if args.cmd == "reimposta-password":
        u = A.c.execute("SELECT id FROM utenti WHERE username=?", (args.username,)).fetchone()
        if not u:
            print("Utente inesistente.")
            return 1
        A.imposta_password(u["id"], chiedi_password(), False, None, "Password di %s reimpostata da riga di comando" % args.username)
        A.c.execute("UPDATE utenti SET attivo=1 WHERE id=?", (u["id"],))
        print("Password aggiornata.")
        return 0
    if args.cmd == "backup":
        A.backup(args.destinazione)
        print("Backup salvato in %s" % args.destinazione)
        return 0

    if not A.c.execute("SELECT 1 FROM utenti WHERE ruolo='admin' AND attivo=1").fetchone():
        print("Nessun amministratore presente. Creane uno con:\n  python ciclo_spesa.py crea-admin NOMEUTENTE")
        return 1
    Gestore.archivio = A
    Gestore.cookie_secure = bool(args.cert) or args.dietro_proxy_https
    srv = Server((args.host, args.porta), Gestore)
    schema = "http"
    if args.cert:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(args.cert, args.key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        schema = "https"
    print("Ciclo della spesa in ascolto su %s://%s:%d  (database: %s)" % (schema, args.host, args.porta, os.path.abspath(args.db or DB_DEFAULT)))
    if A.in_rete:
        print("ATTENZIONE: il database si trova su una cartella di rete. Chiunque abbia accesso a quella cartella\n"
              "puo' leggere il file direttamente, senza passare dalle utenze dell'applicazione, e SQLite su rete\n"
              "e' meno affidabile. Conviene indicare con --db una cartella sul disco locale del server.")
    if args.host == "127.0.0.1":
        print("Raggiungibile solo da questo computer. Per la rete interna avvia con --host 0.0.0.0")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nServer arrestato.")
    return 0


def postazione(args):
    """Modalita' inserimento e consultazione: l'app risponde solo a questo computer."""
    utente_win = getpass.getuser()
    privata = cartella_utente()
    os.makedirs(privata, exist_ok=True)
    if os.name == "posix":
        os.chmod(privata, 0o700)
    condivisa = os.path.abspath(args.condivisa) if not args.condivisa.startswith(("\\\\", "//")) else args.condivisa
    Gestore.modo, Gestore.porta = args.cmd, args.porta
    Gestore.token_avvio = secrets.token_urlsafe(24)

    if args.cmd == "inserimento":
        db = args.db or os.path.join(privata, "inserimento.sqlite3")
        if percorso_di_rete(db):
            print("Il database di lavoro deve stare su questo PC, non su una cartella di rete. Indica un percorso locale con --db.")
            return 1
        A = Archivio(db)
        Gestore.archivio = A
        Gestore.utente = A.utente_locale("win-" + re.sub(r"[^A-Za-z0-9._-]", "_", utente_win)[:36], utente_win)
        p = Pubblicatore(A, condivisa, utente_win)
        Gestore.pubblicatore = p
        p.start()
        p.esegui()  # copia iniziale
        print("Postazione di INSERIMENTO di %s" % utente_win)
        print("  Database di lavoro (solo su questo PC): %s" % os.path.abspath(db))
        print("  Copia per la consultazione: %s" % os.path.join(condivisa, NOME_COPIA))
        if p.errore:
            print("  ATTENZIONE: copia non scritta (%s). Riprovo in automatico." % p.errore)
    else:
        L = Lettore(condivisa, privata)
        Gestore.lettore = L
        L.aggiorna(forza=True)
        Gestore.utente = {"id": 0, "username": "consultazione", "nome": utente_win, "ruolo": "lettura", "cambio_password": 0}
        print("Postazione di CONSULTAZIONE di %s (sola lettura)" % utente_win)
        print("  Copia letta da: %s" % L.sorgente)
        if L.errore:
            print("  ATTENZIONE: %s" % L.errore)

    try:
        srv = Server(("127.0.0.1", args.porta), Gestore)
    except OSError:
        print("La porta %d e' gia' in uso: forse il programma e' gia' aperto. Chiudi l'altra finestra e riprova." % args.porta)
        return 1
    url = "http://127.0.0.1:%d/accesso?t=%s" % (args.porta, Gestore.token_avvio)
    print("  L'applicazione risponde solo a questo computer. Per aprirla:")
    print("  " + url)
    print("  Per chiudere: Ctrl+C in questa finestra" + (" (le modifiche sono gia' salvate)." if args.cmd == "inserimento" else "."))
    if not args.non_aprire:
        threading.Timer(0.8, webbrowser.open, (url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        if Gestore.pubblicatore:
            Gestore.pubblicatore.esegui()  # ultima copia aggiornata prima di chiudere
        print("\nProgramma chiuso.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
