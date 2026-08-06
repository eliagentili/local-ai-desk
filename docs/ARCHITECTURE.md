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

## Adapter di esecuzione 0.2

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

## Contratto dei job

Stati ammessi:

```text
draft → queued → preparing → running → finalizing → completed
                    │            │
                    ├─ paused    ├─ cancelling → cancelled
                    └─ failed ←──┘
```

Ogni transizione dovrà essere atomica e accompagnata da un evento persistente.
La percentuale sarà deterministica quando il motore fornisce unità di lavoro
(pagine, segmenti, chunk); altrimenti la UI mostrerà una fase indeterminata senza
inventare una percentuale.

## Confini di sicurezza

- Content Security Policy con rete frontend bloccata;
- selettore file nativo come unico permesso aggiuntivo della finestra;
- path canonicalizzati e verificati prima dell'indicizzazione;
- database in WAL, foreign key abilitate e timeout di concorrenza;
- nessuna shell generica esposta alla UI;
- futuro download dei pack con firma, checksum e manifest bloccato per versione.
