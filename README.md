# Local AI Desk 2

Local AI Desk 2 è il nuovo workspace desktop, local-first e open source per
documenti, PDF, immagini, audio e video. È progettato per macOS Apple Silicon,
con dati persistenti sul dispositivo e motori installabili a moduli.

Questa cartella è intenzionalmente separata da `Local-AI-Desk`: la versione 1
rimane installata e funzionante mentre le funzioni vengono migrate e verificate
una alla volta.

![Home della Foundation 2.0](docs/screenshots/foundation-home.png)

## Stato della Foundation

- shell desktop nativa con Tauri 2 e React 19;
- libreria SQLite persistente nel contenitore dell'app;
- importazione multipla tramite selettore nativo macOS;
- nessun limite artificiale alla dimensione dei file;
- hash BLAKE3 in streaming per deduplicare senza caricare file enormi in RAM;
- coda persistente con lavori in bozza;
- rilevamento dei motori della v1 tramite un endpoint fisso su `127.0.0.1`;
- CSP restrittiva e un solo permesso frontend: apertura del selettore file;
- interfaccia accessibile, responsive, chiara anche in dark mode.

Studio, workflow, esecuzione dei job, progresso e gestione dei model pack sono
tracciati nella [roadmap](docs/ROADMAP.md) e non vengono presentati come già
completi nell'interfaccia.

## Sviluppo

Prerequisiti: Node.js 20+, Rust stable e Xcode Command Line Tools.

```bash
npm install
npm run tauri dev
```

Controlli prima di una build:

```bash
npm run build
cd src-tauri
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

Build dell'app macOS:

```bash
npm run tauri build -- --bundles app
```

## Documentazione

- [Visione di prodotto](docs/PRODUCT.md)
- [Architettura](docs/ARCHITECTURE.md)
- [Ricerca tecnica e scelte](docs/RESEARCH.md)
- [Roadmap](docs/ROADMAP.md)
- [Licenze e distribuzione](docs/LICENSING.md)
- [Sicurezza](SECURITY.md)

## Dati locali

Il percorso effettivo viene mostrato in **Impostazioni**. Durante lo sviluppo,
Tauri usa il contenitore associato all'identificatore
`it.local.localaidesk2`. Il database non contiene copie dei file: conserva
metadati, hash, job e impostazioni. I file originali restano dove si trovano.

## Licenza

La licenza pubblica definitiva non è ancora applicata: deve essere scelta
insieme alla matrice delle licenze dei modelli e dei motori distribuiti. La
proposta e i vincoli sono documentati in [docs/LICENSING.md](docs/LICENSING.md).
