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
| [engine/scripts/](engine/scripts/) | Bootstrap macOS/Windows con checksum pinnati |

## Comandi utili

```bash
npm run check                  # TypeScript senza emettere
npm run build                  # tsc + vite build
npm run test:release           # test dello script di release

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
  `--surface-*`, la chrome da `--sidebar-*`. Un letterale chiaro resta chiaro nel
  tema scuro mentre il testo sopra schiarisce: è così che i pannelli erano
  diventati illeggibili.
- **Non far scendere il testo informativo sotto 11px** (`--text-xs`).
- **Non rendere `get_runtime_status` capace di effetti collaterali**: è in
  polling ogni 4 secondi, quindi ogni spawn diventerebbe un ciclo infinito.
- **Non usare `File::create` sui log**: append, altrimenti il crash che si sta
  indagando cancella la propria traccia a ogni riavvio.
- **Non uccidere i processi figli con `child.kill()`**: usa
  `process::stop_process_tree`, altrimenti i worker di traduzione sopravvivono
  alla chiusura della finestra.
- **Non avviare il motore senza `LOCAL_AI_APP_PID`**: senza quella variabile il
  supervisore è disattivato e un crash dell'app lascia motori e modelli accesi
  sul computer dell'utente. Serve anche `LOCAL_AI_ENGINE_TOKEN`, altrimenti il
  backend rifiuta ogni richiesta con 503.
- **Non archiviare le sorgenti del Drop rapido.** Restano fuori dal database per
  scelta: è il motivo per cui il retry funziona solo su fonti in Libreria.
- **Non aggiungere client HTTP verso i motori senza token**: usa
  `engine_bridge::engine_client`.
- **Non usare `Result::and`/`or` con un `.await` come argomento**: vengono
  valutati sempre, anche sul ramo di errore. È così che un PDF troncato veniva
  promosso a risultato definitivo dopo un annullamento.
- **Non derivare elenchi di id da `list_jobs`**: è una finestra limitata a
  `JOB_HISTORY_LIMIT`. Costruiscili da ciò che hai appena inserito.

## Stato corrente

Beta pubblica **0.5.0-beta.1**. Motori e coda funzionanti su macOS Apple Silicon
e Windows x64; aggiornamenti firmati Ed25519. Mancano firma Developer ID/
notarizzazione Apple e Authenticode Windows. Interfaccia solo in italiano
(localizzazioni in roadmap F5). Pausa/ripresa, notifiche native, preview/editor e
workflow visuali non sono implementati e sono dichiarati tali.
