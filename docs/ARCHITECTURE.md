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
- `settings`: tabella creata per le preferenze e **non ancora usata**: nella 1.0
  l'unica preferenza dell'utente — il controllo automatico degli aggiornamenti —
  vive nel `localStorage` della finestra, non qui.

I file non vengono copiati durante l'importazione. L'hash viene calcolato con
buffer da 8 MB, quindi il costo di memoria resta limitato anche per video da
diversi GB. Le operazioni di disco girano fuori dal thread UI.

Il percorso **Drop rapido** è separato dalla Libreria: Tauri canonicalizza i
path ricevuti dal drag & drop nativo, legge solo i metadati e crea job con
`library_item_id = NULL`. Non calcola hash e non inserisce sorgenti nel database.
Il worker riceve il file in streaming dentro una directory temporanea che viene
rimossa al completamento, dopo un errore e in seguito a un annullamento. Soltanto
il risultato atomico resta nel contenitore dell'app.

## Runtime desktop

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

I modelli Ollama vivono in `~/.ollama/models`, la posizione convenzionale di
Ollama, non dentro il contenitore dell'app. Sono modelli ufficiali del registro
e pesano quasi 10 GB: un computer che li ha gia', perche' l'utente usa Ollama
per altro, non ne scarica una seconda copia, e uno che non li ha se li ritrova
dove Ollama stesso li avrebbe messi. Il bootstrap salta il download di ogni
modello gia' presente e sposta lo store privato delle versioni precedenti invece
di riscaricarlo. Un `OLLAMA_MODELS` impostato dall'utente ha sempre la
precedenza: chi ha spostato i modelli su un disco esterno ha gia' deciso.

Il checkpoint del Privacy Filter non fa parte dell'installazione: il meccanismo è
descritto sotto, in **Model pack**.

Il processo resta invece nostro: l'app avvia il proprio server con la versione
pinnata e `OLLAMA_HOST=127.0.0.1`, e lo supervisiona. Se ne trova gia' uno in
esecuzione lo adotta senza spegnerlo mai, perche' appartiene all'utente; in quel
caso verifica se accetta connessioni oltre a quelle locali e lo segnala in
Modelli — i documenti restano comunque sul dispositivo, ma quel servizio
risponde anche ad altri sulla stessa rete.

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

## Model pack

Quasi tutti i modelli arrivano con l'installazione iniziale. Il checkpoint del
Privacy Filter pesa 2,6 GB e serve solo a chi maschera dati personali, quindi si
scarica su richiesta da **Modelli**: fino ad allora il motore lavora sulle sole
regole italiane e lo dichiara nel risultato, invece di risultare semplicemente
«completato».

Il download finisce in una cartella di staging e viene spostato a destinazione
solo quando è completo. Scrivendo direttamente nella destinazione, `config.json`
comparirebbe dopo pochi secondi e `engine_status` dichiarerebbe il motore pronto
mentre i pesi stanno ancora arrivando: i lavori finirebbero su un modello che non
c'è. Del repository viene scaricata solo la sottocartella del checkpoint —
senza quel filtro sarebbero circa 17 GB invece di 2,6.

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

`paused` non esiste: pausa e ripresa sono dichiarate fuori dalla 1.0 nella
[roadmap](ROADMAP.md). Un lavoro si annulla e si riavvia da capo.

Ogni transizione è atomica e accompagnata da un evento persistente in
`job_events`, potato a 200 eventi per lavoro all'avvio, ed è leggibile
dall'interfaccia: Attività apre la cronologia di ogni lavoro con orario, stato,
fase e messaggio. La percentuale è deterministica quando il motore fornisce unità
di lavoro (pagine, segmenti, chunk); altrimenti la UI mostra una fase
indeterminata senza inventare un numero.

Uscire da un lavoro è garantito su tre fronti. Un output assente, vuoto o di soli
spazi è un errore prima che venga creata una cartella o scritto un file, sia nel
core sia in ogni motore. L'annullamento termina il processo figlio del motore —
markitdown, docling e Privacy Shield girano fuori dal processo del server proprio
perché una chiamata bloccante in un thread non è interrompibile e il semaforo di
`privacy` vale 1. E un tetto di durata per lavoro, dodici ore per default,
trasforma un motore vivo ma bloccato in un errore azionabile invece di una riga
che resta `running` per sempre. Se la scrittura dello stato finale fallisce viene
ritentata, e in ultima istanza la riga è riconciliata a `interrupted` al riavvio
successivo.

Lo schema del database dichiara la propria versione in `PRAGMA user_version`. Le
migrazioni sono solo additive, quindi una versione più vecchia dell'app apre un
archivio più nuovo; il contrario è rifiutato con un messaggio azionabile, perché
leggere a metà i dati di chi ha fatto un downgrade è peggio che dirlo.

L'app scrive un proprio log locale, in append e con rotazione, con un hook sui
panic concatenato al precedente, il tempo trascorso fino al primo snapshot pronto
e un marcatore di chiusura pulita: è ciò che rende misurabili crash-free rate e
tempo di avvio.

## Confini di sicurezza

- Content Security Policy con rete frontend bloccata;
- selettore file nativo come unico permesso aggiuntivo della finestra;
- path canonicalizzati e verificati prima dell'indicizzazione o del job rapido;
- database in WAL, foreign key abilitate e timeout di concorrenza;
- nessuna shell generica esposta alla UI;
- token casuale per sessione fra core e motori: il backend su `127.0.0.1:8787`
  rifiuta ogni richiesta priva del token e ogni richiesta con header `Origin`,
  quindi nessun'altra applicazione — né una pagina aperta nel browser — può
  inviargli documenti o interromperne i lavori. Il token vive solo in memoria e
  nelle variabili d'ambiente del figlio: non viene scritto su disco, e può essere
  imposto dall'ambiente soltanto nelle build di debug;
- se all'avvio la porta dei motori è già occupata, il core adotta quel processo
  **solo** se risponde al token di questo avvio; altrimenti rifiuta con un
  messaggio azionabile invece di parlare con un server sconosciuto;
- la superficie HTTP dei motori non espone documentazione interattiva
  (`/docs`, `/redoc`, `/openapi.json` rispondono 404), il log di accesso è
  disattivato e il nome del documento viaggia in un header, non nell'URL: il nome
  dei file dell'utente non finisce nei log;
- alla chiusura l'app termina l'intero process group dei motori, prima con
  SIGTERM e poi a forza: nessun worker di traduzione sopravvive alla finestra;
- il motore sorveglia a sua volta l'app che lo ha avviato e si spegne entro
  cinque secondi se questa sparisce, portando con sé Ollama e le copie di
  lavoro. Vale anche per un crash, un'Uscita forzata o un `kill -9`, dove
  nessuna pulizia lato app può essere eseguita: sul computer dell'utente non
  restano processi né modelli in memoria;
- una sola istanza per volta: un secondo avvio riporta in primo piano la finestra
  esistente invece di contendersi database, porta e processi dei motori;
- i pid dei motori sono registrati con il nome dell'eseguibile, così la pulizia
  degli orfani dopo un crash non può colpire un pid riciclato da un altro
  programma;
- i file di lavoro rimasti da una sessione interrotta vengono rimossi all'avvio
  successivo, insieme ai risultati `.partial` incompleti;
- gli asset del bootstrap (uv, il binario di Ollama, il sorgente del Privacy
  Filter) sono fissati per SHA-256 e verificati prima dell'uso, e i pacchetti
  Python installati con `--require-hashes` dai lock per piattaforma. **I pesi dei
  modelli non sono ancora fissati per revisione**: arrivano per tag dal registro
  Ollama e da Hugging Face, dove manifest e layer sono content-addressed ma il tag
  è mutabile. È un limite dichiarato in [LICENSING.md](LICENSING.md);
- gli aggiornamenti dell'app sono firmati Ed25519 e la firma è verificata prima
  dell'installazione. **Il pacchetto scaricato dal sito non è firmato con un
  certificato di sistema**: la garanzia è il checksum firmato pubblicato con la
  release, non Gatekeeper. Vedi [THREAT_MODEL.md](THREAT_MODEL.md).
