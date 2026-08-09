# CLAUDE.md — Local AI Desk 2

## Cosa fa

App desktop (macOS + Windows) che porta il file dell'utente al risultato senza
mai uscire dal dispositivo: estrazione testo/Markdown da documenti, traduzione
PDF con layout, OCR, trascrizione audio/video e mascheramento di dati personali.
La UI espone **obiettivi** ("traduci", "trascrivi"), non motori: un router locale
sceglie il motore adatto e mostra la decisione. Nessun account, nessun cloud,
nessun token AI.

## Come si avvia in locale

```bash
npm install
npm run tauri dev
```

Servono Node.js 20+, Rust stable, Xcode Command Line Tools (macOS) oppure
Microsoft C++ Build Tools + WebView2 (Windows).

I motori Python **non** partono con `tauri dev`: si installano una sola volta
dall'app, in **Modelli → Installa motori** (oltre 20 GB, richiede Internet).

## Architettura in 3 righe

React 19 parla solo con comandi Tauri tipizzati; il core Rust possiede database,
coda, ciclo di vita dei processi e confine di sicurezza; i motori Python girano
dietro FastAPI su `127.0.0.1:8787`, raggiungibili unicamente con un token
generato a ogni avvio. Dettagli in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## File chiave

| Percorso | Ruolo |
| --- | --- |
| [src/App.tsx](src/App.tsx) | Orchestratore UI: stato globale, polling, notifiche, scorciatoie |
| [src/components/](src/components/) | Una vista per sezione + `ErrorBoundary` |
| [src/App.css](src/App.css) | Design system a token; il tema scuro rimappa **solo** i token |
| [src/lib/errors.ts](src/lib/errors.ts) | Traduce gli errori grezzi di OS/Rust in messaggi azionabili |
| [src-tauri/src/commands.rs](src-tauri/src/commands.rs) | Tutti i comandi Tauri, validazione, export, runtime |
| [src-tauri/src/engine_bridge.rs](src-tauri/src/engine_bridge.rs) | Esecuzione job: upload streaming, progresso, cancellazione, watchdog |
| [src-tauri/src/database.rs](src-tauri/src/database.rs) | Schema SQLite, migrazioni additive, stati terminali |
| [src-tauri/src/process.rs](src-tauri/src/process.rs) | Ciclo di vita dei process group e recupero degli orfani |
| [engine/backend/app/main.py](engine/backend/app/main.py) | API locale, middleware di autenticazione, pulizia dei temporanei |
| [engine/backend/app/engines.py](engine/backend/app/engines.py) | Implementazione e routing dei motori |
| [engine/scripts/](engine/scripts/) | Bootstrap macOS/Windows con checksum pinnati; `engine_worker.py` esegue i motori non interrompibili in un processo figlio |
| [src/lib/strings.ts](src/lib/strings.ts) | Stringhe UI selezionate da dati e template con interpolazioni |
| [scripts/collect-licenses.mjs](scripts/collect-licenses.mjs) | Genera `THIRD_PARTY_LICENSES.md` dai lock: non si scrive a mano |
| [scripts/check-contrast.mjs](scripts/check-contrast.mjs) | Cancello di contrasto sui token di `App.css` nei due temi |

## Comandi utili

```bash
npm run check                  # TypeScript senza emettere
npm run build                  # tsc + vite build
npm run lint                   # stylelint: colori letterali e pavimento 11px
npm test                       # test del frontend (vitest)
npm run test:contrast          # contrasto dei token nei due temi
npm run test:licenses          # inventario licenze contro i lock
npm run test:release           # test degli script di release

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

PYTHONPATH=engine python -m unittest discover -s engine/tests -v
```

## Convenzioni

- **Lingua**: identificatori e commenti in inglese, testo utente e commit in italiano.
- **Commit**: `tipo: descrizione` (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `security:`).
- **Branch**: `main` è il default; feature branch per ogni cambio non banale.
- **Documentazione viva**: se cambia il comportamento, `README.md` e il file
  `docs/` pertinente si aggiornano **nello stesso commit**.
- **Migrazioni DB**: solo additive, via `ensure_column` in `initialize()`. Mai
  rinominare o eliminare colonne: gli utenti aggiornano da versioni precedenti.
- **Stringhe utente**: ogni messaggio d'errore dice *cosa fare*, non solo cosa è
  rotto, e non nomina mai script o percorsi di shell.

## Cosa NON fare

- **Non presentare come pronto ciò che non lo è.** È il principio esplicito del
  prodotto: se una funzione è parziale, si dichiara — nel README, nella roadmap e
  nella UI. Vale anche per i risultati: un output vuoto è un errore, non un
  successo, e una degradazione del motore diventa un `warning` visibile.
- **Non scrivere colori letterali in `App.css`.** Le superfici passano da
  `--surface-*`, la chrome da `--sidebar-*`, gli stati da `--state-*`. Un
  letterale chiaro resta chiaro nel tema scuro mentre il testo sopra schiarisce:
  è così che i pannelli erano diventati illeggibili. Ora `npm run lint` lo vieta e
  `npm run test:contrast` misura ogni coppia nei due temi: un token di colore
  nuovo che nessuna coppia misura **fa fallire** il cancello, quindi aggiungilo
  allo script insieme al token.
- **Non misurare il contrasto di un bordo sul pannello nudo.** Il bordo di un
  avviso sta sopra la propria tinta di fondo: è per questo che `--state-error-border`
  e `--state-info-border` risultavano verdi a mano e rossi nel cancello.
- **Non far scendere il testo informativo sotto 11px** (`--text-xs`), nemmeno con
  un `em` relativo: `font-size: 0.95em` dentro un blocco da 11px sono 10,45px e
  stylelint lo blocca.
- **Non riportare `!important` in `App.css` per battere un selettore
  discendente.** La correzione è pareggiare la specificità (`small.job-error`),
  non aumentare il peso: un `!important` rende impossibile la rimappatura nel
  tema scuro.
- **Non rendere `get_runtime_status` capace di effetti collaterali**: è in
  polling ogni 4 secondi, quindi ogni spawn diventerebbe un ciclo infinito. Legge
  un file di log e interroga il volume, niente di più — e nemmeno un download di
  cortesia o una riparazione «una volta sola».
- **Non usare `File::create` sui log**: append, altrimenti il crash che si sta
  indagando cancella la propria traccia a ogni riavvio.
- **Non uccidere i processi figli con `child.kill()`**: usa
  `process::stop_process_tree`, altrimenti i worker di traduzione sopravvivono
  alla chiusura della finestra.
- **Non avviare il motore senza `LOCAL_AI_APP_PID`**: senza quella variabile il
  supervisore è disattivato e un crash dell'app lascia motori e modelli accesi
  sul computer dell'utente. Serve anche `LOCAL_AI_ENGINE_TOKEN`, altrimenti il
  backend rifiuta ogni richiesta con 503.
- **Non riportare i modelli Ollama dentro la cartella dell'app.** Stanno in
  `~/.ollama/models` di proposito: sono modelli ufficiali del registro da quasi
  10 GB e duplicarli e' tempo e disco buttati. Il processo invece resta nostro.
- **Non pubblicare un model pack fuori da una cartella di staging.** Scrivere
  direttamente nella destinazione fa comparire `config.json` dopo pochi secondi
  e `engine_status` dichiara il motore pronto mentre i pesi stanno ancora
  scaricando: i lavori finiscono su un modello che non c'e'.
- **Non archiviare le sorgenti del Drop rapido.** Restano fuori dal database per
  scelta: è il motivo per cui il retry funziona solo su fonti in Libreria.
- **Non aggiungere client HTTP verso i motori senza token**: usa
  `engine_bridge::engine_client`.
- **Non usare `Result::and`/`or` con un `.await` come argomento**: vengono
  valutati sempre, anche sul ramo di errore. È così che un PDF troncato veniva
  promosso a risultato definitivo dopo un annullamento.
- **Non derivare elenchi di id da `list_jobs`**: è una finestra limitata a
  `JOB_HISTORY_LIMIT`. Costruiscili da ciò che hai appena inserito.
- **Non scrivere un risultato prima di aver controllato che ci sia.** Output
  assente, vuoto o di soli spazi è `RunError::Message` in Rust e `RuntimeError`
  azionabile in Python, *prima* che esista una cartella o un file. La guardia
  finale in `_process_resolved_file`/`process_text` copre anche i motori futuri:
  non aggirarla con un ritorno anticipato.
- **Non eseguire un motore bloccante in un thread**: `markitdown`, `docling` e
  `privacy` girano in un processo figlio via `engine/scripts/engine_worker.py`
  perché un thread non si interrompe, e il semaforo per motore vale 1 su
  `privacy`. Un motore non interrompibile fa risultare libero uno slot occupato.
- **Non stampare su stdout dentro `engine_worker.py`**: fd 1 è il protocollo JSON
  a righe e dirottato su stderr di proposito. Una riga di progresso di una
  libreria corromperebbe il canale.
- **Non spostare il nome del documento dell'utente in una query string**: passa
  per l'header `X-Local-Filename`, perché il log di accesso registrerebbe l'URL.
- **Non riaprire `/docs`, `/redoc` o `/openapi.json`**: la superficie HTTP del
  motore è deliberatamente muta, e c'è un test del 404.
- **Non far leggere all'app un database più recente del proprio schema.**
  `PRAGMA user_version` è confrontato con `SCHEMA_VERSION` in `initialize` e un
  archivio più recente viene rifiutato con un messaggio azionabile: aprirlo
  significherebbe leggere a metà i dati di un utente che ha fatto un downgrade.
- **Non notificare a ogni file di un batch.** Le notifiche di sistema escono solo
  con la finestra non a fuoco, una alla prima fallita e una a batch concluso:
  altrimenti un batch da 500 file produce 500 banner.
- **Non aggiungere step di firma del codice ai workflow.** L'assenza di firma
  Apple e Authenticode è una decisione di prodotto (progetto gratuito, nessuna
  entrata): va documentata e resa facile, non aggirata. Per lo stesso motivo lo
  smoke test dei bundle non usa `spctl` né `signtool verify`: su un bundle ad-hoc
  sarebbero cancelli che possono solo essere rossi.
- **Non modificare `THIRD_PARTY_LICENSES.md` a mano**: è generato dai lock e la CI
  fallisce se il file committato è alla deriva. Si rigenera con
  `node scripts/collect-licenses.mjs`.
- **Non aggiornare la versione in un manifest solo.** Sono cinque punti:
  `package.json`, `package-lock.json` (due occorrenze), `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` (più `Cargo.lock`) e `bundle.windows.wix.version` a
  quattro numeri. Un `package-lock.json` rimasto indietro fa uscire l'SBOM con la
  versione sbagliata; un `wix.version` rimasto indietro fa rifiutare a Windows
  Installer l'aggiornamento in place, con la CI verde.

## Stato corrente

Prima release stabile **1.0.0**. Motori e coda funzionanti su macOS Apple Silicon
e Windows x64, con aggiornamenti firmati Ed25519 verificati prima
dell'installazione.

Chiuso nella 1.0: annullamento realmente interrompente su tutti e sei i motori,
nessun output vuoto dichiarato completato, benvenuto al primo avvio con spazio
richiesto e libero, fase e annullamento dell'installazione, cronologia degli
eventi per lavoro, notifiche di sistema, tetto di durata per lavoro, log
applicativo con panic hook, licenza e attribuzioni dentro il bundle, inventario
licenze generato dai lock, threat model e audit privacy pubblicati, contrasto
misurato da un cancello in CI.

**Non firmata, in modo permanente**: nessun certificato Apple né Authenticode,
perché il progetto è gratuito e non ha entrate con cui pagarli. L'attrito di
Gatekeeper e SmartScreen è documentato in [docs/INSTALL.md](docs/INSTALL.md).

Fuori dalla 1.0 e dichiarato tale in README, roadmap e note di rilascio:
pausa/ripresa, interfaccia in lingue diverse dall'italiano, anteprima/editor,
workflow visuali, tag e collezioni in Libreria, export DOCX/HTML/VTT, scheduler
adattivo (concorrenza fissa a tre), eliminazione dei risultati dall'app,
interruttore delle notifiche e altre preferenze in Impostazioni (la tabella
`settings` resta creata e non usata). Non verificato: sessioni con screen reader
reali, rollback dell'aggiornamento su macchine pulite, collaudo su disco pieno e
batch multi-GB su hardware.
