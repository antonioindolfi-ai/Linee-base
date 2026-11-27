# Ciclo della spesa

Applicazione per seguire le pratiche di spesa dell'ufficio nelle fasi di **ordinazione, liquidazione, contabilizzazione e pagamento**. È fatta per girare su un server della rete interna: i colleghi la usano dal browser e nessun dato esce dalla rete dell'amministrazione.

## Perché non ha contatti con l'esterno

- **Server:** usa solo la libreria standard di Python. Non serve installare pacchetti, quindi neanche l'installazione scarica nulla.
- **Dati:** stanno in un unico file SQLite sul server (`server/dati/ciclo_spesa.sqlite3`).
- **Pagina:** script, stili e caratteri tipografici (Titillium Web, licenza SIL OFL, in `server/static/fonts/`) sono serviti dal server stesso.
- **Blocco del browser:** il server invia una regola di sicurezza (`Content-Security-Policy`) che vieta al browser di collegarsi a qualsiasi indirizzo diverso dal server.

## Aspetto grafico

L'interfaccia usa **Bootstrap Italia 2.18.3**, il kit di Designers Italia per i siti e i servizi digitali della pubblica amministrazione. La copia del kit è in `server/static/vendor/bootstrap-italia/` (licenza BSD-3-Clause) e i caratteri Titillium Web e Roboto Mono sono in `server/static/fonts/`: tutto è servito dal vostro server.

Il nome dell'amministrazione e della struttura che compaiono nell'intestazione e nel piè di pagina si impostano nel file `server/static/config.json`:

```json
{
 "ente": "Nome dell'amministrazione",
 "struttura": "Direzione generale · Ufficio"
}
```

## Due modi di usare l'applicazione

1. **Postazione di inserimento + postazione di consultazione** (sezione seguente): l'app gira solo sul PC di chi inserisce; sulla cartella condivisa viene salvata una copia che una seconda persona consulta in sola lettura dal proprio PC. Non serve un server.
2. **Server per più utenti** (sezioni «Installazione» e successive): un computer sempre acceso a cui i colleghi si collegano dal browser con utenze e password.

## Postazione di inserimento e postazione di consultazione

**Come funziona**

- Sul PC di chi inserisce si avvia `avvia-inserimento.bat`. L'app si apre nel browser e **risponde solo a quel PC**: non è raggiungibile dalla rete. Si entra con l'accesso a Windows, senza altre password.
- Il **database di lavoro** sta nel profilo Windows di chi inserisce (`%LOCALAPPDATA%\CicloSpesa\inserimento.sqlite3`), non nella condivisa.
- A ogni modifica, dopo un paio di secondi, l'app scrive sulla cartella condivisa la **copia per la consultazione** `ciclo_spesa_consultazione.sqlite3`. La copia non contiene password né sessioni. Viene aggiornata anche alla chiusura del programma.
- Sul PC di chi consulta si avvia `avvia-consultazione.bat`. L'app legge la copia **in sola lettura**: si vedono pratiche, fasi, scadenze, cronologia e guida, ma non si può modificare nulla. La pagina si aggiorna da sola quando arriva una nuova copia.
- Se il PC di chi inserisce è spento, chi consulta vede l'ultima copia pubblicata, con la data indicata in alto.

**Preparazione**

1. Copiare la cartella `server` sui due PC, per esempio in `Documenti\CicloSpesa`. Su entrambi serve **Python 3.8 o successivo**: se non è installato, va chiesto ai sistemi informativi.
2. Creare sulla condivisa una cartella dedicata, per esempio `CicloSpesa`, e **restringerne i permessi** (vedi sotto).
3. Nei file `avvia-inserimento.bat` e `avvia-consultazione.bat` scrivere il percorso di quella cartella nella riga `set CONDIVISA=...`, ad esempio `set CONDIVISA=\\SERVER-FILE\Ufficio1\CicloSpesa`.
4. Avviare con un doppio clic. Il browser si apre da solo; se lo si chiude, si riapre dal collegamento mostrato nella finestra nera del programma. Per chiudere: Ctrl+C nella finestra.

**Permessi della cartella sulla condivisa (passaggio decisivo)**

Chi può leggere la copia lo decidono i permessi di Windows su quella cartella, non l'applicazione. La cartella deve essere accessibile solo alle due persone:

1. tasto destro sulla cartella → Proprietà → Sicurezza → Avanzate;
2. «Disabilita ereditarietà» e rimuovere i gruppi generici (ad esempio Everyone, Utenti, Utenti del dominio);
3. aggiungere **chi inserisce** con permesso «Modifica» e **chi consulta** con permesso «Lettura ed esecuzione».

Se non si hanno i diritti per farlo, va chiesto ai sistemi informativi. Gli amministratori del server dei file conservano comunque l'accesso tecnico alla cartella, come per qualsiasi altro file dell'amministrazione.

**Cosa resta da sapere**

- La copia contiene le pratiche, la cronologia e il nome Windows di chi ha fatto le operazioni.
- Il database di lavoro è il documento «originale»: conviene farne una copia di sicurezza periodica con `python ciclo_spesa.py --db "%LOCALAPPDATA%\CicloSpesa\inserimento.sqlite3" backup DESTINAZIONE`, verso una posizione altrettanto riservata.
- Chi usa la sessione Windows di chi inserisce può usare l'app: va bloccato il PC quando ci si allontana.

## Riservatezza: perché i dati non escono

Cosa garantisce l'applicazione:

- **Il server non si collega a nulla.** Usa solo la libreria standard di Python e non contiene alcuna istruzione di connessione verso l'esterno: riceve richieste, non ne fa.
- **Il browser non può contattare altri indirizzi.** Il server invia una regola di sicurezza (Content-Security-Policy) che consente script, stili, caratteri, immagini e connessioni solo verso il server stesso. Un tentativo di inviare dati altrove viene bloccato dal browser.
- **Nessuna risorsa esterna.** Kit grafico, caratteri e icone sono copiati nella cartella `server/static` e serviti in locale.
- **Nessun dato nel browser.** La pagina non usa memoria locale del browser: i dati stanno solo nel database sul server.
- **Log senza dati.** Il registro del server annota indirizzo del computer, data e percorso della richiesta, non il contenuto delle pratiche né le password.
- **Password protette.** Sono conservate solo come impronta (PBKDF2), le sessioni come impronta del codice di accesso.

Cosa resta in mano all'amministrazione:

- **L'esportazione CSV** scarica le pratiche sul computer di chi la usa: da lì in poi valgono le regole interne sulla gestione dei documenti.
- **La rete interna:** senza HTTPS, password e dati viaggiano in chiaro sulla rete dell'ufficio (vedi la sezione HTTPS).
- **L'accesso al file del database:** vedi sotto.

## Cartella condivisa: come usarla correttamente

L'applicazione **non si usa aprendo i file dalla cartella condivisa**: la pagina funziona solo se il programma `ciclo_spesa.py` è in esecuzione su un computer (un server o un PC sempre acceso), e i colleghi vi accedono dal browser all'indirizzo `http://NOME-DEL-COMPUTER:8080`.

La cartella condivisa può contenere la copia del programma, ma **il database non deve stare in una cartella leggibile da tutti**:

- chi ha accesso alla cartella potrebbe copiare o leggere il file del database senza passare dalle utenze dell'applicazione;
- SQLite su cartelle di rete è meno affidabile (con più accessi contemporanei il file può danneggiarsi).

Per questo:

1. collocate il database su un disco locale del computer che esegue il server, in una cartella accessibile solo all'utenza che lo esegue, con l'opzione `--db`, ad esempio `python ciclo_spesa.py --db D:\ciclo-spesa-dati\ciclo_spesa.sqlite3 avvia --host 0.0.0.0`;
2. se il database viene comunque indicato su una cartella di rete, il server lo segnala all'avvio;
3. conservate i backup in una posizione con accesso altrettanto ristretto;
4. concordate con i sistemi informativi computer, porta, accesso dalla rete interna e certificato HTTPS.

Su Linux il server crea già la cartella dei dati e il database con permessi riservati all'utenza che lo esegue; su Windows i permessi si impostano sulla cartella.

## Requisiti

- Python 3.8 o successivo, su Windows Server o Linux.
- Una porta raggiungibile dalle postazioni dell'ufficio, per esempio la 8080.

## Installazione

1. Copia la cartella `server/` sul server, per esempio in `D:\ciclo-spesa\` oppure `/opt/ciclo-spesa/`.
2. Crea il primo amministratore. Ti verranno chiesti il nome da mostrare e la password, di almeno 10 caratteri:

   ```
   python ciclo_spesa.py crea-admin a.indolfi
   ```

3. Avvia il server in ascolto sulla rete interna:

   ```
   python ciclo_spesa.py avvia --host 0.0.0.0 --porta 8080
   ```

   Senza `--host 0.0.0.0` il server risponde solo dal computer su cui gira.
4. Dalle postazioni apri `http://NOME-DEL-SERVER:8080`.

## HTTPS (consigliato)

Le password viaggiano in rete, quindi sulla rete dell'ufficio va usato HTTPS. Le strade sono due:

- **certificato rilasciato dall'amministrazione:**

  ```
  python ciclo_spesa.py avvia --host 0.0.0.0 --porta 8443 --cert server.crt --key server.key
  ```

- **dietro il proxy interno (IIS, Apache, nginx) che gestisce già l'HTTPS:** avvia il server su `127.0.0.1` e aggiungi `--dietro-proxy-https`, così il cookie di sessione viene marcato come sicuro.

Il server integrato è adatto a un ufficio con decine di utenti. Per un uso più esteso conviene comunque collocarlo dietro il proxy dell'amministrazione.

## Avvio automatico

- **Windows:** crea un'attività in Utilità di pianificazione con trigger «All'avvio» ed esegui `python D:\ciclo-spesa\ciclo_spesa.py avvia --host 0.0.0.0 --porta 8080`.
- **Linux:** crea un servizio systemd con `ExecStart=/usr/bin/python3 /opt/ciclo-spesa/ciclo_spesa.py avvia --host 0.0.0.0 --porta 8080`.

## Utenze e ruoli

L'amministratore gestisce le utenze dalla scheda **Utenti e registro**. Quando crea un'utenza o reimposta una password, l'app genera una password provvisoria: va comunicata all'interessato per un canale riservato, e al primo accesso l'interessato deve sceglierne una personale.

| Ruolo | Cosa può fare |
|---|---|
| Amministratore | tutto, compresa la gestione delle utenze, la consultazione del registro e l'eliminazione delle pratiche |
| Operatore | crea e aggiorna le pratiche, spunta gli adempimenti, cambia la fase |
| Consultazione | sola lettura |

Misure di sicurezza:

- le password sono conservate solo come impronta (PBKDF2-SHA256);
- dopo 5 tentativi errati l'utenza è bloccata per 15 minuti;
- le sessioni scadono dopo 8 ore.

Se un amministratore perde la password, dal server si usa:

```
python ciclo_spesa.py reimposta-password a.indolfi
```

## Registro delle operazioni

Ogni operazione viene registrata con autore, data e ora:

- creazione e modifica dei dati;
- spunta degli adempimenti;
- cambi di fase, sospensioni ed eliminazioni;
- gestione delle utenze.

Il registro è consultabile dall'amministratore. La cronologia di ogni pratica è visibile nella scheda della pratica.

## Backup

Il comando seguente produce una copia coerente del database anche mentre il server è in funzione:

```
python ciclo_spesa.py backup D:\backup\ciclo_spesa-2026-11-20.sqlite3
```

Conviene pianificarlo ogni giorno e conservare le copie secondo le regole dell'amministrazione. Per ripristinare un backup, si arresta il server e si sostituisce il file `dati/ciclo_spesa.sqlite3`.

## Fasi già svolte

Se una pratica viene registrata quando una o più fasi sono già state svolte, nella procedura guidata si usa il pulsante **Salta la fase: è già stata svolta**. Dopo la conferma, le sottofasi non ancora spuntate vengono registrate come «già svolte» a nome di chi conferma e la pratica passa alla fase successiva; l'operazione resta nella cronologia.

## Personalizzare le liste di controllo

Fasi, tipologie, adempimenti e campi sono nel file `server/static/modello.json`. Per modificarli:

1. si modifica il file;
2. si riavvia il server.

Il campo `"r": 1` rende obbligatorio un adempimento. Non vanno cambiati gli `id` degli adempimenti già usati, altrimenti le spunte registrate non vengono più riconosciute.

## Avvertenza

Le liste di controllo e i termini sono un supporto operativo. Non sostituiscono la disciplina vigente, le circolari della Ragioneria generale dello Stato e le indicazioni dell'Ufficio centrale di bilancio.
