# Fantacalendari

Rigioca un fantacampionato a scontri diretti con tutti i calendari possibili: punti medi, minimo e massimo, probabilità di ogni posizione e confronto con la classifica reale. Importa il calendario `.xlsx` esportato da Leghe Fantacalcio ed esporta i risultati in Excel e PDF.

## Struttura

| Percorso | Contenuto |
|---|---|
| `src/fantacalendari.html` | Sorgente della pagina (la stessa pubblicata come Artifact su claude.ai). Si modifica solo questo file. |
| `build.py` | Genera `index.html` e `sw.js` dalla sorgente. |
| `index.html` | Web app installabile, generata: non modificarla a mano. |
| `sw.js` | Service worker per l'uso offline, generato. |
| `manifest.webmanifest` | Nome, colori e icone dell'app. |
| `icons/` | Icone dell'app. |
| `vendor/` | SheetJS 0.18.5 (Apache-2.0) e jsPDF 2.5.1 (MIT), per lavorare offline. |

Dopo ogni modifica alla sorgente:

```sh
python3 fantacalcio/build.py
```

## Pubblicazione e installazione

1. Attiva GitHub Pages: *Settings → Pages → Deploy from a branch*, scegli il branch e la cartella `/ (root)`.
2. Apri `https://<utente>.github.io/<repository>/fantacalcio/` con Chrome su Android.
3. Tocca **Installa app** nella pagina, oppure il menu ⋮ → *Installa app* / *Aggiungi a schermata Home*.

Dopo l'installazione l'app compare tra le opzioni di **Condividi** di Android per i file Excel e CSV: condividi il calendario esportato da Leghe Fantacalcio e il calcolo parte da solo (funzione Web Share Target di Chrome; serve l'app installata).

Dopo la prima apertura l'app funziona anche senza connessione. Gli aggiornamenti arrivano da soli alla prima apertura con la rete.
