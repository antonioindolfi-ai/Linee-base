# Scadenzario offline

Strumento in **un solo file** (`scadenzario.html`) che estrae le scadenze dalle email e le organizza in un calendario.
Si apre con un doppio clic in Edge, Chrome o Firefox. Non va installato e non servono permessi di amministratore.

C'è anche una **versione automatica** per la posta su Microsoft 365: crea da sola gli eventi nel calendario Outlook,
con le stesse regole. Le istruzioni sono in [power-automate/GUIDA.md](power-automate/GUIDA.md).

## Riservatezza: nessun dato esce mentre lo strumento è in uso

### Cosa garantisce la pagina

- **Nessuna connessione.** La *Content-Security-Policy* della pagina vieta al browser di contattare qualsiasi indirizzo.
  Vale per richieste dirette, immagini (anche quelle contenute nelle email), fogli di stile, caratteri, frame, video
  e invio di moduli.
- **Solo il proprio codice.** Lo script è autorizzato tramite la sua impronta SHA-256, quindi non viene eseguito codice
  estraneo, per esempio contenuto in una email o in un file di backup manipolato. Il contenuto delle email è mostrato
  sempre come testo, mai come HTML.
- **Nessuna funzione di rete nel codice.** Non ci sono `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`,
  `EventSource`, `RTCPeerConnection` né `window.open`; lo si verifica con una ricerca nel file.
- **Servizi online del browser disattivati nei campi della pagina:** correttore ortografico, traduzione automatica,
  completamento automatico e correttori come Grammarly.
- **Avviso in pagina.** Se qualcosa tentasse comunque una connessione, il browser la blocca e la pagina mostra il dettaglio.

**Verifica fatta.** Un server di prova ha registrato ogni contatto ricevuto. Una pagina di controllo senza protezione
gli ha inviato dati in 12 modi diversi (immagini, fetch, XHR, beacon, WebSocket, moduli, frame, stili, video e altri).
Con gli stessi tentativi eseguiti dentro lo Scadenzario, il server non ha ricevuto nulla.

### Cosa non dipende dalla pagina

- **Estensioni del browser** (correttori, traduttori, assistenti): possono leggere qualsiasi pagina e queste regole non le
  limitano. Conviene usare un profilo del browser senza estensioni o farle verificare all'IT.
- **Assistenti integrati nel browser**, come Copilot nella barra laterale di Edge: se li si apre su questa pagina possono
  leggerne il contenuto, quindi non vanno usati qui. Nelle impostazioni di Edge (sezione Lingue) è preferibile il
  correttore di base a Microsoft Editor.
- **Cartelle sincronizzate:** se Desktop o Documenti sono sincronizzati con OneDrive, le email salvate lì e i backup
  vengono copiati nel cloud. Meglio una cartella locale non sincronizzata.
- **Archivio del browser condiviso tra file locali:** in Edge e Chrome tutte le pagine HTML aperte dal disco condividono
  lo stesso archivio. Un altro file HTML aperto dal disco nello stesso browser, per esempio un allegato HTML di una
  email, potrebbe leggere i dati dello Scadenzario. Non aprire nello stesso browser file HTML di provenienza incerta.

### Come verificarlo (anche da parte dell'IT)

1. Aprire la pagina, premere **F12**, scegliere la scheda **Rete** (Network), ricaricare e usare lo strumento. Non devono
   comparire richieste verso indirizzi `http://` o `https://`; un tentativo bloccato comparirebbe come «(blocked:csp)».
2. Aprire il sorgente con **Ctrl+U**: la riga `Content-Security-Policy` è all'inizio del file.
3. Cercare nel file le parole elencate sopra: non devono esserci risultati.

*Nota tecnica:* la Content-Security-Policy non regola la navigazione verso un'altra pagina, per esempio il clic su un
link. La pagina non contiene link esterni e l'impronta impedisce a codice estraneo di crearne o di aprirne, quindi
anche questa via è chiusa.

## Uso

1. **Importa email.** Trascina i file nella pagina:
   - da **Outlook**: prova a trascinare il messaggio direttamente sulla pagina. Se il browser non lo accetta, salvalo con
     *File → Salva con nome* in una cartella locale non sincronizzata e trascina il file `.msg`;
   - **PEC**: va bene il file `.eml` completo. Lo strumento apre automaticamente il messaggio originale (`postacert.eml`)
     e ignora la ricevuta del gestore;
   - in alternativa puoi **incollare il testo** indicando la data della email.
2. **Verifica.** Per ogni data trovata vedi la frase di origine, la categoria proposta e un livello di affidabilità.
   Le date ad affidabilità *alta* sono già selezionate. Puoi correggere tutto prima di aggiungere.
3. **Calendario ed Elenco.** Hai la vista mensile con le festività, le prossime scadenze, la ricerca e il segno di completamento.
4. **Outlook.** *Backup e impostazioni → Esporta in .ics*, poi in Outlook *File → Apri ed esporta → Importa/Esporta →
   Importa un file iCalendar (.ics)*. I promemoria (di default 3 e 1 giorno prima) sono inclusi nel file.

## Cosa riconosce

- Date in forma numerica (`15/12/2026`, `15.12.26`), testuale (`martedì 15 dicembre 2026`, `15 dic. 2026`) e senza anno.
- Termini relativi: `entro 30 (trenta) giorni`, `entro 5 giorni lavorativi`, `entro fine mese`, `entro domani`,
  `per lunedì prossimo`. Sono calcolati dalla data della email e segnalati come da verificare.
- Espressioni come «per il 5 dicembre» e «il 10 dicembre scade il termine».
- Orari (`alle ore 10:30`, `h. 15.00`).
- Categorie: udienza, sindacato ispettivo, contenzioso, liquidazioni, adempimenti (performance, anticorruzione,
  trasparenza, privacy), riunioni.
- Scarta o declassa le date che sono solo riferimenti (`nota prot. n. … del …`, `legge 30 dicembre 2010, n. 240`), le date
  già passate, le intestazioni dei messaggi citati (`Inviato:`, `Il giorno … ha scritto:`) e la formula di rito
  «è ammesso ricorso entro 60 giorni».
- Segnala le scadenze che cadono di sabato, di domenica o in un giorno festivo (compresi Pasquetta, il 4 ottobre dal 2026
  e il santo patrono configurabile, di default Roma 29/06). Le può spostare al primo giorno lavorativo.
- Per contenzioso e udienze segnala quando un termine relativo attraversa la sospensione feriale (1–31 agosto).

## Limiti da conoscere

- L'estrazione si basa su regole linguistiche, non su intelligenza artificiale: **ogni scadenza va verificata** sulla fonte.
- I termini relativi decorrono dalla data della email. Se decorrono da una notifica diversa, correggi la data a mano.
- I `.msg` salvati solo in formato RTF (raro) non sono leggibili: in quel caso incolla il testo.
- I dati sono legati a quel browser su quel computer. Se si cancellano i dati di navigazione vanno persi: usa
  **Esporta backup** con regolarità (ad esempio su una cartella di rete interna) e **Importa backup** per ripristinarli
  o spostarli su un altro PC.

## Manutenzione

Se si modifica lo script della pagina, l'impronta nella riga `Content-Security-Policy` va ricalcolata: è il valore SHA-256,
in base64, del testo compreso tra `<script>` e `</script>`. Se non coincide, il browser blocca lo script e la pagina
non funziona. È il comportamento voluto: un codice diverso da quello autorizzato non viene eseguito.
