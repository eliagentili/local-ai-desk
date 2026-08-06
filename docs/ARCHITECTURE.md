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

## Foundation corrente

Il database contiene tre insiemi:

- `library_items`: riferimenti ai file originali, tipo, dimensione e hash;
- `jobs`: workflow, stato, avanzamento, fase, output ed errore;
- `settings`: preferenze versionabili.

I file non vengono copiati durante l'importazione. L'hash viene calcolato con
buffer da 8 MB, quindi il costo di memoria resta limitato anche per video da
diversi GB. Le operazioni di disco girano fuori dal thread UI.

## Ponte di migrazione

La Foundation interroga esclusivamente
`http://127.0.0.1:8787/api/status` con timeout breve. Non accetta URL scelti
dall'utente e non concede al frontend permessi HTTP. Questo ponte serve a
osservare i motori della v1 senza modificare o interrompere la vecchia app.

Il passo successivo sostituirà il semplice health check con un adapter di job
versionato. In seguito ogni motore verrà spostato in un worker gestito dalla v2.

## Contratto futuro dei job

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
