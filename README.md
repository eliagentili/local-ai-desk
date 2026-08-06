# Local AI Desk 2

[![Desktop CI](https://github.com/eliagentili/local-ai-desk/actions/workflows/desktop.yml/badge.svg)](https://github.com/eliagentili/local-ai-desk/actions/workflows/desktop.yml)
[![Security](https://github.com/eliagentili/local-ai-desk/actions/workflows/security.yml/badge.svg)](https://github.com/eliagentili/local-ai-desk/actions/workflows/security.yml)
[![License: AGPL v3+](https://img.shields.io/badge/license-AGPL--3.0--or--later-0a1f29.svg)](LICENSE)

Local AI Desk 2 è il nuovo workspace desktop, local-first e open source per
documenti, PDF, immagini, audio e video. È progettato per macOS Apple Silicon e
Windows x64, con dati persistenti sul dispositivo e motori installabili a
moduli.

La prima release pubblica è una **beta**: il nucleo locale è utilizzabile, ma gli
installer non sono ancora firmati con certificati Apple e Microsoft. Leggi i
[limiti della beta](#download-e-limiti-della-beta) prima di installarla.

![Home di Local AI Desk 2](docs/screenshots/f1-installed-window.png)

![Coda con risultato completato](docs/screenshots/f1-activity-completed.png)

## Stato della versione 0.3 beta

- shell desktop nativa con Tauri 2 e React 19;
- libreria SQLite persistente nel contenitore dell'app;
- importazione multipla tramite selettore nativo macOS/Windows;
- nessun limite artificiale alla dimensione dei file;
- hash BLAKE3 in streaming per deduplicare senza caricare file enormi in RAM;
- Studio guidato per Auto, traduzione PDF, OCR, trascrizione e Privacy Shield;
- coda persistente con scheduler globale fino a tre lavori concorrenti;
- upload in streaming senza limite artificiale a 500 MB;
- progresso reale quando esposto dal motore e fase indeterminata negli altri casi;
- annullamento per lavoro o per l’intero batch;
- risultati salvati atomicamente e ZIP finale con manifest JSON;
- adapter locale verso i sette motori già installati, su `127.0.0.1`;
- bootstrap dei motori in background, senza finestre Terminal o PowerShell;
- codice, modelli e cache separati per funzionare anche sotto `Program Files`;
- rami nativi per Finder ed Esplora file, process group e annullamento;
- pacchetti macOS `.app`/`.dmg` e Windows `.exe`/`.msi` nella CI;
- CSP restrittiva e un solo permesso frontend: apertura del selettore file;
- interfaccia accessibile, responsive, chiara anche in dark mode.

Pausa/ripresa, retry, notifiche, preview/editor, workflow e gestione autonoma dei
model pack restano tracciati nella [roadmap](docs/ROADMAP.md) e non vengono
presentati come già completi nell’interfaccia.

## Download e limiti della beta

Scarica l'ultima versione dalla pagina [GitHub Releases](https://github.com/eliagentili/local-ai-desk/releases/latest).
Sono supportati macOS 14+ su Apple Silicon e Windows 10/11 x64.

Ogni release contiene installer, SBOM SPDX e `SHA256SUMS.txt`. Verifica il
checksum prima di aprire il file. In questa beta:

- macOS usa una firma ad-hoc e può richiedere l'autorizzazione in **Privacy e sicurezza**;
- Windows può mostrare SmartScreen perché l'installer non ha ancora una firma Authenticode;
- il primo setup dei motori può superare 20 GB e richiede una connessione Internet;
- i pesi non sono inclusi negli installer e conservano le licenze dei produttori;
- prima di usare file non fidati leggi [SECURITY.md](SECURITY.md).

## Sviluppo

Prerequisiti comuni: Node.js 20+ e Rust stable. Su macOS servono Xcode Command
Line Tools; su Windows servono Microsoft C++ Build Tools e WebView2.

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

Build macOS:

```bash
npm run tauri build -- --bundles app,dmg
```

Build Windows (da Windows):

```powershell
npm ci
npm run tauri build -- --bundles nsis,msi
```

Il workflow [desktop.yml](.github/workflows/desktop.yml) esegue test e build su
runner nativi e pubblica come artifact entrambe le famiglie di installer. Non è
necessario né consigliato tentare di produrre un MSI da macOS.

## Runtime dei motori

Il codice Python dei motori è incluso nel bundle. Al primo avvio, **Motori →
Installa motori** crea l'ambiente nel profilo dell'utente e scarica solo da
origini ufficiali i componenti e modelli necessari. È un'operazione una tantum,
può superare 20 GB e continua in background senza aprire un terminale.

- macOS: `~/Library/Application Support/it.local.localaidesk2/engine`
- Windows: `%APPDATA%\it.local.localaidesk2\engine`

L'app prova ad avviare automaticamente backend e Ollama; alla chiusura termina
solo i processi che ha avviato lei. Un runtime già attivo sul loopback viene
riutilizzato senza duplicarlo.

## Documentazione

- [Visione di prodotto](docs/PRODUCT.md)
- [Architettura](docs/ARCHITECTURE.md)
- [Ricerca tecnica e scelte](docs/RESEARCH.md)
- [Roadmap](docs/ROADMAP.md)
- [Licenze e distribuzione](docs/LICENSING.md)
- [Sicurezza](SECURITY.md)
- [Privacy](PRIVACY.md)
- [Avvisi di terze parti](THIRD_PARTY_NOTICES.md)
- [Come contribuire](CONTRIBUTING.md)
- [Checklist di release](docs/RELEASE_CHECKLIST.md)

## Dati locali

Il percorso effettivo viene mostrato in **Impostazioni**. Durante lo sviluppo,
Tauri usa il contenitore associato all'identificatore
`it.local.localaidesk2`. Il database non contiene copie dei file: conserva
metadati, hash, job e impostazioni. I file originali restano dove si trovano.

## Licenza

Il codice di Local AI Desk è distribuito con licenza
[AGPL-3.0-or-later](LICENSE). Motori, modelli e dipendenze conservano le proprie
condizioni, riepilogate in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
