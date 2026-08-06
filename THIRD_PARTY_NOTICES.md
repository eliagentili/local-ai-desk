# Third-party notices

Local AI Desk è distribuito con licenza AGPL-3.0-or-later. Il repository non
contiene i pesi dei modelli né incorpora i pacchetti Python: l'utente sceglie di
scaricarli al primo avvio dalle origini indicate. Ogni componente conserva la
propria licenza; la licenza del progetto non sostituisce tali condizioni.

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
| PyTorch | 2.13.0 | BSD-3-Clause con notice di terze parti | https://github.com/pytorch/pytorch |
| Ollama | 0.32.6 | MIT | https://github.com/ollama/ollama |

L'interfaccia Gradio inclusa come dipendenza opzionale di PDFMathTranslate-next
non viene usata ed è rimossa dal suo ambiente isolato durante il bootstrap. Le
versioni condivise di Pillow e Starlette vengono aggiornate agli override
verificati elencati nei file `requirements-translation-*`.

Le dipendenze transitive sono congelate per piattaforma nei file `*.lock` con
hash SHA-256 e sono incluse nell'SBOM SPDX allegato a ogni release. Gli avvisi
completi rimangono inoltre nei pacchetti scaricati e nei repository collegati.

## Modelli scaricabili

| Modello | Licenza dichiarata dal produttore | Nota |
| --- | --- | --- |
| GLM-OCR | MIT per i pesi; codice di riferimento Apache-2.0 | Scaricato tramite Ollama; verificare la model card prima dell'uso. |
| TranslateGemma 12B | Gemma Terms of Use | Non è coperto dall'AGPL del progetto; l'uso implica l'accettazione dei termini Google. |
| faster-whisper small | MIT | Conversione CTranslate2 dei pesi OpenAI Whisper. |
| Granite Docling | Apache-2.0 | Scaricato dagli strumenti Docling. |
| Modelli PaddleOCR | Apache-2.0 salvo diversa indicazione nella singola model card | Scaricati su richiesta dal runtime PaddleOCR. |
| OpenAI Privacy Filter | Apache-2.0 | I pesi possono essere scaricati dal pacchetto ufficiale. |

Le model card e i termini a monte sono l'autorità. Prima di un uso commerciale,
regolamentato o in giurisdizioni particolari, l'utente deve verificarli.

## Marchi

Nomi e loghi di progetti terzi appartengono ai rispettivi titolari. La loro
presenza descrive interoperabilità e non implica sponsorizzazione.
