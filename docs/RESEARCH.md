# Ricerca tecnica e scelte

Aggiornata il 6 agosto 2026. Le scelte sono ipotesi tecniche da validare con un
benchmark riproducibile sui dispositivi target; popolarità e numero di stelle non sono
usati come sostituti di qualità, velocità o licenza.

## Shell desktop

**Scelta:** Tauri 2 + Rust + React/Vite.

Per una app locale non serve il runtime server di un framework web full-stack.
Vite produce asset statici, mentre Tauri espone solo comandi nativi espliciti. Il
sistema di [capabilities di Tauri](https://v2.tauri.app/security/capabilities/)
permette di limitare ciò che ogni WebView può invocare. La Foundation concede
solo il selettore file; rete, shell e filesystem generico non sono esposti alla
UI.

## Documenti

| Esigenza | Candidato | Decisione |
| --- | --- | --- |
| Conversione rapida Office/PDF digitale | [Microsoft MarkItDown](https://github.com/microsoft/markitdown) | Mantenerlo come percorso veloce. Il progetto stesso chiarisce che punta a Markdown per pipeline LLM, non a conversioni visuali ad alta fedeltà. |
| Struttura, tabelle, formule, ordine di lettura | [Docling](https://github.com/docling-project/docling) | Mantenerlo come parser strutturale e fallback. Offre esecuzione locale, formati diversi e una rappresentazione intermedia ricca. |
| OCR generale e document parsing | [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Candidato principale. I pacchetti opzionali vanno separati per ridurre installazione e superficie d'attacco. |
| VLM per pagine difficili | GLM-OCR / GraniteDocling | Pack avanzato, non default. Va usato solo quando il router rileva casi in cui l'OCR classico perde struttura. |

MarkItDown e Docling non sono veri sostituti: il primo privilegia velocità e testo
utile, il secondo comprensione strutturale. Il router Auto deve stimare tipo di
PDF, densità di immagini, tabelle e qualità del text layer prima di decidere.

## Traduzione PDF

La traduzione ha due problemi distinti:

1. estrazione e ricostruzione del layout;
2. qualità linguistica del motore di traduzione.

[BabelDOC](https://github.com/funstory-ai/BabelDOC) resta il candidato migliore
da valutare per il primo problema e costituisce il core della nuova generazione
di PDFMathTranslate. La documentazione segnala però limiti noti e copertura
linguistica non uniforme: non può essere l'unico percorso.

Per il secondo problema servono almeno due pack:

- **Compatto:** [Argos Translate](https://github.com/argosopentech/argos-translate)
  o modelli NLLB/OPUS su
  [CTranslate2](https://github.com/OpenNMT/CTranslate2), per download ridotti e
  molte coppie linguistiche;
- **Qualità:** TranslateGemma o altro modello generativo con glossario e memoria
  di traduzione locali, accelerato sul dispositivo dopo benchmark.

La v1 usa già TranslateGemma 12B. Non viene sostituito sulla base di impressioni:
il gate è un test EN↔IT con prosa, tabelle, termini coerenti, formule, PDF
scansionati e confronto di layout. Vanno misurati COMET/BLEU dove sensati,
valutazione umana, pagine/minuto, picco RAM e dimensione del pack.

## Audio e video

[Faster Whisper](https://github.com/SYSTRAN/faster-whisper) rimane disponibile
durante la migrazione perché è maturo, supporta VAD e timestamp e già funziona
nella v1.

Su Apple Silicon, tuttavia, il candidato default da confrontare è
[whisper.cpp](https://github.com/ggml-org/whisper.cpp): offre un'integrazione C/C++
compatta e percorsi Metal/Core ML. Anche
[MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) entra
nel benchmark. La decisione finale dipenderà da accuratezza, real-time factor,
timestamp, annullamento, memoria e stabilità su file multi-GB; non solo dalla
velocità su clip brevi.

Diarizzazione e allineamento preciso devono essere pack separati perché possono
avere licenze, dipendenze e costi di memoria diversi.

## Runtime e piattaforme

[MLX](https://github.com/ml-explore/mlx) è un'opzione primaria per i modelli che
dispongono di conversioni affidabili: sfrutta memoria unificata e CPU/GPU Apple
Silicon. Non deve però diventare un vincolo universale. Worker C/C++ come
whisper.cpp o llama.cpp possono essere più facili da distribuire e isolare.

La registry dei motori deve quindi descrivere capacità e requisiti, non imporre
un solo runtime:

```text
engine id · versione · licenza · formati · lingue · RAM stimata
acceleratori · concorrenza sicura · checksum · entrypoint · health check
```

La shell e i motori Python scelti hanno percorsi supportati anche su Windows.
MLX/Metal resta un'ottimizzazione Mac; su Windows il baseline portabile è CPU
con CTranslate2/Faster Whisper e Ollama può sfruttare GPU NVIDIA o AMD quando
supportata. I pacchetti e i benchmark devono quindi dichiarare esplicitamente
sistema, architettura e acceleratore anziché promettere parità di velocità.

## Benchmark obbligatorio

Prima di promuovere o sostituire un motore:

- corpus versionato senza dati sensibili;
- warm e cold start separati;
- qualità dell'output e fedeltà visuale;
- tempo totale, first progress e cancellazione;
- picco di RAM, pressione memoria, spazio e consumo energetico;
- esito dopo force quit, input corrotto e disco pieno;
- licenza del codice e dei pesi verificata.

I risultati verranno salvati in JSON e visualizzati nell'app. In questo modo
“Auto” potrà scegliere usando dati del dispositivo e del documento, non regole
opache o preferenze del team.
