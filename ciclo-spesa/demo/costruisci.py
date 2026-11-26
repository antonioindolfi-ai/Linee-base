#!/usr/bin/env python3
"""Costruisce l'interfaccia di prova a partire dalla pagina del server.

  python costruisci.py                 -> demo/index.html (formato per la pagina su claude.ai)
  python costruisci.py --sito CARTELLA -> sito statico completo (es. per GitHub Pages)

L'interfaccia di prova usa gli stessi file dell'app (server/static) e in più
demo-api.js, che simula il server nel browser con dati fittizi.
"""
import os, re, shutil, sys

QUI = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(QUI, "..", "server", "static")

src = open(os.path.join(STATIC, "index.html"), encoding="utf-8").read()
head = src[src.index("<head>") + 6: src.index("</head>")]
body = src[src.index("<body>") + 6: src.index("</body>")]

head = re.sub(r"\s*<meta charset[^>]*>|\s*<meta name=\"viewport\"[^>]*>", "", head)
head = head.replace("<title>Ciclo della Spesa</title>",
                    "<title>Ciclo della Spesa · prova</title>\n<meta name=\"robots\" content=\"noindex\">")
head = head.replace('<link rel="stylesheet" href="app.css">',
                    '<link rel="stylesheet" href="app.css">\n<link rel="stylesheet" href="demo.css">')
head = head.replace('<script src="app.js" defer></script>',
                    '<script src="demo-api.js"></script>\n<script src="app.js" defer></script>')
a = "<p class=\"text-secondary mb-0\">Accedi con le credenziali assegnate dall'amministratore dell'applicazione.</p>"
assert a in body
body = body.replace(a, a + '\n    <div class="alert alert-info mb-0">Interfaccia di prova: le credenziali <code>demo</code> / <code>demo</code> sono già inserite.</div>')
body = body.rstrip() + '\n<div class="demo-ribbon">Interfaccia di prova con dati fittizi · le modifiche restano in memoria e si azzerano ricaricando la pagina</div>\n'

if "--sito" in sys.argv:
    dest = sys.argv[sys.argv.index("--sito") + 1]
    os.makedirs(dest, exist_ok=True)
    pagina = ('<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n'
              '<meta name="viewport" content="width=device-width,initial-scale=1">' + head + '</head>\n<body>' + body + '</body>\n</html>\n')
    open(os.path.join(dest, "index.html"), "w", encoding="utf-8").write(pagina)
    for f in ("app.css", "app.js", "modello.json"):
        shutil.copy(os.path.join(STATIC, f), dest)
    for f in ("demo-api.js", "demo.css", "config.json"):
        shutil.copy(os.path.join(QUI, f), dest)
    for d in ("fonts", "vendor"):
        if os.path.isdir(os.path.join(dest, d)):
            shutil.rmtree(os.path.join(dest, d))
        shutil.copytree(os.path.join(STATIC, d), os.path.join(dest, d))
    print("sito di prova in", dest)
else:
    open(os.path.join(QUI, "index.html"), "w", encoding="utf-8").write(head.strip() + "\n" + body)
    print("demo/index.html aggiornato")
