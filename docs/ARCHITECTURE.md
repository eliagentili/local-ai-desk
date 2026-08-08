# Architettura

## Strati

```text
React UI
  │  comandi tipizzati, nessun accesso generico a file o rete
  ▼
Tauri / Rust core
  ├─ Library service ── SQLite + hash BLAKE3 in streaming
  ├─ Job orchestrator ─ stati, eventi, cancellazione, recovery
  ├─ Engine registry ── manifest, compatibilità, health check
  └─ Security boundary ─ permessi, loopback, cartelle autorizzate
                          │
                          ▼
                  Engine workers isolati
             OCR · documenti · audio · traduzione
```

La UI non deve conoscere processi Python, porte o cartelle dei modelli. Il core
espone comandi di dominio e normalizza ogni motore dietro un contratto comune.

## Core corrente

Il database contiene quattro insiemi:

- `library_items`: riferimenti ai file originali, tipo, dimensione e hash;
- `jobs`: workflow, stato, avanzamento, fase, output ed errore;
- `job_events`: transizioni persistenti della coda;
- `settings`: preferenze versionabili.

I file non vengono copiati durante l'importazione. L'hash viene calcolato con
buffer da 8 MB, quindi il costo di memoria resta limitato anche per video da
diversi GB. Le operazioni di disco girano fuori dal thread UI.

Il percorso **Drop rapido** è separato dalla Libreria: Tauri canonicalizza i
path ricevuti dal drag & drop nativo, legge solo i metadati e crea job con
`library_item_id = NULL`. Non calcola hash e non inserisce sorgenti nel database.
Il worker riceve il file in streaming dentro una directory temporanea che viene
rimossa al completamento, dopo un errore e in seguito a un annullamento. Soltanto
il risultato atomico resta nel contenitore dell'app.

## Runtime desktop 0.4

Il core Rust interroga ed esegue lavori esclusivamente su
`http://127.0.0.1:8787`, con timeout e URL non configurabile dall’interfaccia.
I file vengono letti dal disco e inviati in streaming con `Content-Length`, senza
essere caricati interamente in RAM. Il frontend non possiede permessi HTTP.

Lo scheduler v2 applica backpressure globale con tre slot; i worker v1
continuano ad applicare i limiti più restrittivi per singolo motore. Traduzione
PDF espone pagine, parti e fasi reali; per i motori che non espongono unità di
lavoro la UI mostra correttamente un avanzamento indeterminato. Gli output sono
scritti dentro il contenitore dell’app e i PDF usano un file parziale rinominato
solo a completamento.

Il bundle contiene sorgenti e bootstrap comuni, ma non scrive mai nella propria
directory di installazione. Tauri risolve le risorse in `.app/Contents/Resources`
su macOS e accanto ai file installati sotto Windows; venv, tool, cache e modelli
vivono invece nella cartella dati per utente. Il core avvia Python/Ollama con
stdio su log, senza console visibile, e conserva gli handle dei soli processi
creati dall'app per terminarli in modo pulito.

Le differenze di sistema sono circoscritte agli adapter nativi:

- Finder `open -R` su macOS ed `explorer.exe /select` su Windows;
- process group POSIX e `CREATE_NEW_PROCESS_GROUP`/`CREATE_NO_WINDOW` su Windows;
- `.venv/bin` su Unix e `.venv\Scripts` su Windows;
- `.app`/`.dmg` su macOS e NSIS `.exe`/WiX `.msi` su Windows.

## Contratto dei job

Stati implementati:

```text
queued → preparing → uploading → running → finalizing → completed
   │          │           │          │
   │          └───────────┴──────────┴── cancelling → cancelled
   ├── failed
   └── interrupted        (era attivo alla chiusura dell'app)
```

`completed`, `failed`, `cancelled` e `interrupted` sono terminali: il database
rifiuta ogni transizione che tenti di uscirne, così un annullamento che arriva
dopo il salvataggio non può bloccare un lavoro concluso. Da `failed`,
`cancelled` e `interrupted` si può tornare in `queued` soltanto con un riavvio
esplicito dell'utente, possibile quando la fonte è in Libreria.

`paused` non esiste ancora: pausa e ripresa sono in [roadmap](ROADMAP.md) F1.

Ogni transizione è atomica e accompagnata da un evento persistente in
`job_events`, potato a 200 eventi per lavoro all'avvio. La percentuale è
deterministica quando il motore fornisce unità di lavoro (pagine, segmenti,
chunk); altrimenti la UI mostra una fase indeterminata senza inventare un
numero.

## Confini di sicurezza

- Content Security Policy con rete frontend bloccata;
- selettore file nativo come unico permesso aggiuntivo della finestra;
- path canonicalizzati e verificati prima dell'indicizzazione o del job rapido;
- database in WAL, foreign key abilitate e timeout di concorrenza;
- nessuna shell generica esposta alla UI;
- token casuale per sessione fra core e motori: il backend su `127.0.0.1:8787`
  rifiuta ogni richiesta priva del token e ogni richiesta con header `Origin`,
  quindi nessun'altra applicazione — né una pagina aperta nel browser — può
  inviargli documenti o interromperne i lavori;
- alla chiusura l'app termina l'intero process group dei motori, prima con
  SIGTERM e poi a forza: nessun worker di traduzione sopravvive alla finestra;
- una sola istanza per volta: un secondo avvio riporta in primo piano la finestra
  esistente invece di contendersi database, porta e processi dei motori;
- i pid dei motori sono registrati con il nome dell'eseguibile, così la pulizia
  degli orfani dopo un crash non può colpire un pid riciclato da un altro
  programma;
- i file di lavoro rimasti da una sessione interrotta vengono rimossi all'avvio
  successivo, insieme ai risultati `.partial` incompleti;
- futuro download dei pack con firma, checksum e manifest bloccato per versione.
