# Audit privacy

**Data dell'audit: 9 agosto 2026. Versione esaminata: 1.0.0.**

Questo documento non è l'informativa: quella è [../PRIVACY.md](../PRIVACY.md).
Qui c'è l'inventario verificabile di ciò che l'app manda fuori, di ciò che scrive
sul disco e del metodo con cui l'assenza di telemetria è stata controllata. Ogni
riga rimanda al codice che la produce, e i comandi di verifica sono ripetibili da
chiunque abbia il repository.

`<dati app>` è `~/Library/Application Support/it.local.localaidesk2` su macOS e
`%APPDATA%\it.local.localaidesk2` su Windows (chiave `identifier` in `src-tauri/tauri.conf.json`).

---

## 1. Flussi di rete uscenti

Tutti i flussi elencati sono **gli unici** che il prodotto origina. Nessuno
trasporta i documenti dell'utente né il loro contenuto: quello che il
destinatario riceve sono i normali metadati di una richiesta HTTPS (indirizzo IP,
user agent, data, risorsa richiesta).

| # | Destinazione | Quando | Contenuto | Origine nel codice | Disattivabile |
| --- | --- | --- | --- | --- | --- |
| **F1** | `github.com` — manifest `latest.json` della release | 15 s dopo l'avvio e poi ogni 6 ore, se il controllo automatico è attivo | GET del manifest | costanti `INITIAL_CHECK_DELAY_MS` e `PERIODIC_CHECK_MS` in `src/hooks/useAppUpdater.ts`; endpoint in `plugins.updater.endpoints` di `src-tauri/tauri.conf.json` | Sì, interruttore in **Impostazioni** (`setAutomaticChecks` in `src/hooks/useAppUpdater.ts`) |
| **F2** | `github.com` — pacchetto di aggiornamento | Solo quando l'utente conferma l'installazione | GET dell'archivio firmato | `src/hooks/useAppUpdater.ts` (`install()`); URL nel manifest generato dall'oggetto `manifest` di `scripts/prepare-release-assets.mjs` | Sì: senza conferma non parte |
| **F3** | `github.com/astral-sh/uv` | Una volta, all'installazione dei motori | GET dell'archivio di uv | passo `[1/6]` di `engine/scripts/bootstrap-macos.sh` e di `engine/scripts/bootstrap-windows.ps1` | Sì: i motori non si installano se non li si installa |
| **F4** | `pypi.org` (e i CDN dei wheel) | Una volta, all'installazione dei motori, tre volte (runtime, traduzione, override) | GET dei wheel elencati nei lock, con hash obbligatori | passi `[2/6]` e `[3/6]` di `engine/scripts/bootstrap-macos.sh` | Come F3 |
| **F5** | `github.com/openai/privacy-filter` | Una volta, all'installazione dei motori | GET dell'archivio del sorgente a una revisione fissata | passo `[4/6]` di `engine/scripts/bootstrap-macos.sh` | Come F3 |
| **F6** | `github.com/ollama/ollama` | Una volta, all'installazione dei motori | GET dell'archivio del binario | passo `[5/6]` di `engine/scripts/bootstrap-macos.sh` | Come F3 |
| **F7** | Registro Ollama (`registry.ollama.ai`) | All'installazione dei motori, solo per i modelli non ancora presenti | `pull` di `glm-ocr` e `translategemma:12b` | `ensure_model` in `engine/scripts/bootstrap-macos.sh` | Come F3 |
| **F8** | `huggingface.co` — modelli faster-whisper | Una volta, all'installazione dei motori | Download del modello `small` | passo `[6/6]` di `engine/scripts/bootstrap-macos.sh` | Come F3 |
| **F9** | `huggingface.co` — modelli Docling | Una volta, all'installazione dei motori | `docling-tools models download` | passo `[6/6]` di `engine/scripts/bootstrap-macos.sh`, `docling-tools models download` | Come F3 |
| **F10** | `huggingface.co` — pesi del Privacy Filter | Solo quando l'utente premette il pulsante di download in **Modelli** | `snapshot_download` della sottocartella del checkpoint | `engine/backend/app/engines.py` (`_run_model_download`, chiamata a `snapshot_download`) | Sì: il pack non si scarica da solo |
| **F11** | Cache PaddleX (`paddlepaddle.org.cn` / `bj.bcebos.com`, secondo la build di PaddleOCR installata) | **Al primo OCR con PaddleOCR**, non durante l'installazione | Download dei modelli della pipeline PP-StructureV3 mancanti | `engine/backend/app/engines.py` (`_paddle_pipeline`, costruzione di `PPStructureV3`); destinazione fissata a `PADDLE_PDX_CACHE_HOME` in `engine/backend/app/config.py` | No: è PaddleOCR a decidere. Chi non usa l'OCR non lo innesca |

**F11 merita una riga in più.** È l'unico flusso che parte durante l'uso normale
e non durante un'installazione esplicita. PaddleOCR scarica i propri modelli alla
prima costruzione della pipeline; il progetto non li scarica in anticipo e non li
include nell'installer. L'app dirotta la cache dentro la propria cartella
(`PADDLE_PDX_CACHE_HOME` in `engine/backend/app/config.py`) perché non
scriva in `~/.paddlex`, ma non impedisce il download. Conseguenza pratica: **il
primo OCR richiede una connessione**. Il documento non viene inviato: viene
scaricato un modello.

### Flussi interni che non lasciano il dispositivo

Elencati per completezza, perché a un'analisi del traffico assomigliano a
connessioni di rete e non lo sono.

| Da | A | Nota |
| --- | --- | --- |
| Core Rust | `127.0.0.1:8787` (backend dei motori) | Loopback; uvicorn è vincolato a `127.0.0.1` in `src-tauri/src/commands.rs` (`spawn_runtime_process`) |
| Backend | `127.0.0.1:11434` (Ollama) | `OLLAMA_URL` in `engine/backend/app/config.py`; Ollama avviato con `OLLAMA_HOST=127.0.0.1:11434` (`src-tauri/src/commands.rs`, `spawn_ollama_process`) |
| Worker di traduzione | `127.0.0.1:11434` | `engine/scripts/pdf_translation_worker.py` usa solo `OllamaSettings` |

Il pacchetto di traduzione installa, come dipendenze transitive, adapter per
servizi di traduzione cloud. **Non sono configurati né selezionabili**: l'endpoint
è fissato al loopback nei due punti sopra. Restano nell'ambiente come codice
morto e sono dichiarati nei notices.

---

## 2. Dati a riposo

| # | Percorso | Chi scrive | Contiene | Quando viene cancellato |
| --- | --- | --- | --- | --- |
| **D1** | `<dati app>/local-ai-desk.sqlite3` (+ `-wal`, `-shm`) | Core Rust (`src-tauri/src/database.rs`) | Nomi, percorsi, dimensioni, hash BLAKE3 del contenuto, cronologia dei lavori, messaggi d'errore, impostazioni. **Non** il contenuto dei documenti | Mai automaticamente. La cronologia visibile è limitata alle ultime righe; gli eventi per lavoro vengono potati all'avvio (`prune_job_events` in `initialize`) |
| **D2** | `<dati app>/results/<job_id>/` | Core Rust, alla conclusione di un lavoro (`src-tauri/src/engine_bridge.rs`, costruzione di `job_dir` da `results_dir`) | Il risultato: testo, Markdown, SRT, JSON, PDF tradotto | Mai automaticamente: è l'output che l'utente vuole. I file `.<nome>.partial` di lavori interrotti vengono rimossi al successivo avvio (`src-tauri/src/lib.rs`, `sweep_partial_results`), insieme alla cartella se resta vuota |
| **D3** | `<dati app>/engine/work/jobs/<temporanea>/` | Backend Python, durante il lavoro | La **copia integrale** del documento in elaborazione | Alla fine del lavoro, all'errore e all'annullamento (directory temporanea per lavoro in `engine/backend/app/main.py`); ciò che un crash lascia indietro viene spazzato al successivo avvio del motore (`sweep_orphan_jobs`) |
| **D4** | `<dati app>/engine/runtime.log` (+ `.log.1`) | Backend Python, in append | Righe di stato ed errori del motore. Il log degli accessi di uvicorn è disattivato e il nome del file viaggia in un header invece che nella query, quindi i nomi dei documenti non vengono più registrati riga per riga (`engine/backend/app/main.py`: `source_filename` e la disattivazione del logger `uvicorn.access`). Un nome può ancora comparire dentro il testo di un errore | Mai. Ruota quando supera 4 MB (`src-tauri/src/commands.rs`, `rotate_log_if_large`) |
| **D5** | `<dati app>/engine/ollama.log` (+ `.log.1`) | Ollama, in append | Righe di stato del server dei modelli e nomi dei modelli | Mai. Stessa rotazione a 4 MB |
| **D6** | `<dati app>/engine/install.log` (+ `.log.1`) | Script di bootstrap, in append | Fasi dell'installazione, URL scaricati, esiti dei checksum | Mai. Stessa rotazione a 4 MB |
| **D7** | `<dati app>/app.log` (+ una generazione precedente) | Core Rust (`src-tauri/src/app_log.rs`) | Avvio, tempo fino all'operatività, chiusura pulita, panic. **Mai** nomi o contenuti di documenti (commento di modulo di `src-tauri/src/app_log.rs`) | Mai. Ruota a 1 MB (`MAX_LOG_BYTES` in `src-tauri/src/app_log.rs`) |
| **D8** | `<dati app>/engine/models/` | Bootstrap e download dei pack | Modelli faster-whisper, Docling, pesi del Privacy Filter, cache PaddleX, cache Hugging Face (il blocco delle cache di terze parti in `engine/backend/app/config.py`) | Mai automaticamente. Sono decine di GB e vanno rimossi a mano |
| **D9** | `<dati app>/engine/.venv/`, `tools/`, `python/` | Bootstrap | Interprete Python, ~290 pacchetti, binario Ollama, sorgente del Privacy Filter | Mai automaticamente |
| **D10** | `<dati app>/engine/*.pid` | Core Rust (`src-tauri/src/process.rs`, `remember`) | Il pid dei processi avviati dall'app | Al recupero degli orfani al successivo avvio (`reap_orphan`) |
| **D11** | `~/.ollama/models` (`%USERPROFILE%\.ollama\models`) | Ollama | I modelli del registro, quasi 10 GB. **Fuori dalla cartella dell'app di proposito**: è dove Ollama li tiene, e duplicarli sprecherebbe disco | Mai automaticamente. Condivisi con qualunque altro uso di Ollama sulla macchina |
| **D12** | `localStorage` della webview | Frontend | La preferenza sul controllo automatico degli aggiornamenti (`setAutomaticChecks` in `src/hooks/useAppUpdater.ts`) | Con la cartella dati dell'app |

**Cosa non esiste**: nessun file di identificatore installazione, nessun id
utente, nessun contatore d'uso, nessuna coda di eventi da inviare. Verificato al
punto 3.

**Drop rapido**: i file aperti con il Drop rapido non entrano in D1. Restano fuori
dal database per scelta, ed è il motivo per cui il riavvio di un lavoro funziona
solo su fonti in Libreria. Le loro copie di lavoro (D3) seguono le stesse regole
di cancellazione di qualunque altro lavoro.

---

## 3. Verifica dell'assenza di telemetria

Comandi eseguiti il 9 agosto 2026 sul repository, dalla radice. Sono ripetibili:
se uno di questi restituisce un risultato dove sotto è scritto «nessuno», la
dichiarazione «nessuna telemetria» non è più vera.

### V1 — Ogni host che il codice spedito può nominare

```bash
grep -rnoE 'https?://[a-zA-Z0-9._-]+' \
  src/ src-tauri/src/ engine/backend/ src-tauri/tauri.conf.json \
  --include='*.ts' --include='*.tsx' --include='*.rs' --include='*.py' --include='*.json' \
  | grep -oE 'https?://[a-zA-Z0-9._-]+' | sort | uniq -c | sort -rn
```

Esito: `http://127.0.0.1` (loopback verso motore e Ollama), `https://github.com`
(endpoint dell'updater), `http://localhost`, `http://ipc.localhost`,
`http://asset.localhost` (schemi interni della webview Tauri, non rete),
`https://schema.tauri.app` (riferimento allo schema JSON, non una richiesta).
**Nessun altro host.** Gli host di F3–F11 compaiono negli script di bootstrap e
nei lock, non nel codice dell'app: sono inclusi in V2.

### V2 — Nomi di SDK di analytics, crash reporting e telemetria

```bash
grep -rniE 'sentry|posthog|mixpanel|amplitude|segment\.io|google-analytics|gtag|datadog|bugsnag|crashlytics|analytics|telemetry|opentelemetry' \
  src/ src-tauri/src/ engine/backend/ package.json src-tauri/Cargo.toml
```

Esito: **nessun risultato**.

### V3 — Ogni modo in cui il frontend potrebbe emettere una richiesta

```bash
grep -rnE '\bfetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon|new Image\(' src/
```

Esito: **nessun risultato**. Il frontend non parla con la rete: parla con il core
attraverso l'IPC di Tauri.

### V4 — La CSP conferma V3 anche a runtime

```bash
grep -n '"csp"' src-tauri/tauri.conf.json
```

`connect-src` consente `'self'`, `ipc:` e `http://ipc.localhost`: una richiesta
verso un host esterno viene bloccata dal browser engine, indipendentemente dal
codice.

### V5 — I permessi nativi concessi alla webview

```bash
cat src-tauri/capabilities/default.json
```

L'elenco è chiuso e contiene soltanto `core:default`, `dialog:allow-open`,
`notification:default`, `updater:default` e `process:allow-restart`. Nessun
permesso `http`, `shell` o `fs` generico: il frontend non ha il modo tecnico di
emettere una richiesta di rete o di leggere un file arbitrario.

### V6 — Nessun invio dal backend Python

```bash
grep -rnE 'requests\.|httpx\.|urllib|aiohttp|socket\.' engine/backend/
```

Esito: le sole occorrenze sono gli `import urllib` e le tre righe di
`_ollama_request` in `engine/backend/app/engines.py`, che compone l'URL da
`OLLAMA_URL` — fissato a `http://127.0.0.1:11434` da
`OLLAMA_URL` in `engine/backend/app/config.py`. Nessun client HTTP generico, nessun socket
aperto a mano.

Il comando non copre le richieste che le librerie fanno per conto proprio:
`huggingface_hub` per F10 e PaddleOCR per F11. Quei due flussi sono stati
individuati leggendo le chiamate che li innescano, non con un grep sugli URL, e
sono gli unici due di quel tipo.

### V7 — Nessun account, nessuna chiave API

```bash
grep -rniE 'api[_-]?key|bearer |oauth|client_secret|access_token' src/ src-tauri/src/ engine/backend/
```

Esito: le sole occorrenze riguardano il token locale del motore
(`x-local-token`), generato a ogni avvio e mai scritto su disco.

---

## 4. Cosa resta sul disco dopo la disinstallazione

Disinstallare l'app rimuove **solo l'applicazione**. Restano, per scelta
esplicita, perché contengono i risultati dell'utente e decine di GB scaricati:

| Cosa resta | macOS | Windows |
| --- | --- | --- |
| Database, risultati, log, ambiente e modelli dei motori (D1–D10) | `~/Library/Application Support/it.local.localaidesk2` | `%APPDATA%\it.local.localaidesk2` |
| Modelli Ollama (D11) | `~/.ollama/models` | `%USERPROFILE%\.ollama\models` |

La cancellazione va fatta a mano, ad app chiusa. La procedura è in
[INSTALL.md](INSTALL.md#7-disinstallare).

Nulla resta fuori da questi due percorsi: non ci sono voci di registro con dati
dell'utente, non ci sono file in `~/Library/Preferences` oltre a quelli che la
webview crea per la finestra, e le cache di terze parti sono state dirottate
dentro la cartella dell'app (il blocco delle cache di terze parti in `engine/backend/app/config.py`).

---

## 5. Limiti di questo audit

- È un audit **statico** del codice sorgente alla data indicata. Non è
  accompagnato da una cattura di traffico su un dispositivo pulito per l'intero
  ciclo di vita dell'app.
- Copre il codice del progetto e la configurazione. **Non** copre il
  comportamento interno delle ~290 dipendenze installate: F11 esiste proprio
  perché una di esse scarica per conto proprio, e un audit statico del progetto
  non può escludere che un'altra lo faccia.
- **Nomi di file e percorsi possono comparire nei log del motore** (D4, D6): il
  log degli accessi è disattivato, ma il testo di un errore può nominare il file
  che l'ha causato, e i percorsi dell'installazione contengono il nome
  dell'account. Non è telemetria — quei file non lasciano il dispositivo — ma è un
  dato personale scritto su disco, e chi allega un log a una segnalazione pubblica
  lo condivide. Vedi [../SUPPORT.md](../SUPPORT.md).
- Il controllo dell'assenza di telemetria è per **nome**: cerca gli host, gli SDK
  noti e i modi in cui una richiesta può partire. Non dimostra l'assenza di un
  canale deliberatamente offuscato; dimostra che non ce n'è uno ordinario.

---

## Documenti collegati

- [../PRIVACY.md](../PRIVACY.md) — informativa
- [THREAT_MODEL.md](THREAT_MODEL.md) — asset, attori, rischi accettati
- [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) — origini e licenze
