<p align="center">
  <img src="assets/local-ai-desk-icon.svg" width="104" alt="Icona di Local AI Desk">
</p>

<h1 align="center">Local AI Desk</h1>

<p align="center">
  <strong>Dal file al risultato. Senza lasciare il tuo computer.</strong><br>
  Un solo workspace open source per documenti, OCR, traduzione PDF,<br>
  trascrizione e protezione dei dati — su macOS e Windows.
</p>

<p align="center">
  <em>Local AI Desk is a private, on-device AI workspace for macOS and Windows.
  UI is currently Italian-only.</em>
</p>

<p align="center">
  <a href="https://github.com/eliagentili/local-ai-desk/releases/latest/download/Local-AI-Desk-macOS-Apple-Silicon.dmg"><img alt="Scarica per macOS" src="https://img.shields.io/badge/Scarica_per_macOS-Apple_Silicon-000000?style=for-the-badge&amp;logo=apple&amp;logoColor=white"></a>
  <a href="https://github.com/eliagentili/local-ai-desk/releases/latest/download/Local-AI-Desk-Windows-x64-Setup.exe"><img alt="Scarica per Windows" src="https://img.shields.io/badge/Scarica_per_Windows-x64-0078D4?style=for-the-badge&amp;logo=windows11&amp;logoColor=white"></a>
</p>

<p align="center">
  macOS 14+ · Windows 10/11 x64 · Gratis e open source · Nessun account
</p>

<p align="center">
  <a href="https://github.com/eliagentili/local-ai-desk/actions/workflows/desktop.yml?query=branch%3Amain+event%3Apush"><img alt="Desktop CI · main" src="https://github.com/eliagentili/local-ai-desk/actions/workflows/desktop.yml/badge.svg?branch=main&amp;event=push"></a>
  <a href="https://github.com/eliagentili/local-ai-desk/actions/workflows/security.yml"><img alt="Security" src="https://github.com/eliagentili/local-ai-desk/actions/workflows/security.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Licenza AGPL v3+" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-0a1f29.svg"></a>
</p>

![Panoramica di Local AI Desk su desktop](docs/screenshots/f1-installed-window.png)

## L'AI locale, finalmente semplice

Non dovresti conoscere modelli, dipendenze o comandi da terminale per lavorare
in privato. Scegli il risultato; Local AI Desk instrada il file verso il motore
locale adatto, mostra ogni fase e raccoglie gli output.

| Privato per progetto | Un flusso, molti motori | File grandi davvero |
| --- | --- | --- |
| Elaborazione sul dispositivo, nessun upload esterno e nessun token AI. | Auto, OCR, traduzione, trascrizione e Privacy Shield nella stessa interfaccia. | Streaming su disco, batch paralleli e nessun limite artificiale di 500 MB. |

## Trascina. Scegli. Ottieni.

1. **Trascina uno o più file.** Il Drop rapido non li aggiunge alla Libreria e
   non calcola hash inutili, anche se sono video da molti GB.
2. **Scegli il risultato.** Auto riconosce il percorso di estrazione; puoi anche
   richiedere esplicitamente traduzione, OCR, trascrizione o protezione dati.
3. **Segui il lavoro.** Progresso, fase, concorrenza e annullamento sono sempre
   visibili. Al termine apri il risultato o scarica l'intero batch in uno ZIP.

Le copie usate per il trasferimento locale vengono eliminate automaticamente al
termine, in caso di errore e dopo un annullamento. Gli originali non vengono mai
modificati. Rimangono soltanto i risultati che hai scelto di creare.

![Drop rapido nello Studio: il file è temporaneo e fuori dalla Libreria](docs/screenshots/f1-studio-quick-drop.png)

## Cinque obiettivi, una sola scrivania

| Obiettivo | Cosa ottieni | Motore locale |
| --- | --- | --- |
| **Estrai con Auto** | Markdown o testo da PDF, Office e molti altri formati | Router locale + MarkItDown / OCR |
| **Traduci PDF** | PDF tradotto o bilingue con layout, immagini e formule | PDFMathTranslate 2 + TranslateGemma |
| **Forza OCR** | Markdown, testo o JSON da scansioni e immagini | PaddleOCR / GLM-OCR |
| **Trascrivi** | Testo, sottotitoli SRT o JSON da audio e video | Faster Whisper |
| **Proteggi dati** | Testo mascherato o JSON con i rilevamenti, su file testuali (txt, md, csv, json, html, xml) | Regole italiane, più il modello Privacy Filter se scaricato |

Per mascherare un PDF o un DOCX estrai prima il testo con **Estrai**: «Proteggi
dati» lavora su file testuali. Per tradurre indica la lingua originale: l'app non
la deduce dal documento.

![Attività completata con risultato locale](docs/screenshots/f1-activity-completed.png)

## Drop rapido o Libreria? Decidi tu

Il **Drop rapido** è il percorso predefinito per un lavoro usa-e-getta: la
sorgente resta fuori dal database e sparisce dallo Studio quando il batch parte.

La **Libreria** è opzionale e serve quando vuoi ritrovare una fonte nel tempo.
Conserva solo percorso, metadati e hash BLAKE3: non crea una seconda copia del
file. Puoi rimuovere il riferimento in qualsiasi momento senza cancellare
l'originale o i risultati.

## Requisiti

| Voce | Requisito |
| --- | --- |
| Sistema operativo | macOS 14 o successivo su Apple Silicon (M1 o superiore); Windows 10 22H2 o Windows 11, x64 |
| Spazio libero per l'installazione dei motori | **almeno 35 GB liberi**: l'app li verifica e rifiuta di iniziare sotto soglia, invece di riempirti il disco a metà download |
| Spazio effettivamente occupato | oltre 20 GB dopo il primo setup, di cui quasi 10 GB di modelli Ollama in `~/.ollama/models`; 2,6 GB in più se scarichi il modello del Privacy Shield |
| Connessione | necessaria una sola volta, per il primo setup dei motori e per gli aggiornamenti. L'elaborazione dei file è sempre offline |
| Installer | pochi MB: modelli e dipendenze non sono dentro l'installer, arrivano al primo setup |
| Memoria | i modelli che l'app carica sono TranslateGemma 12B (traduzione), GLM-OCR (OCR), Faster Whisper `small` (trascrizione), Granite Docling (documenti complessi) e, se scaricato, il checkpoint Privacy Filter da 2,6 GB. **Non abbiamo misurato il picco di RAM su un campione di macchine**, quindi non pubblichiamo una soglia: un modello da 12 miliardi di parametri quantizzato dal registro Ollama chiede diversi GB di memoria durante la traduzione |
| Concorrenza | fino a tre lavori insieme, con un limite per motore. Il numero è fisso e non si adatta alla memoria disponibile: se la macchina ha poca RAM conviene avviare un file per volta |
| Processore | nessuna GPU richiesta. Su Apple Silicon i motori usano l'accelerazione disponibile nelle librerie che installano; su Windows girano su CPU |

Il primo setup si avvia dall'app, da **Modelli → Installa motori**, e mostra la
fase corrente; si può annullare.

## Installazione

- [macOS 14+ Apple Silicon — DMG](https://github.com/eliagentili/local-ai-desk/releases/latest/download/Local-AI-Desk-macOS-Apple-Silicon.dmg)
- [Windows 10/11 x64 — installer EXE](https://github.com/eliagentili/local-ai-desk/releases/latest/download/Local-AI-Desk-Windows-x64-Setup.exe)
- [Windows 10/11 x64 — pacchetto MSI](https://github.com/eliagentili/local-ai-desk/releases/latest/download/Local-AI-Desk-Windows-x64.msi) (per installazioni gestite; gli aggiornamenti automatici non lo coprono)
- [Note, versioni precedenti e altri asset](https://github.com/eliagentili/local-ai-desk/releases)
- [Checksum SHA-256](https://github.com/eliagentili/local-ai-desk/releases/latest/download/SHA256SUMS.txt)

**L'app non è firmata con un certificato Apple o Windows**, perché è gratuita e
non ha entrate con cui pagare abbonamenti e certificati. Al primo avvio macOS
dice di non poter verificare l'app e va autorizzata una volta in **Impostazioni
di Sistema → Privacy e sicurezza**; su Windows SmartScreen mostra un avviso da
cui si procede con **Ulteriori informazioni → Esegui comunque**, e alcuni browser
possono cancellare il download. Non è un difetto da aggirare di nascosto: è il
prezzo di una distribuzione non firmata, e i passaggi esatti per entrambi i
sistemi — con la verifica dei checksum e la disinstallazione completa — sono in
**[docs/INSTALL.md](docs/INSTALL.md)**.

Ogni release contiene installer, manifest updater firmato Ed25519, firme separate,
SBOM SPDX, inventario licenze e `SHA256SUMS.txt`. Il file dei checksum è firmato
con la stessa chiave dell'updater, e la chiave pubblica (`local-ai-desk-updater.pub`)
e le istruzioni (`VERIFICA-DOWNLOAD.txt`) sono pubblicate fra gli asset della
release: [come verificare quello che hai scaricato](docs/INSTALL.md).

L'app controlla in autonomia le nuove release dopo l'avvio e poi periodicamente;
il controllo si può disattivare. Decide sempre l'utente quando scaricare e
riavviare, e se un lavoro è attivo l'installazione resta in attesa. Il pacchetto
viene accettato soltanto se supera la verifica della firma Ed25519.

## Cosa fa la 1.0

- app desktop nativa con Tauri 2 e React 19;
- primo avvio che spiega cosa fa l'app, quanto spazio serve e quanto ne hai
  libero, con l'installazione dei motori annullabile e la fase sempre visibile;
- coda persistente e scheduler fino a tre lavori concorrenti;
- importazione e drop multipli tramite controlli nativi macOS/Windows;
- upload in streaming e hash BLAKE3 incrementale, senza caricare file enormi in RAM;
- avanzamento reale quando il motore lo espone e stato onesto negli altri casi;
- annullamento per singolo lavoro o per tutto il batch, che **interrompe davvero**
  il motore: nessun processo continua a macinare dopo un annullamento;
- un risultato vuoto è un errore, non un file da 0 byte dichiarato «completato»;
- tetto di durata per lavoro, così un motore bloccato non resta appeso per sempre;
- cronologia degli eventi di ogni lavoro, con fase, stato, messaggio e copia
  negli appunti;
- notifiche di sistema a batch concluso e alla prima fallita, solo quando la
  finestra non è a fuoco;
- riavvio di un lavoro non riuscito con le stesse impostazioni, dalla Libreria;
- risultati atomici in ogni formato e ZIP con manifest JSON;
- runtime e motori in background, senza finestre Terminal o PowerShell;
- dati, modelli e cache nel profilo dell'utente;
- aggiornamenti firmati Ed25519 con controllo automatico, progresso e riavvio esplicito;
- motori raggiungibili solo con il token generato all'avvio, mai da una pagina web,
  e mai adottando un server sulla stessa porta che non risponde a quel token;
- alla chiusura viene terminato l'intero albero dei processi avviati dall'app,
  e i motori si spengono da soli se l'app scompare per un crash o un'uscita
  forzata: nulla resta acceso sul computer;
- una sola istanza per volta e motori che puoi fermare quando non ti servono;
- log applicativo locale in append con rotazione, panic hook e tempo di avvio;
- CSP restrittiva, CI multipiattaforma, CodeQL su JavaScript/TypeScript, Python e
  workflow, SBOM, inventario licenze generato dai lock e checksum di release;
- tema chiaro e scuro con il contrasto misurato da un test in CI, tastiera,
  scorciatoie native, ingrandimento del testo e movimento ridotto;
- licenza e sorgente raggiungibili dall'app, in **Impostazioni → Licenza e
  sorgente**.

## Limiti noti

Sono limiti della 1.0, non promesse. La [roadmap](docs/ROADMAP.md) dice dove
finiscono.

- **Firma del codice assente, in modo permanente.** macOS usa una firma ad-hoc e
  chiede l'autorizzazione in **Privacy e sicurezza**; Windows può mostrare
  SmartScreen. Poiché la firma ad-hoc cambia a ogni build, dopo un aggiornamento
  macOS può ripetere l'autorizzazione e azzerare i permessi già concessi.
- **Non è pubblicata un'attestazione di build provenance.** Gli installer hanno
  checksum SHA-256 firmati e, per gli aggiornamenti, firma Ed25519 verificata
  dall'app.
- **Nessun canale Homebrew cask o winget.** L'installazione avviene dai download
  di questa pagina: `brew install --cask` e `winget install` non sono
  disponibili, perché entrambi presuppongono in pratica un'app firmata.
- **Pausa e ripresa non esistono.** Un lavoro in corso può essere annullato, non
  messo in pausa: dopo l'annullamento il riavvio riparte dall'inizio.
- **Interfaccia solo in italiano.** L'inglese è pianificato nella fase F5.
- **«Proteggi dati» accetta solo file testuali** (txt, md, csv, json, html, xml):
  per un PDF o un DOCX estrai prima il testo con **Estrai**.
- **Le esportazioni disponibili sono Markdown, testo, SRT, JSON e PDF tradotto.**
  DOCX, HTML e VTT sono in roadmap F2.
- **La Libreria elenca e filtra le fonti per nome e tipo.** Tag, collezioni,
  versioni e collegamento fonte→risultato arrivano nella fase F3.
- **Vengono eseguiti al massimo tre lavori insieme**, con un limite per motore. Il
  numero non si adatta alla memoria disponibile.
- **La lingua di partenza di un PDF da tradurre va indicata**: l'app non la deduce
  dal documento.
- **I risultati restano nella cartella dati dell'app finché non li elimini a
  mano**; la cronologia visibile è limitata agli ultimi 500 lavori. Disinstallare
  l'app non rimuove motori, modelli e risultati: i percorsi da cancellare sono in
  [docs/INSTALL.md](docs/INSTALL.md).
- **La modalità Alto contrasto di Windows è supportata solo sui controlli**
  (caselle, interruttori, barre di progresso, elemento attivo, punti di stato).
  Chip e badge informativi non si adattano: il loro significato resta nel testo
  accanto.
- **Nessuna sessione con screen reader è stata registrata.** L'impianto di
  accessibilità c'è e il contrasto è misurato in CI, ma i tre flussi principali
  non sono stati percorsi con VoiceOver o NVDA: lo stato è dichiarato in
  [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).
- **Il rollback di un aggiornamento è documentato ma non ancora eseguito** su
  macchine pulite: la procedura è in [docs/RELEASING.md](docs/RELEASING.md).
- **Anteprima, editor, confronto prima/dopo e workflow visuali non esistono.**
  Sono F2 e F4.
- **Impostazioni configura solo il controllo automatico degli aggiornamenti.**
  Concorrenza, retention, notifiche e tema non hanno un interruttore, e non si
  può rimuovere o riparare il runtime dei motori dall'app.
- **Non si può scegliere fra PaddleOCR e GLM-OCR**: la scelta è del router.
- **Il server dei modelli locale non richiede autenticazione** sulla sua porta:
  un altro programma sullo stesso computer può usarne le risorse. Nessun documento
  vi transita. È un rischio accettato e descritto in
  [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

Gli screenshot di questo README sono stati catturati prima delle ultime
riscritture dell'interfaccia e non mostrano ancora la schermata di benvenuto né
la cronologia degli eventi.

## Runtime locale

Al primo avvio, **Modelli → Installa motori** prepara l'ambiente nel profilo
dell'utente e scarica i componenti da origini ufficiali. L'operazione prosegue
in background. L'app usa soltanto il loopback `127.0.0.1` e termina alla chiusura
i soli processi che ha avviato.

- macOS: `~/Library/Application Support/it.local.localaidesk2/engine`
- Windows: `%APPDATA%\it.local.localaidesk2\engine`

I modelli Ollama stanno invece in `~/.ollama/models`, dove Ollama stesso li
tiene: se li hai già perché usi Ollama per altro, non vengono riscaricati, e
l'installazione salta quasi 10 GB.

Il modello del Privacy Shield (2,6 GB) non è incluso: lo scarichi da **Modelli**
solo se ti serve. Senza, il mascheramento usa le regole italiane e lo dichiara
in ogni risultato.

## Sviluppo

Servono Node.js 20+, Rust stable e gli strumenti nativi della piattaforma:
Xcode Command Line Tools su macOS; Microsoft C++ Build Tools e WebView2 su
Windows.

```bash
npm install
npm run tauri dev
```

Controlli locali:

```bash
npm run check                  # TypeScript senza emettere
npm run lint                   # stylelint: colori letterali e pavimento 11px
npm test                       # test del frontend
npm run test:contrast          # contrasto dei token nei due temi
npm run test:licenses          # inventario licenze aggiornato ai lock
npm run test:release           # script di release
npm run build

cd src-tauri
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

```bash
PYTHONPATH=engine python -m unittest discover -s engine/tests -v
```

Build macOS:

```bash
npm run tauri build -- --bundles app,dmg
```

Build Windows, da Windows:

```powershell
npm ci
npm run tauri build -- --bundles nsis,msi
```

Il workflow [desktop.yml](.github/workflows/desktop.yml) ripete test e build su
runner nativi per entrambe le piattaforme.

## Documentazione

- [Installazione, autorizzazione e disinstallazione](docs/INSTALL.md)
- [Visione di prodotto](docs/PRODUCT.md)
- [Architettura e ciclo di vita dei dati](docs/ARCHITECTURE.md)
- [Ricerca tecnica e scelte dei motori](docs/RESEARCH.md)
- [Roadmap](docs/ROADMAP.md)
- [Sicurezza](SECURITY.md), [modello di minaccia](docs/THREAT_MODEL.md),
  [privacy](PRIVACY.md) e [audit privacy](docs/PRIVACY_AUDIT.md)
- [Accessibilità: stato reale](docs/ACCESSIBILITY.md)
- [Licenze di terze parti](THIRD_PARTY_NOTICES.md) e
  [inventario completo](THIRD_PARTY_LICENSES.md)
- [Procedura di rilascio](docs/RELEASING.md) e
  [checklist](docs/RELEASE_CHECKLIST.md)
- [Supporto](SUPPORT.md) e [come contribuire](CONTRIBUTING.md)
- [Storia delle versioni](https://github.com/eliagentili/local-ai-desk/releases)

## Licenza

Local AI Desk è gratuito e distribuito con licenza
[AGPL-3.0-or-later](LICENSE). Motori, modelli e dipendenze conservano le proprie
condizioni, riepilogate in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) e
inventariate per versione in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
