# Modello di minaccia

Versione dell'applicazione: **1.0.0**. Revisione del documento: **9 agosto 2026**.

Ogni mitigazione rimanda al codice che la implementa, indicando file e simbolo —
funzione, costante o middleware. I riferimenti sono per simbolo e non per numero
di riga di proposito: un numero di riga smette di essere vero al commit
successivo, un simbolo si trova con un `grep` e resta verificabile.

Se una difesa non ha un riferimento, non esiste: sta nella sezione
[Rischi accettati](#rischi-accettati), che è la parte più importante del
documento.

---

## 1. Perimetro e assunzioni

**Dentro il perimetro**: l'applicazione desktop (frontend React, core Rust), il
backend locale FastAPI sulla porta 8787, il server dei modelli Ollama sulla porta
11434, gli script di bootstrap, la catena di release su GitHub Actions e il canale
di aggiornamento.

**Fuori dal perimetro**: il sistema operativo, il disco e la sua eventuale
cifratura, l'account utente, la rete locale, l'hardware.

**Assunzioni di fiducia dichiarate:**

1. **Il confine di sicurezza è l'account utente del sistema operativo.** L'app non
   tenta di difendere i documenti da un altro processo che gira con gli stessi
   privilegi dell'utente. Non c'è sandbox, non c'è cifratura applicativa dei
   risultati, non c'è separazione di privilegi fra frontend, core e motori.
2. **La cifratura del disco è responsabilità dell'utente.** L'app non cifra nulla:
   FileVault o BitLocker sono ciò che protegge i dati a riposo se il dispositivo
   viene perso.
3. **I motori Python sono codice fidato ma non isolato.** Girano con i privilegi
   dell'utente e leggono i file che l'utente decide di dargli, compresi file
   ostili. Un difetto di parsing in una delle circa 290 dipendenze installate
   diventa esecuzione di codice con i privilegi dell'utente.
4. **Il registro Ollama e Hugging Face sono fidati per i pesi.** L'app verifica il
   contenuto per digest dove il fornitore lo consente, non l'identità del modello.
5. **Nessun dato lascia il dispositivo per iniziativa dell'app.** Verificato in
   [PRIVACY_AUDIT.md](PRIVACY_AUDIT.md), non solo dichiarato.

---

## 2. Asset

| # | Asset | Dove sta | Perché conta |
| --- | --- | --- | --- |
| **A1** | Documenti sorgente dell'utente | Dove l'utente li tiene; l'app conserva soltanto il percorso | Sono il motivo per cui esiste un prodotto locale: possono essere contratti, cartelle cliniche, atti |
| **A2** | Copie di lavoro | `<dati app>/engine/work/jobs/<lavoro>/` | Contengono il documento intero per la durata del lavoro |
| **A3** | Risultati | `<dati app>/results/<job_id>/` | Testo estratto, trascrizioni, PDF tradotti, testo mascherato |
| **A4** | Database SQLite | `<dati app>/local-ai-desk.sqlite3` | Percorsi, nomi, hash del contenuto, cronologia, messaggi d'errore (schema in `src-tauri/src/database.rs`, funzione `migrate`) |
| **A5** | Log | `<dati app>/app.log`, `<dati app>/engine/runtime.log`, `ollama.log`, `install.log` | Righe di stato e di errore; percorsi e nomi dei file possono comparire in quelli del motore |
| **A6** | Token del motore | Solo in memoria e nell'ambiente del processo figlio (`src-tauri/src/engine_bridge.rs` → `engine_token`) | Chi lo possiede può far elaborare documenti dal motore locale o farsi adottare come motore |
| **A7** | Chiave privata dell'updater (Ed25519) | GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` più il backup offline | Chi la possiede può far installare qualunque codice su ogni installazione esistente |
| **A8** | Ambiente installato e pesi dei modelli | `<dati app>/engine/` e `~/.ollama/models` | Oltre 20 GB di codice eseguibile che l'app avvia a ogni sessione |

`<dati app>` è `~/Library/Application Support/it.local.localaidesk2` su macOS e
`%APPDATA%\it.local.localaidesk2` su Windows (identificatore del bundle in
`src-tauri/tauri.conf.json`).

---

## 3. Attori

| # | Attore | Capacità assunte |
| --- | --- | --- |
| **T1** | Utente legittimo | Controlla la macchina; può sbagliare, aprire un file ostile, cancellare dati |
| **T2** | Pagina web aperta nel browser dell'utente | Può emettere richieste HTTP verso `127.0.0.1`; il browser aggiunge sempre `Origin`; non può leggere il filesystem |
| **T3** | Altro processo dello stesso utente | Legge e scrive tutto ciò che l'utente legge e scrive, incluso l'ambiente dei processi dell'utente; può occupare una porta |
| **T4** | Processo sandboxed con solo entitlement di rete | Non vede il filesystem dell'utente; può aprire connessioni, incluso il loopback |
| **T5** | Attaccante sulla rete locale | Raggiunge le porte che la macchina espone all'esterno; può intercettare HTTP in chiaro |
| **T6** | Upstream compromesso (GitHub, PyPI, Astral, registro Ollama, Hugging Face) | Serve un artefatto manomesso a un URL legittimo |
| **T7** | Maintainer o GitHub Actions compromessi | Pubblica una release firmata con la chiave legittima |

---

## 4. Mitigazioni, per attore

### T2 — Pagina web nel browser

| Asset | Minaccia | Mitigazione |
| --- | --- | --- |
| A1, A2, A3 | La pagina invia un lavoro al motore locale con un percorso arbitrario e ne legge il risultato | Ogni richiesta che porta un header `Origin` è rifiutata con 403 dal middleware `require_local_caller` (`engine/backend/app/main.py`): nessuna richiesta da browser passa, né semplice né dopo preflight |
| A2, A3 | La pagina indovina un identificatore di lavoro e ne scarica il risultato | Stesso rifiuto per `Origin`, più il token: senza `x-local-token` valido la risposta è 401 (`require_local_caller`) |
| A6 | La pagina prova a farsi dare il token | Il token non è mai scritto su disco né esposto da un endpoint; il frontend non lo tocca, è il core Rust ad aggiungerlo come header (`src-tauri/src/engine_bridge.rs` → `engine_client`) |
| — | Le pagine di schema del backend rivelano le rotte | `FastAPI` è istanziato con `docs_url`, `redoc_url` e `openapi_url` a `None` (`engine/backend/app/main.py`) |
| A8 | La pagina cancella i pesi tramite l'API di Ollama sulla 11434 | Nessuna. → [R1](#r1--ollama-sulla-11434-non-richiede-autenticazione) |
| — | La UI dell'app viene usata come ponte verso la rete | La CSP consente `connect-src` solo verso `self` e l'IPC (chiave `app.security.csp` in `src-tauri/tauri.conf.json`); la capability elenca un insieme chiuso di permessi, nessuno dei quali apre shell, HTTP o filesystem generico (`src-tauri/capabilities/default.json`) |

### T3 — Altro processo dello stesso utente

| Asset | Minaccia | Mitigazione |
| --- | --- | --- |
| A1, A3, A4, A5 | Legge documenti, risultati, database e log | Nessuna. → [R2](#r2--il-confine-è-lutente-del-sistema-operativo-non-lapp) |
| A6 | Recupera il token leggendo l'ambiente del processo del motore | Nessuna. → [R2](#r2--il-confine-è-lutente-del-sistema-operativo-non-lapp) |
| A1, A2 | Occupa la porta 8787 prima dell'app e riceve gli upload | Un listener già presente viene adottato **solo** se accetta il token di questo avvio: `spawn_runtime_process` interroga `listener_speaks_our_token` e altrimenti rifiuta con `FOREIGN_LISTENER_MESSAGE` (`src-tauri/src/commands.rs`, `src-tauri/src/engine_bridge.rs`). La richiesta di prova è costruita senza header `Origin`, perché il backend lo rifiuterebbe |
| A6 | Impone il token predisponendo l'ambiente dell'app | L'adozione di `LOCAL_AI_ENGINE_TOKEN` dall'ambiente è vincolata a `cfg!(debug_assertions)`: in una build di release il token è sempre generato (`src-tauri/src/engine_bridge.rs` → `engine_token`) |
| A2 | Legge le copie di lavoro dopo la fine del lavoro | Le copie vivono in una directory temporanea per lavoro, rimossa alla conclusione, all'errore e all'annullamento (`engine/backend/app/main.py`); ciò che sopravvive a un crash viene spazzato al successivo avvio del motore (`sweep_orphan_jobs`) |
| A3 | Un risultato parziale viene creduto definitivo | La scrittura passa da un file `.<nome>.partial` promosso per rename solo a scrittura completata (`src-tauri/src/engine_bridge.rs` → `partial_name`); i parziali rimasti da una sessione precedente vengono rimossi all'avvio (`src-tauri/src/lib.rs` → `sweep_partial_results`) |
| A8 | Interferisce con un'installazione a metà | Un pid file rimasto da una sessione precedente fa terminare l'installazione interrotta e invalida il venv incompleto (`src-tauri/src/commands.rs` → `try_start_installed_runtime`, `src-tauri/src/process.rs` → `reap_orphan`) |
| A4 | Due istanze corrompono il database | Il plugin single-instance è registrato prima di tutto, così un secondo avvio non raggiunge mai `setup` (`src-tauri/src/lib.rs`); le connessioni abilitano `foreign_keys` e un `busy_timeout` (`src-tauri/src/database.rs` → `connect`) |

### T4 — Processo sandboxed con solo entitlement di rete

| Asset | Minaccia | Mitigazione |
| --- | --- | --- |
| A1, A2, A3 | Non vede il filesystem, ma raggiunge il loopback e prova a usare il motore per leggere un file che a lui è precluso | Senza token la risposta è 401 (`require_local_caller`); il token non è ricavabile dal filesystem perché non è mai scritto (`engine_token`), e nella sandbox l'ambiente degli altri processi non è leggibile |
| A6 | Forza il token per tentativi | 128 caratteri esadecimali generati da quattro UUID v4 a ogni avvio (`engine_token`); il confronto è a tempo costante con `hmac.compare_digest` (`require_local_caller`) |
| A8 | Usa il server dei modelli sulla 11434 per far girare inferenza a spese dell'utente | Nessuna. → [R1](#r1--ollama-sulla-11434-non-richiede-autenticazione) |

### T5 — Attaccante sulla rete locale

| Asset | Minaccia | Mitigazione |
| --- | --- | --- |
| A1, A2 | Raggiunge il motore da un'altra macchina | Il backend è avviato vincolato a `127.0.0.1` (`src-tauri/src/commands.rs` → `spawn_runtime_process`) |
| A8 | Raggiunge il server dei modelli da un'altra macchina | Ollama viene avviato con `OLLAMA_HOST=127.0.0.1:11434`, e la variabile dell'ambiente non viene mai ereditata (`src-tauri/src/commands.rs` → `spawn_ollama_process`). Se il server era già in esecuzione, l'app non lo governa: rileva se ascolta su tutte le interfacce e lo dichiara nella UI (`listener_is_network_exposed`, campo `models_server_exposed` di `get_runtime_status`) |
| A7 | Manomette il pacchetto di aggiornamento in transito | Manifest e pacchetti sono su HTTPS e la firma Ed25519 è verificata dall'app contro la chiave pubblica compilata nel binario (`plugins.updater` in `src-tauri/tauri.conf.json`) |
| A1 | Intercetta il traffico fra core e motore | Il traffico non lascia l'interfaccia di loopback: non transita su nessuna rete |

### T6 — Upstream compromesso

| Asset | Minaccia | Mitigazione |
| --- | --- | --- |
| A8 | Un release asset di GitHub viene sostituito (uv, binario Ollama, sorgente del Privacy Filter) | SHA-256 fissati in testa allo script e verificati con interruzione dell'installazione (`engine/scripts/bootstrap-macos.sh` → `verify_sha256`; `engine/scripts/bootstrap-windows.ps1` → `Assert-Sha256`) |
| A8 | Un wheel su PyPI viene sostituito | Installazione con `--require-hashes` dai lock per piattaforma (`engine/scripts/bootstrap-macos.sh`, passi `[2/6]` e `[3/6]`); gli stessi lock passano da `pip-audit` in CI (job `python-audit` in `.github/workflows/security.yml`) |
| A8 | Un tag Ollama viene ripuntato su pesi diversi | **Parziale**: manifest e layer di Ollama sono content-addressed e verificati dal client, ma i tag `glm-ocr` e `translategemma:12b` non sono fissati per digest (`engine/scripts/bootstrap-macos.sh` → `ensure_model`). → [R5](#r5--i-pesi-dei-modelli-non-sono-fissati-per-revisione) |
| A8 | Una revisione Hugging Face viene sostituita | Nessuna: `snapshot_download` è chiamato senza `revision` (`engine/backend/app/engines.py` → `_run_model_download`). → [R5](#r5--i-pesi-dei-modelli-non-sono-fissati-per-revisione) |
| A8 | Un pack scaricato a metà viene creduto pronto | Il download va in una cartella di staging e viene pubblicato con un solo rename, dopo aver verificato la presenza dei pesi (`_run_model_download`) |
| A8 | Una dipendenza vulnerabile entra senza che nessuno se ne accorga | `npm audit`, `cargo audit` e `pip-audit` su ogni push e ogni settimana (`.github/workflows/security.yml`); Dependabot su quattro ecosistemi (`.github/dependabot.yml`) |

### T7 — Maintainer o GitHub Actions compromessi

| Asset | Minaccia | Mitigazione |
| --- | --- | --- |
| A7, tutte le installazioni | Una release firmata con la chiave legittima installa codice arbitrario su ogni dispositivo | Nessuna difesa tecnica: la fiducia nella chiave è totale per costruzione. Contenimento: `main` protetto da status check bloccanti con `strict: true`, senza force push né cancellazioni; tutte le action sono fissate per SHA; i secret di firma sono usati solo sui tag (passo «Verify updater signing secrets» in `.github/workflows/desktop.yml`). Custodia e rotazione in [RELEASING.md](RELEASING.md#custodia-della-chiave-di-firma) |
| A7 | La chiave viene ruotata o persa e la release non è installabile | La CI verifica ogni firma con `minisign` contro la chiave pubblica estratta dalla configurazione, prima di pubblicare (passo «Verify updater signatures against the shipped public key» in `.github/workflows/desktop.yml`) |
| Tutte le installazioni | Un tag che non corrisponde alla versione compilata fa vedere a ogni client un aggiornamento perpetuo | Controllo di coerenza bloccante fra tag, `package.json`, `tauri.conf.json` e `Cargo.toml` prima della pubblicazione (passo «Verify version coherence with the tag» in `.github/workflows/desktop.yml`) |
| Il sorgente | Codice non rivisto entra in `main` | CodeQL settimanale in suite `extended` su JavaScript/TypeScript, Python e workflow, fra i required check. → [R6](#r6--codeql-non-analizza-il-rust) |
| Gli artefatti | Nessuno può dimostrare che un installer venga da questa CI | Nessuna. → [R7](#r7--nessuna-firma-del-codice-e-nessuna-attestazione-di-provenienza) |

### T1 — Utente legittimo

| Asset | Minaccia | Mitigazione |
| --- | --- | --- |
| A1 | Elabora un documento ostile e un parser esegue codice | Nessun isolamento. → [R8](#r8--i-parser-non-sono-isolati) |
| A1 | Un archivio a espansione elevata riempie il disco | Archivi nidificati rifiutati; tetti su numero di voci, dimensione espansa e rapporto di compressione, con messaggio che dice cosa fare (`engine/backend/app/engines.py` → `_inspect_archive`; costanti in `engine/backend/app/config.py`) |
| A1 | Un PDF protetto da password produce un traceback | Il PDF viene ispezionato prima dell'instradamento e il caso è dichiarato all'utente (`engine/backend/app/engines.py` → `_inspect_pdf`) |
| A1 | Un lavoro resta appeso per sempre su un input patologico | Tetto di durata per lavoro con un margine per la chiusura cooperativa, poi risposta comunque (`engine/backend/app/main.py`, costanti `JOB_TIMEOUT_SECONDS` e `JOB_TIMEOUT_GRACE_SECONDS`) |
| A1, A3 | Un percorso importato punta fuori da dove dovrebbe | Ogni percorso importato viene canonicalizzato e deve riferirsi a un file reale (`src-tauri/src/commands.rs`); le operazioni sui file dell'app accettano solo percorsi dentro la cartella dati |
| A3 | L'export ZIP porta fuori file che non sono risultati | Ogni voce viene canonicalizzata e scartata se non è un file dentro `results/` (`src-tauri/src/commands.rs` → `create_results_zip`) |
| A3 | Un output vuoto viene creduto un risultato | Un output assente, vuoto o composto di soli spazi è un errore: nessun file viene scritto e il lavoro non diventa `completed` (`src-tauri/src/engine_bridge.rs`, controllo su `payload.output` prima di creare il file) |
| A1, A8 | Un force quit lascia motori e modelli accesi sul computer | Il motore si spegne da sé se il processo dell'app scompare (`engine/backend/app/main.py` → `_supervise_parent`); i processi girano in un process group isolato terminato con SIGTERM poi SIGKILL (`src-tauri/src/process.rs` → `isolate_process_group`, `stop_process_tree`); i pid vengono ricordati e gli orfani recuperati al riavvio confrontando il nome dell'eseguibile (`remember`, `reap_orphan`) |
| A4 | Un archivio scritto da una versione più recente viene aperto perdendo colonne | Lo schema è marcato con `PRAGMA user_version` e un archivio più recente di `SCHEMA_VERSION` viene rifiutato con un messaggio che dice cosa fare (`src-tauri/src/database.rs` → `initialize`) |
| A1 | L'app viene installata da un pacchetto manomesso | Solo il confronto SHA-256 con `SHA256SUMS.txt`, che non è firmato. → [R7](#r7--nessuna-firma-del-codice-e-nessuna-attestazione-di-provenienza); procedura in [INSTALL.md](INSTALL.md#2-verifica-il-file-prima-di-installarlo) |
| A3, A4 | L'utente non capisce quali dati esistano e dove | La cartella dati è mostrata in Impostazioni; l'inventario completo è in [PRIVACY_AUDIT.md](PRIVACY_AUDIT.md) |

---

## Rischi accettati

Noti, non mitigati e consapevolmente presenti nella 1.0.

### R1 — Ollama sulla 11434 non richiede autenticazione

Il server dei modelli che l'app avvia accetta solo connessioni locali
(`src-tauri/src/commands.rs` → `spawn_ollama_process`), ma la sua API non richiede
alcuna credenziale (`OLLAMA_URL` in `engine/backend/app/config.py`). Un altro
programma sul computer dell'utente può quindi usarne le risorse o cancellare i
pesi condivisi in `~/.ollama/models`. **Nessun documento dell'utente transita da
quel canale per iniziativa di un terzo**: le richieste di traduzione e OCR partono
dal motore, non da Ollama.

Se il server era già in esecuzione quando l'app parte, l'app non lo governa e non
lo spegne. Se in quel caso ascolta su tutte le interfacce, l'app lo rileva e lo
dichiara nella UI (`listener_is_network_exposed`), senza poterlo cambiare.

### R2 — Il confine è l'utente del sistema operativo, non l'app

Documenti, risultati, database e log stanno sul disco con i normali permessi
dell'utente. Il token del motore vive nell'ambiente di un processo figlio, che su
tutti i sistemi operativi supportati è leggibile da un altro processo dello stesso
utente. Un malware che gira come l'utente ha accesso a tutto: la cifratura del
disco protegge dal furto del dispositivo, non da questo.

Da questa assunzione dipendono le due difese parziali sulla porta del motore: il
rifiuto di un listener che non conosce il token e la generazione obbligatoria del
token nelle build di release alzano il costo dell'attacco, non lo eliminano, se
l'attaccante può già leggere la memoria e l'ambiente dei processi dell'utente.

Chi ha bisogno di una garanzia più forte deve isolare l'app a livello di sistema
operativo (utente dedicato, macchina virtuale). L'app non lo fa per conto suo.

### R3 — La porta del motore è fissa e non è prenotata all'avvio

Il backend usa sempre la 8787. L'app non tenta una porta alternativa: se qualcosa
la occupa, rifiuta di avviare i motori e lo dice, invece di adattarsi. È una scelta
— una porta variabile renderebbe più difficile capire cosa sta parlando con cosa —
ma significa che un programma qualunque, anche non ostile, può impedire l'uso dei
motori finché non viene chiuso.

### R4 — La superficie dell'API locale non è ridotta oltre il token

Il middleware protegge tutti i path sotto `/api/` e le pagine di schema sono
disattivate, quindi non resta nulla di interessante senza token. Non c'è però
alcun limite di frequenza, nessun tetto sul numero di richieste e nessun
registro dei tentativi falliti: un processo che conosca il token — cioè
[R2](#r2--il-confine-è-lutente-del-sistema-operativo-non-lapp) — non incontra
altri ostacoli.

### R5 — I pesi dei modelli non sono fissati per revisione

`snapshot_download` è chiamato senza `revision`
(`engine/backend/app/engines.py` → `_run_model_download`) e i modelli Ollama sono
richiesti per tag mutabile (`ensure_model` in `engine/scripts/bootstrap-macos.sh`,
`Confirm-Model` in `engine/scripts/bootstrap-windows.ps1`). Circa 13 GB di pesi
arrivano quindi con la garanzia che dà il fornitore — Ollama verifica manifest e
layer per digest, Hugging Face serve su HTTPS — ma non con una garanzia del
progetto che siano gli stessi pesi verificati in precedenza. Il codice scaricato da
GitHub e i wheel Python sono invece fissati e verificati (vedi T6).

### R6 — CodeQL non analizza il Rust

L'analisi statica configurata sul repository copre `actions`,
`javascript-typescript` e `python`, in suite `extended`, settimanale, fra i
required check. **Il core Rust non è analizzato da CodeQL**, che non supporta Rust
in configurazione predefinita.

Ciò che presidia il Rust è: `cargo clippy --all-targets -- -D warnings` e
`cargo test` bloccanti su runner macOS e Windows, `cargo audit` sul lockfile
(`.github/workflows/security.yml`), e un solo blocco `unsafe` in tutto il core,
nella chiamata a `kill` sul process group (`src-tauri/src/process.rs`).

Dove il README o le note di rilascio citano CodeQL, va citato con questa
qualificazione: «CodeQL su JavaScript/TypeScript, Python e workflow».

### R7 — Nessuna firma del codice e nessuna attestazione di provenienza

Gli installer non sono firmati con un certificato Apple Developer ID né
Authenticode: la firma macOS è ad hoc
(`bundle.macOS.signingIdentity` in `src-tauri/tauri.macos.conf.json`, e
`APPLE_SIGNING_IDENTITY: "-"` in `.github/workflows/desktop.yml`). Conseguenze
accettate:

- **macOS e Windows avvisano l'utente** e richiedono un'autorizzazione manuale. Un
  utente che si abitua a superare quell'avviso è un utente più esposto: l'attrito è
  documentato in [INSTALL.md](INSTALL.md), non minimizzato.
- **L'identità di chi pubblica non è verificata da terzi.** Il canale di fiducia è
  il repository GitHub e nulla più.
- **La firma ad hoc cambia a ogni build**, quindi macOS può trattare un
  aggiornamento come un'app diversa e ripetere le richieste di autorizzazione già
  concesse.
- **Nessuna attestazione di build provenance** è pubblicata: non c'è modo di
  dimostrare che un installer sia uscito da questa CI. Restano lo SHA-256 in
  `SHA256SUMS.txt`, **non firmato**, e l'SBOM SPDX.
- **La firma Ed25519 dell'updater è un'altra cosa**: protegge gli aggiornamenti, è
  verificata dall'app e non è visibile al sistema operativo.

Non c'è una data prevista per rimuovere questo rischio: sono spese ricorrenti che
il progetto non sostiene.

### R8 — I parser non sono isolati

I motori girano con i privilegi dell'utente, senza sandbox e senza limiti di CPU o
di memoria. Esistono un tetto di durata per lavoro, limiti di espansione sugli
archivi e un'ispezione preventiva dei PDF — non una sandbox: un difetto di memoria
in una libreria di parsing diventa esecuzione di codice come l'utente. Il tetto
sulla dimensione del file in ingresso è disattivato per default, per scelta
documentata (`MAX_FILE_BYTES` in `engine/backend/app/config.py`), perché il
prodotto promette video da diversi gigabyte.

**Non elaborare file provenienti da fonti non fidate.**

### R9 — Nessun downgrade garantito del database

Le migrazioni sono solo additive (`src-tauri/src/database.rs` → `ensure_column`) e
lo schema è marcato con `PRAGMA user_version`, quindi una versione precedente
riconosce un archivio scritto da una più recente e rifiuta di aprirlo invece di
perdere colonne in silenzio. Non esiste però un percorso di downgrade: se
`SCHEMA_VERSION` è stato alzato, tornare a una versione precedente dell'app
significa non poter più aprire la libreria fino a quando non si aggiorna di nuovo.
La procedura di rollback in
[RELEASING.md](RELEASING.md#rollback-di-una-release-difettosa) non dipende dal
downgrade del database proprio per questo.

### R10 — Un solo maintainer

Una sola persona ha accesso al repository, ai secret di firma e al backup della
chiave. Non c'è una seconda persona che possa pubblicare una correzione urgente,
revocare un accesso o rispondere a una segnalazione di sicurezza in sua assenza. È
un rischio di continuità, non di riservatezza, ed è dichiarato in
[../SUPPORT.md](../SUPPORT.md) come tempo di risposta best-effort.

---

## Documenti collegati

- [PRIVACY_AUDIT.md](PRIVACY_AUDIT.md) — flussi di rete, dati a riposo, verifica dell'assenza di telemetria
- [../SECURITY.md](../SECURITY.md) — proprietà applicate e canale di segnalazione
- [../PRIVACY.md](../PRIVACY.md) — informativa
- [ARCHITECTURE.md](ARCHITECTURE.md) — struttura del sistema
- [RELEASING.md](RELEASING.md) — catena di release e custodia delle chiavi
- [INSTALL.md](INSTALL.md) — conseguenze pratiche di R7
