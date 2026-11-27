# Ciclo della spesa — versioni conservate

Tutto il lavoro è conservato nel repository `antonioindolfi-ai/Linee-base`, branch `ccr-48b60d09-ap4nzm`: ogni passaggio è un commit e resta recuperabile. Da ogni commit GitHub permette di scaricare lo ZIP completo dei file in quello stato:

| Versione | Contenuto | Scarica lo ZIP |
|---|---|---|
| Prima versione (commit `a886e57`) | Pagina unica con archivio condiviso su claude.ai | https://github.com/antonioindolfi-ai/Linee-base/archive/a886e576fe2a7da07ad76b52fe6cdf6215234ef4.zip |
| Versione completa al 27/11/2026 (commit `af8f24e`) | Server per più utenti **e** postazioni inserimento/consultazione, procedura guidata, Bootstrap Italia, rimborsi di missione | https://github.com/antonioindolfi-ai/Linee-base/archive/af8f24ee215ee77b8a8c2d931bcc22ccc68fcd7c.zip |

Per fissare questi punti anche come segnalibri permanenti (tag), dalla pagina del repository su GitHub: «Releases» → «Draft a new release» → in «Choose a tag» scrivere un nome (ad esempio `ciclo-spesa-v2`) e come destinazione il branch `ccr-48b60d09-ap4nzm`.

## Le modalità d'uso tra cui scegliere

Le due modalità della versione attuale **convivono nello stesso programma** (`server/ciclo_spesa.py`): si sceglie con il comando di avvio, senza perdere nulla dell'altra.

| | A. Postazione di inserimento + consultazione | B. Server per più utenti | C. Prima versione su claude.ai |
|---|---|---|---|
| Come si avvia | `avvia-inserimento.bat` e `avvia-consultazione.bat` | `python ciclo_spesa.py avvia --host 0.0.0.0` su un PC sempre acceso | si apre il link della pagina |
| Chi inserisce | una persona, sul proprio PC | più colleghi, ciascuno con la propria utenza | chi ha accesso alla pagina |
| Chi consulta | una persona, in sola lettura, dalla copia sulla condivisa | i colleghi con profilo «consultazione» | chi ha accesso alla pagina |
| Dove stanno i dati | profilo Windows di chi inserisce; copia sulla condivisa | file sul computer che fa da server | servizi di claude.ai |
| Accesso | sessione Windows; l'app risponde solo al PC locale | utenze con password, ruoli, blocco dopo tentativi errati | account claude.ai |
| Rete | nessuna porta aperta verso la rete | porta aperta sulla rete interna (serve HTTPS) | Internet |
| Dati fuori dall'amministrazione | no | no | **sì**: non adatta ai dati reali |
| Requisiti | Python sui due PC; permessi della cartella condivisa | Python sul computer server; porta e HTTPS con i sistemi informativi | nessuno |
| Quando conviene | un solo addetto all'inserimento e un solo consultatore | più persone che lavorano sulle stesse pratiche | solo per dimostrazioni |

## Funzioni comuni alle modalità A e B

- Quattro fasi: ordinazione, liquidazione, contabilizzazione, pagamento.
- Cinque tipologie: fatture commerciali (beni e servizi), rimborsi di missione, spese legali, compensi organi, altra spesa.
- Procedura guidata: maschera «Come si svolge» per ogni fase, domande una alla volta (Sì / No, ma so come si fa / No, spiegami), scheda di approfondimento per ogni sottofase, riepilogo, salto di una fase già svolta.
- Scadenze calcolate (15 e 30 giorni per le fatture, 120 giorni per i titoli esecutivi), cruscotto con filtro per tipologia, elenco con ricerca ed esportazione CSV, cronologia e registro delle operazioni.
- Grafica Bootstrap Italia servita in locale; nessuna risorsa esterna.
- Testi di fasi, sottofasi e spiegazioni modificabili in `server/static/modello.json`.

## Interfaccia di prova (dati fittizi)

- Pubblica: https://antonioindolfi-ai.github.io/Linee-base/ciclo-spesa/ (credenziali `demo` / `demo`).
- Privata su claude.ai: https://claude.ai/artifact/7rXcaKXtjUkauLMEfW2591
- Si rigenera dai file dell'app con `python demo/costruisci.py`.

## Storia dei passaggi

| Commit | Passaggio |
|---|---|
| `a886e57` | Prima versione su claude.ai |
| `024d1d5` | Versione autonoma per la rete interna (server Python, SQLite, utenze) |
| `c378003` | Interfaccia di prova con dati fittizi |
| `ec698f1` | Procedura guidata fase per fase |
| `60448c2` | Maschera «Come si svolge» per ogni fase |
| `3f8e074` | Scheda di approfondimento per ogni sottofase |
| `f9fd425` | Grafica Bootstrap Italia e «Salta la fase» |
| `27d0db2` | Tipologia «Rimborsi di missione» |
| `ec06778` | Verifiche di riservatezza, avvisi sul database in rete |
| `af8f24e` | Postazione di inserimento e consultazione da cartella condivisa |
