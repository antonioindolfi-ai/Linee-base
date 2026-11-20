# Scadenzario automatico con Power Automate

Ogni email che arriva nella **Posta in arrivo** viene analizzata con le regole dello Scadenzario. Le scadenze trovate
diventano eventi nel tuo calendario Outlook:

- titolo «**[Da verificare]** Categoria: oggetto della email», oppure «**[Possibile scadenza]** …» per quelle meno sicure;
- mostrati come **provvisori**, con la frase di origine nella descrizione e un **promemoria 3 giorni prima**;
- solo nel tuo calendario: **non viene inviato nessun invito**.

Un registro nel file Excel elenca tutto ciò che è stato trovato, anche le date scartate con il motivo, ed evita i
duplicati quando la stessa scadenza ricompare in risposte e inoltri.

Ti serve circa un quarto d'ora, una volta sola.

## Dove passano i dati

Tutto avviene dentro il **Microsoft 365 del Ministero**, dove la tua posta si trova già: Outlook, Power Automate
ed Excel nel tuo OneDrive. Lo script non contiene chiamate verso servizi esterni e nessun dato va ad Anthropic o a terzi.
Il registro contiene le frasi delle email con le date: sta nel tuo OneDrive, con gli stessi permessi dei tuoi file.

---

## Passo 1 — Il file Excel e lo script

1. Apri **office.com**, poi **Excel**, e crea una **nuova cartella di lavoro vuota**. Chiamala **Scadenzario**
   (clic sul nome in alto). Viene salvata nel tuo OneDrive.
2. Scheda **Automatizza** → **Nuovo script**. A destra si apre l'editor del codice.
3. Cancella il testo di esempio e **incolla tutto il contenuto** del file `estrai-scadenze.txt`.
4. Clicca sul nome dello script in alto nell'editor e rinominalo in **Estrai scadenze**, poi **Salva script**.

Non serve eseguirlo da Excel: lo farà Power Automate.

## Passo 2 — Il flusso

Apri **make.powerautomate.com**.

1. **Crea** → **Flusso cloud automatizzato** (*Automated cloud flow*).
   Nome: **Scadenzario**. Come trigger cerca «email» e scegli
   **Quando arriva un nuovo messaggio di posta elettronica (V3)** di **Office 365 Outlook**
   (*When a new email arrives (V3)*) → **Crea**.
2. Clicca sul trigger:
   - **Cartella** (*Folder*): **Posta in arrivo** (*Inbox*); il resto lascialo com'è;
   - scheda **Impostazioni** (*Settings*): **Controllo della concorrenza** (*Concurrency Control*) **attivato**
     e **Grado di parallelismo** (*Degree of Parallelism*) **1**. Lo raccomanda Microsoft: se arrivano più email
     insieme, vengono analizzate una alla volta, senza conflitti nel file Excel.
3. **+** → **Aggiungi un'azione** → cerca «esegui script» e scegli **Esegui script** (*Run script*) di
   **Excel Online (Business)**, non quella «da una raccolta SharePoint».
   - **Posizione** (*Location*): OneDrive for Business
   - **Raccolta documenti** (*Document Library*): OneDrive
   - **File**: scegli **Scadenzario.xlsx** con l'icona della cartella (non scrivere il nome a mano)
   - **Script**: **Estrai scadenze**

   Compaiono i cinque campi dello script. Riempili con i *contenuti dinamici* dell'email (icona del fulmine, o «/»):

   | Campo dello script | Contenuto dinamico dell'email |
   |---|---|
   | oggetto | **Oggetto** (*Subject*) |
   | corpo | **Corpo** (*Body*), non «Anteprima del corpo» |
   | ricevuta | **Ora di ricezione** (*Received Time*) |
   | mittente | **Da** (*From*) |
   | idEmail | **ID messaggio** (*Message Id*) |

4. **+** → **Aggiungi un'azione** → cerca **Crea evento (V4)** (*Create event (V4)*) di **Office 365 Outlook**.
   Per i campi usa i contenuti dinamici dell'azione «Esegui script», che stanno sotto **result**. Power Automate
   inserirà da solo un ciclo **Applica a ciascuno** (*For each*): è normale, serve quando una email contiene più scadenze.

   | Campo | Valore |
   |---|---|
   | ID calendario (*Calendar id*) | **Calendario** |
   | Oggetto (*Subject*) | **titolo** |
   | Ora di inizio (*Start time*) | **inizio** |
   | Ora di fine (*End time*) | **fine** |
   | Fuso orario (*Time zone*) | **(UTC+01:00) Amsterdam, Berlino, Berna, Roma, Stoccolma, Vienna** |

   Poi apri i **parametri avanzati** (*Show all*) e imposta:

   | Campo | Valore |
   |---|---|
   | Corpo (*Body*) | **descrizione** |
   | Evento di un giorno intero (*Is all day event?*) | **tuttoIlGiorno** |
   | Promemoria (*Reminder*) | **promemoriaMinuti** |
   | Mostra come (*Show as*) | **Provvisorio** (*tentative*) |
   | Riservatezza (*Sensitivity*), se presente | **Privato** (*private*): chi vede il tuo calendario condiviso non legge i dettagli |

5. **Salva**.

## Passo 3 — Prova

Mandati un'email con questo testo: «Ti chiedo di inviare la relazione entro il 15 dicembre 2026.»
Entro qualche minuto devono comparire:

- nel calendario, il 15 dicembre, l'evento **[Da verificare] Scadenza: …**;
- in **Scadenzario.xlsx**, il foglio **Registro** con la riga corrispondente.

Prova anche a inoltrarti una email vera che contiene una scadenza.

Se non succede nulla: **I miei flussi** → **Scadenzario** → cronologia delle esecuzioni. Apri quella con l'errore e
mandami il messaggio d'errore, senza dati personali.

---

## Uso quotidiano

- Apri l'evento, controlla la frase sulla email originale, poi togli «[Da verificare]» dal titolo. Se la data è
  sbagliata, correggila; se non è una scadenza, elimina l'evento.
- Il foglio **Registro** elenca anche le date scartate (riferimenti a note e leggi, date passate, formule di rito) con
  il motivo: è utile per controllare che non sia sfuggito nulla.
- Per sospendere tutto: **I miei flussi** → **Scadenzario** → **Disattiva**.

## Impostazioni

Sono nelle prime righe dello script (Excel → Automatizza → Estrai scadenze). Dopo una modifica basta **Salva script**.

| Impostazione | Valore iniziale | Effetto |
|---|---|---|
| `CREA_ANCHE_MEDIA` | `true` | Crea eventi anche per le date ad affidabilità media («[Possibile scadenza]»). Con `false` restano solo nel registro. |
| `PROMEMORIA_GIORNI` | `3` | Giorni di anticipo del promemoria. |
| `ORA_PROMEMORIA` | `9` | Ora del promemoria per le scadenze senza orario. |
| `SANTO_PATRONO` | `"29/06"` | Festività locale considerata non lavorativa (Roma). |
| `PREFISSO_ALTA`, `PREFISSO_MEDIA` | `[Da verificare]`, `[Possibile scadenza]` | Testo anteposto al titolo. |
| `DESCRIZIONE_HTML` | `true` | Se nella descrizione degli eventi vedi comparire `<br>`, mettilo a `false`. |

Se cambiano i **campi** dello script (parametri o risultato), e non solo le impostazioni, nel flusso va eliminata e
rifatta l'azione «Esegui script»: Power Automate memorizza i campi al momento in cui l'azione viene creata.

## Limiti da conoscere

- Analizza **il testo delle email**, non gli allegati (per esempio i PDF).
- Analizza le email che arrivano nella **Posta in arrivo**. Quelle che una regola di Outlook sposta subito in un'altra
  cartella non vengono analizzate.
- I termini relativi («entro 30 giorni») sono calcolati dalla data della email. Se decorrono da una notifica diversa,
  correggi la data.
- Microsoft consente **1.600 esecuzioni al giorno** per utente, più che sufficienti.
- Le regole sono le stesse dello Scadenzario: **ogni scadenza va verificata** sulla fonte.

## Se qualcosa non va

- **Errore sui criteri dei dati (DLP) al salvataggio:** l'IT ha limitato l'uso combinato di questi connettori e serve
  il suo via libera.
- **«Esegui script» non trova lo script:** controlla che si chiami esattamente «Estrai scadenze» e che il file sia
  quello scelto con l'icona della cartella.
- **Nella descrizione compare `<br>`:** imposta `DESCRIZIONE_HTML` a `false`.
- **Gli eventi senza orario risultano dalle 00:00 alle 00:00:** controlla di aver collegato «tuttoIlGiorno» al campo
  dell'evento di un giorno intero.
