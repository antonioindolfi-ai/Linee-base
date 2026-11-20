/* Generato da build.py: non modificare a mano. */
const CACHE = 'fantacalendari-43132de635de';
const PRECACHE = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-48.png", "vendor/xlsx.full.min.js", "vendor/jspdf.umd.min.js"];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fantacalendari-') && k !== CACHE && k !== 'fantacalendari-condivisi').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // File ricevuto da "Condividi" di Android: lo mette da parte e apre l'app per importarlo
  if (req.method === 'POST' && url.pathname.endsWith('/condividi')) {
    e.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.getAll('file').find((f) => f && typeof f !== 'string');
        if (file) {
          const cache = await caches.open('fantacalendari-condivisi');
          await cache.put('file-condiviso', new Response(file, {
            headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Nome-File': encodeURIComponent(file.name || 'condiviso.xlsx') },
          }));
        }
      } catch (err) {}
      return Response.redirect('./?condiviso', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

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
