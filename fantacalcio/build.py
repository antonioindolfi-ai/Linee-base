#!/usr/bin/env python3
"""Genera la web app installabile (PWA) di Fantacalendari.

Sorgente:  src/fantacalendari.html  (la stessa pagina pubblicata come Artifact su claude.ai)
Prodotti:  index.html  documento completo con manifest, icone e registrazione del service worker,
                       librerie Excel/PDF caricate da vendor/ invece che dalla CDN
           sw.js       service worker per l'uso offline; la versione della cache cambia
                       a ogni modifica dei file, così il telefono scarica l'aggiornamento

Uso:  python3 fantacalcio/build.py
"""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src" / "fantacalendari.html"

CDN_TO_LOCAL = {
    "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js": "vendor/xlsx.full.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js": "vendor/jspdf.umd.min.js",
}

# File salvati sul telefono all'installazione (percorsi relativi alla cartella dell'app)
PRECACHE = [
    "./",
    "index.html",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/icon-maskable-512.png",
    "icons/apple-touch-icon.png",
    "icons/favicon-48.png",
    "vendor/xlsx.full.min.js",
    "vendor/jspdf.umd.min.js",
]

HEAD = """<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Rigioca il fantacampionato a scontri diretti con tutti i calendari possibili.">
<meta name="theme-color" content="#1d6b45" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1612" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Fantacalendari">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icons/favicon-48.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>
:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
img{max-width:100%}
[hidden]{display:none!important}
</style>
</head>
<body>
"""

TAIL = """
<script>
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
</script>
</body>
</html>
"""

SW_TEMPLATE = """/* Generato da build.py: non modificare a mano. */
const CACHE = 'fantacalendari-__VERSION__';
const PRECACHE = __PRECACHE__;
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fantacalendari-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pagina: prima la rete (per avere sempre l'ultima versione), senza rete la copia salvata
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); return res; })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Caratteri di Google Fonts: copia salvata subito, aggiornata in background
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(CACHE).then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }))
    );
    return;
  }

  // File dell'app (icone, librerie, manifest): dalla cache, altrimenti dalla rete
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
"""


def main():
    page = SRC.read_text(encoding="utf-8")
    for cdn, local in CDN_TO_LOCAL.items():
        if cdn not in page:
            raise SystemExit(f"URL della libreria non trovato nella sorgente: {cdn}")
        page = page.replace(cdn, local)
    if page.lstrip().lower().startswith("<!doctype"):
        raise SystemExit("La sorgente deve contenere solo il corpo della pagina, senza <!doctype>.")

    index = HEAD + page + TAIL
    (ROOT / "index.html").write_text(index, encoding="utf-8")

    digest = hashlib.sha256()
    for rel in PRECACHE:
        if rel == "./":
            continue
        data = index.encode("utf-8") if rel == "index.html" else (ROOT / rel).read_bytes()
        digest.update(rel.encode() + b"\0" + data)
    version = digest.hexdigest()[:12]

    sw = SW_TEMPLATE.replace("__VERSION__", version).replace("__PRECACHE__", json.dumps(PRECACHE))
    (ROOT / "sw.js").write_text(sw, encoding="utf-8")
    print(f"index.html e sw.js generati (versione cache {version})")


if __name__ == "__main__":
    main()
