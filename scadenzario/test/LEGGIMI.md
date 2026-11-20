# Verifiche automatiche

| Comando | Cosa verifica |
|---|---|
| `node verifica-pagina.js` | `scadenzario.html`: estrazione dalle email di prova, file .ics, protezioni (impronta dello script, codice estraneo, backup manipolati) e prova con un server «spia» che nessun dato esca dalla pagina, con una pagina di controllo che dimostra che il test rileva le fughe. |
| `TSC=<tsc 4.0.3> node verifica-script-excel.js` | `power-automate/estrai-scadenze.ts`: compilazione con TypeScript 4.0.3 (la versione degli Office Scripts), vincoli degli Office Scripts, funzionamento su un registro Excel simulato (duplicati, fuso orario, celle sicure) e **risultati identici** a quelli di `scadenzario.html` su un insieme di testi. |
| `node impronta.js ../scadenzario.html` | Dopo ogni modifica allo script della pagina: ricalcola l'impronta SHA-256 nella Content-Security-Policy. |

Requisiti: Node.js, Playwright con Chromium e TypeScript 4.0.3 (`npm install typescript@4.0.3`).

Il motore di estrazione esiste in due copie, una nella pagina e una nello script di Excel: ogni modifica alle regole va
fatta in entrambe, e `verifica-script-excel.js` controlla che diano gli stessi risultati.

Le email in `email/` sono fittizie.
