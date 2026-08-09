# Third-party notices

Local AI Desk è distribuito con licenza AGPL-3.0-or-later. Il repository non
contiene i pesi dei modelli né incorpora i pacchetti Python: l'utente sceglie di
scaricarli al primo avvio dalle origini indicate. Ogni componente conserva la
propria licenza; la licenza del progetto non sostituisce tali condizioni.

Questo file è il **riepilogo commentato**: elenca i componenti principali e dice
perché sono presenti. L'inventario completo, con versione e licenza di ogni
pacchetto Python, di ogni crate Rust compilata nel binario e di ogni dipendenza
npm dell'interfaccia, è in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), generato dai file di lock
del progetto e allegato a ogni release. Dove i due file divergono, fa fede
l'inventario generato: questo è scritto a mano.

## Runtime e strumenti scaricabili

| Componente | Versione o revisione | Licenza dichiarata | Origine |
| --- | --- | --- | --- |
| uv | 0.12.2 | Apache-2.0 OR MIT | https://github.com/astral-sh/uv |
| Python | 3.12 | PSF-2.0 | https://www.python.org/ |
| FastAPI | 0.141.1 | MIT | https://github.com/fastapi/fastapi |
| Starlette | 1.3.1 | BSD-3-Clause | https://github.com/Kludex/starlette |
| python-multipart | 0.0.32 | Apache-2.0 | https://github.com/Kludex/python-multipart |
| Uvicorn | 0.52.1 | BSD-3-Clause | https://github.com/Kludex/uvicorn |
| PyMuPDF | 1.28.0 | AGPL-3.0 oppure licenza commerciale Artifex | https://github.com/pymupdf/PyMuPDF |
| MarkItDown | 0.1.7 | MIT | https://github.com/microsoft/markitdown |
| faster-whisper | 1.2.1 | MIT | https://github.com/SYSTRAN/faster-whisper |
| Docling | 2.118.0 | MIT | https://github.com/docling-project/docling |
| PaddlePaddle | 3.3.1 | Apache-2.0 | https://github.com/PaddlePaddle/Paddle |
| PaddleOCR | 3.7.0 | Apache-2.0 | https://github.com/PaddlePaddle/PaddleOCR |
| PDFMathTranslate-next | 2.9.0, solo core headless | AGPL-3.0 | https://github.com/PDFMathTranslate/PDFMathTranslate-next |
| OpenAI Privacy Filter | f7f00ca7fb869683eb732c010299d901457f19c3 | Apache-2.0 | https://github.com/openai/privacy-filter |
| PyTorch | 2.13.0 | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT | https://github.com/pytorch/pytorch |
| Ollama | 0.32.6 | MIT | https://github.com/ollama/ollama |

L'interfaccia Gradio inclusa come dipendenza opzionale di PDFMathTranslate-next
non viene usata ed è rimossa dal suo ambiente isolato durante il bootstrap. Le
versioni condivise di Pillow e Starlette vengono aggiornate agli override
verificati elencati nei file `requirements-translation-*`.

L'ambiente di traduzione porta come dipendenze transitive adapter per servizi di
traduzione cloud (DeepL, OpenAI, Azure, Google, Tencent e altri). **Non sono
configurati né selezionabili**: l'endpoint dei modelli è fissato a
`127.0.0.1:11434` nel codice del progetto e nessun token viene chiesto o
salvato. Sono dipendenze morte del pacchetto a monte, elencate qui perché
compaiono nei lock e quindi nell'inventario.

## Componenti che richiedono attenzione

Le licenze permissive (MIT, BSD, Apache-2.0, ISC, 0BSD) richiedono che l'avviso
di copyright accompagni ogni copia, e ogni pacchetto lo porta nella
distribuzione installata sul dispositivo. Queste voci hanno obblighi diversi o
più stretti e vale la pena conoscerle prima di un uso commerciale o
redistribuito. Sono ricavate dall'inventario generato ai lock attuali.

| Componente | Versione | Licenza dichiarata | Perché è qui |
| --- | --- | --- | --- |
| PyMuPDF | 1.28.0 e 1.25.2 | AGPL-3.0, oppure licenza commerciale Artifex | È una delle ragioni per cui il progetto stesso è AGPL. Un prodotto derivato non AGPL richiede la licenza commerciale Artifex. |
| pdf2zh-next (PDFMathTranslate) | 2.9.0 | AGPL-3.0 | Motore della traduzione PDF; stessa conseguenza di PyMuPDF. |
| BabelDOC | 0.6.2 | AGPL-3.0 | Libreria di layout usata da pdf2zh-next. |
| Levenshtein | 0.27.3 | GPL-2.0-or-later | Dipendenza dell'ambiente di traduzione, la sola GPL dell'insieme. Gira in un processo Python separato, non è collegata al binario dell'app. |
| python-bidi | 0.6.11 | LGPL (dichiarata dall'autore come "GNU Library or Lesser General Public License") | Ambiente dei motori. Distribuita come wheel non modificato. |
| crc32c | 2.8 | LGPL-2.1-or-later | Ambiente dei motori. Distribuita come wheel non modificato. |
| marisa-trie | 1.4.1 | MIT AND (BSD-2-Clause OR LGPL-2.1-or-later) | Ambiente di traduzione. |
| PyAV (`av`) | 18.0.0 | BSD-3-Clause per il codice | **Le wheel pubblicate incorporano FFmpeg**, che è LGPL-2.1-or-later (o GPL secondo la build). Chi ridistribuisce l'ambiente dei motori ridistribuisce anche quei binari e ne assume gli obblighi. |
| opencv-python e opencv-contrib-python | 5.0.0.93 / 4.10.0.84 | Apache-2.0 per il codice OpenCV | Anche queste wheel incorporano librerie multimediali di terze parti con licenze proprie, elencate nel pacchetto. `opencv-contrib` include moduli con restrizioni d'uso brevettuale in alcune giurisdizioni. |
| pypdfium2 | 5.12.1 | BSD-3-Clause, Apache-2.0 e licenze delle dipendenze | Incorpora PDFium di Google con le sue attribuzioni. |
| certifi, orjson, tqdm | 2026.7.22 / 3.11.9 / 4.70.0 | MPL-2.0 (in parte) | MPL richiede di rendere disponibili le modifiche ai file coperti. Nessuno di questi pacchetti è modificato dal progetto. |
| onnxruntime | 1.23.2 / 1.28.0 | MIT | Permissiva, elencata perché non compariva nelle versioni precedenti di questo file. |
| pdfminer-six, python-pptx, chardet | 20260107 / 1.0.2 / 7.5.1 | MIT, MIT, 0BSD | Permissive, elencate per lo stesso motivo. Nota: `chardet` è LGPL-2.1 nelle serie 3.x-5.x; la versione pinnata qui è ri-licenziata 0BSD dall'autore. |

Le dipendenze transitive sono congelate per piattaforma nei file `*.lock` con
hash SHA-256. **L'SBOM SPDX allegato a ogni release cataloga anche i pacchetti
di quei lock, ma non ne dichiara le licenze**: per la maggior parte dei
pacchetti il campo è `NOASSERTION`, quindi l'SBOM serve a sapere *cosa* è
installato, non con quali condizioni. L'inventario delle licenze è
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), generato leggendo i metadati
dichiarati dagli autori. Gli avvisi integrali restano nei pacchetti scaricati e
nei repository collegati.

## Modelli scaricabili

| Modello | Licenza dichiarata dal produttore | Nota |
| --- | --- | --- |
| GLM-OCR | MIT per i pesi; codice di riferimento Apache-2.0 | Scaricato tramite Ollama; verificare la model card prima dell'uso. |
| TranslateGemma 12B | Gemma Terms of Use | Vedi il paragrafo seguente. |
| faster-whisper small | MIT | Conversione CTranslate2 dei pesi OpenAI Whisper. |
| Granite Docling | Apache-2.0 | Scaricato dagli strumenti Docling con il set di default di `docling-tools models download`; le sottocartelle prodotte non sono ancora inventariate una per una. |
| Modelli PaddleOCR | Apache-2.0 salvo diversa indicazione nella singola model card | Scaricati su richiesta dal runtime PaddleOCR, al primo OCR. |
| OpenAI Privacy Filter | Apache-2.0 | Il checkpoint (2,6 GB) si scarica da **Modelli**, su richiesta, dal repository Hugging Face `openai/privacy-filter`: viene presa solo la sottocartella `original`, altrimenti sarebbero circa 17 GB. La revisione non è fissata: `snapshot_download` prende il ramo principale. |

### TranslateGemma e i Gemma Terms of Use

Il modello che traduce i PDF è derivato da Gemma di Google e **non è coperto
dall'AGPL del progetto**. L'installazione dei motori lo scarica dal registro
Ollama: usarlo implica l'accettazione dei
[Gemma Terms of Use](https://ai.google.dev/gemma/terms) e della
[Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy),
che vincolano gli usi consentiti anche per i modelli derivati e impongono di
trasmettere gli stessi termini a chi riceve il modello o un suo derivato.

L'app **non mostra questi termini prima del download**: mostrare la licenza di
ogni modello con conferma esplicita prima di «Installa motori» è un lavoro
previsto e non ancora fatto. Fino ad allora questo file e il README sono l'unico
avviso, ed è un limite dichiarato.

Le model card e i termini a monte sono l'autorità. Prima di un uso commerciale,
regolamentato o in giurisdizioni particolari, l'utente deve verificarli.

## Marchi

Nomi e loghi di progetti terzi appartengono ai rispettivi titolari. La loro
presenza descrive interoperabilità e non implica sponsorizzazione.
