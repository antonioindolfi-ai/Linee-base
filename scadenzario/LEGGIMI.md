# Scadenzario offline

Strumento in **un solo file** (`scadenzario.html`) che estrae le scadenze dalle email e le organizza in un calendario.
Si apre con un doppio clic in Edge, Chrome o Firefox. Non va installato e non servono permessi di amministratore.

## Riservatezza

- **Nessun dato lascia il computer.** La pagina contiene una *Content-Security-Policy* (`connect-src 'none'`, `default-src 'none'`)
  che impedisce al browser qualsiasi connessione di rete. Anche le immagini esterne contenute nelle email non vengono scaricate.
- Non usa librerie esterne, font online né servizi di intelligenza artificiale: tutto il codice è nel file e si può ispezionare.
- I dati restano nell'archivio locale del browser (`localStorage`) di quel computer.

## Uso

1. **Importa email.** Trascina i file nella pagina:
   - da **Outlook**: trascina il messaggio sul desktop (crea un file `.msg`) oppure usa *File → Salva con nome*;
   - **PEC**: va bene il file `.eml` completo; lo strumento apre automaticamente il messaggio originale (`postacert.eml`)
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
