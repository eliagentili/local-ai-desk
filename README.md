# Local AI Desk 2

Local AI Desk 2 è il nuovo workspace desktop, local-first e open source per
documenti, PDF, immagini, audio e video. È progettato per macOS Apple Silicon e
Windows x64, con dati persistenti sul dispositivo e motori installabili a
moduli.

Questa cartella è intenzionalmente separata da `Local-AI-Desk`: la versione 1
rimane installata e funzionante mentre le funzioni vengono migrate e verificate
una alla volta.

![Home di Local AI Desk 2](docs/screenshots/f1-installed-window.png)

![Coda con risultato completato](docs/screenshots/f1-activity-completed.png)

## Stato della versione 0.3

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

## Dati locali

Il percorso effettivo viene mostrato in **Impostazioni**. Durante lo sviluppo,
Tauri usa il contenitore associato all'identificatore
`it.local.localaidesk2`. Il database non contiene copie dei file: conserva
metadati, hash, job e impostazioni. I file originali restano dove si trovano.

## Licenza

La licenza pubblica definitiva non è ancora applicata: deve essere scelta
insieme alla matrice delle licenze dei modelli e dei motori distribuiti. La
proposta e i vincoli sono documentati in [docs/LICENSING.md](docs/LICENSING.md).
