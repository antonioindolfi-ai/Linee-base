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
