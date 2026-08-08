from __future__ import annotations

import base64
import importlib.metadata
import importlib.util
import json
import os
import platform
import re
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from .config import (
    MODELS_DIR,
    OLLAMA_MODEL,
    OLLAMA_URL,
    OPF_CHECKPOINT,
    PADDLE_ENGINE,
    PDF_TRANSLATION_MODEL,
    PDF_TRANSLATION_WORKER,
    WHISPER_COMPUTE_TYPE,
    WHISPER_DEVICE,
    WHISPER_MODEL,
    find_binary,
    python_executable,
)


@dataclass
class EngineResult:
    output: str
    engine: str
    output_format: str = "txt"
    warnings: list[str] = field(default_factory=list)
    meta: dict[str, str | int | float | bool] = field(default_factory=dict)


@dataclass
class PDFTranslationResult:
    path: Path
    filename: str
    engine: str = "PDFMathTranslate 2 + TranslateGemma 12B"
    warnings: list[str] = field(default_factory=list)
    meta: dict[str, str | int | float | bool] = field(default_factory=dict)


ENGINE_CONCURRENCY = {
    "markitdown": 4,
    "docling": 2,
    "paddleocr": 1,
    "glmocr": 2,
    "faster-whisper": 2,
    "privacy": 1,
    "pdf-translate": 2,
}
AUTO_BATCH_CONCURRENCY = 3
_ENGINE_SEMAPHORES = {
    name: threading.BoundedSemaphore(limit)
    for name, limit in ENGINE_CONCURRENCY.items()
}
_WHISPER_INIT_LOCK = threading.Lock()
_WHISPER_MODEL_INSTANCE = None
_TRANSLATION_PROCESSES: set[subprocess.Popen] = set()
_TRANSLATION_PROCESSES_LOCK = threading.Lock()
_TRANSLATION_LANGUAGE_NAMES = {
    "en": "English",
    "it": "Italian",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "pt": "Portuguese",
    "nl": "Dutch",
    "pl": "Polish",
    "ru": "Russian",
    "uk": "Ukrainian",
    "ar": "Arabic",
    "zh-CN": "Simplified Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "hi": "Hindi",
    "tr": "Turkish",
}
_TRANSLATEGEMMA_LANGUAGE_CODES = {"zh-CN": "zh-Hans"}


class ProcessingCancelled(RuntimeError):
    """Raised when the user asks an active local job to stop."""


def _raise_if_cancelled(cancel_event: threading.Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise ProcessingCancelled("Elaborazione annullata dall’utente.")


def package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _ollama_request(path: str, payload: dict[str, Any] | None = None, timeout: int = 4):
    url = f"{OLLAMA_URL}{path}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="GET" if data is None else "POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _ollama_has_model(tags: dict[str, Any], requested: str) -> bool:
    names = {
        item.get("name", "")
        for item in tags.get("models", [])
    } | {
        item.get("model", "")
        for item in tags.get("models", [])
    }
    if ":" in requested:
        return requested in names
    return any(name.split(":")[0] == requested for name in names)


def engine_status() -> dict[str, Any]:
    ollama_running = False
    ollama_model = False
    translation_model = False
    try:
        tags = _ollama_request("/api/tags")
        ollama_running = True
        ollama_model = _ollama_has_model(tags, OLLAMA_MODEL)
        translation_model = _ollama_has_model(tags, PDF_TRANSLATION_MODEL)
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        pass

    opf_cli = find_binary("opf")
    checkpoint = Path(OPF_CHECKPOINT)
    privacy_model = (
        (checkpoint / "config.json").exists()
        or (checkpoint / "model.safetensors").exists()
        or any(checkpoint.glob("*.safetensors"))
    )
    privacy_ready = bool(opf_cli and privacy_model)

    engines = {
        "markitdown": {
            "state": "ready" if _module_available("markitdown") else "missing",
            "label": "Pronto" if _module_available("markitdown") else "Da installare",
            "version": package_version("markitdown"),
        },
        "paddleocr": {
            "state": "ready" if _module_available("paddleocr") else "missing",
            "label": (
                f"Pronto · motore {PADDLE_ENGINE}"
                if _module_available("paddleocr")
                else "Da installare"
            ),
            "version": package_version("paddleocr"),
        },
        "glmocr": {
            "state": (
                "ready" if ollama_running and ollama_model else
                "model-missing" if ollama_running else
                "missing"
            ),
            "label": (
                "Modello pronto" if ollama_running and ollama_model else
                "Scarica il modello GLM-OCR" if ollama_running else
                "Avvia Ollama locale"
            ),
            "version": package_version("ollama"),
        },
        "faster-whisper": {
            "state": "ready" if _module_available("faster_whisper") else "missing",
            "label": (
                f"Pronto · modello {WHISPER_MODEL}"
                if _module_available("faster_whisper")
                else "Da installare"
            ),
            "version": package_version("faster-whisper"),
        },
        "privacy": {
            "state": "ready" if privacy_ready else "model-missing",
            "label": (
                "OpenAI + regole italiane"
                if privacy_ready
                else "Regole italiane pronte · modello da scaricare"
            ),
            "version": package_version("opf"),
        },
        "docling": {
            "state": "ready" if _module_available("docling") else "missing",
            "label": "Fallback avanzato" if _module_available("docling") else "Opzionale",
            "version": package_version("docling"),
        },
        "pdf-translate": {
            "state": (
                "ready" if find_binary("pdf2zh_next") and ollama_running and translation_model else
                "model-missing" if find_binary("pdf2zh_next") and ollama_running else
                "missing"
            ),
            "label": (
                "Pronto · TranslateGemma 12B"
                if find_binary("pdf2zh_next") and ollama_running and translation_model
                else "Scarica TranslateGemma 12B"
                if find_binary("pdf2zh_next") and ollama_running
                else "PDFMathTranslate da installare"
            ),
            "version": "2.9.0" if find_binary("pdf2zh_next") else None,
        },
    }
    return {
        "local_only": True,
        "platform": f"{platform.system()} {platform.machine()}",
        "batch_parallelism": AUTO_BATCH_CONCURRENCY,
        "parallelism": ENGINE_CONCURRENCY,
        "engines": engines,
    }


def _stop_translation_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        # terminate() is console-independent; taskkill also reaches descendants
        # spawned by PDFMathTranslate when available.
        process.terminate()
        try:
            process.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                check=False,
                capture_output=True,
                creationflags=creation_flags,
            )
            if process.poll() is None:
                process.kill()
        return
    # The worker shares this server's process group so the desktop app can stop
    # the whole tree at once. Signalling the group here would therefore also
    # kill this server, so the worker is signalled directly.
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def cancel_all_translation_processes() -> None:
    with _TRANSLATION_PROCESSES_LOCK:
        processes = list(_TRANSLATION_PROCESSES)
    for process in processes:
        _stop_translation_process(process)


def translate_pdf(
    path: Path,
    output_dir: Path,
    source_language: str,
    target_language: str,
    mode: str,
    cancel_event: threading.Event | None = None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> PDFTranslationResult:
    def report_progress(payload: dict[str, Any]) -> None:
        if progress_callback is None:
            return
        try:
            progress_callback(payload)
        except Exception:
            # UI progress must never be able to stop the translation itself.
            pass

    _raise_if_cancelled(cancel_event)
    report_progress(
        {
            "state": "preparing",
            "progress": 4.0,
            "stage": "Warmup",
            "stage_label": "Preparazione del motore locale",
        }
    )
    if path.suffix.lower() != ".pdf":
        raise RuntimeError("La traduzione mantiene il layout solo per file PDF.")
    cli = find_binary("pdf2zh_next")
    if not cli:
        raise RuntimeError(
            "Il motore di traduzione PDF non è installato. Apri Modelli e completa l'installazione del runtime locale."
        )
    try:
        tags = _ollama_request("/api/tags")
    except Exception as exc:
        raise RuntimeError("Ollama non è in esecuzione.") from exc
    if not _ollama_has_model(tags, PDF_TRANSLATION_MODEL):
        raise RuntimeError(
            f"Il modello locale {PDF_TRANSLATION_MODEL} non è ancora installato."
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    worker_python = python_executable(Path(cli).parent.parent)
    if not worker_python.exists() or not PDF_TRANSLATION_WORKER.exists():
        raise RuntimeError(
            "Il worker di avanzamento PDF non è installato correttamente."
        )
    source_name = _TRANSLATION_LANGUAGE_NAMES.get(source_language, source_language)
    target_name = _TRANSLATION_LANGUAGE_NAMES.get(target_language, target_language)
    model_source_code = _TRANSLATEGEMMA_LANGUAGE_CODES.get(
        source_language, source_language
    )
    model_target_code = _TRANSLATEGEMMA_LANGUAGE_CODES.get(
        target_language, target_language
    )
    command = [
        str(worker_python),
        str(PDF_TRANSLATION_WORKER),
        str(path),
        "--progress-file",
        str(output_dir / "progress.json"),
        "--ollama-host",
        OLLAMA_URL,
        "--ollama-model",
        PDF_TRANSLATION_MODEL,
        "--lang-in",
        source_language,
        "--lang-out",
        target_language,
        "--output",
        str(output_dir),
        "--qps",
        "1",
        "--pool-max-workers",
        "1",
        "--custom-system-prompt",
        (
            f"You are a professional {source_name} ({model_source_code}) to "
            f"{target_name} ({model_target_code}) translator. Your goal is to "
            f"accurately convey the meaning and nuances of the original {source_name} "
            f"text while adhering to {target_name} grammar, vocabulary, and cultural "
            f"sensitivities. Produce only the {target_name} translation, without any "
            "additional explanations or commentary. Preserve every placeholder exactly."
        ),
        "--no-auto-extract-glossary",
        "--auto-enable-ocr-workaround",
        "--watermark-output-mode",
        "no_watermark",
    ]
    output_kind = "mono" if mode == "translated" else "dual"
    command.append("--no-dual" if mode == "translated" else "--no-mono")

    log_path = output_dir / "translation.log"
    progress_path = output_dir / "progress.json"
    last_progress: dict[str, Any] | None = None

    def read_progress() -> None:
        nonlocal last_progress
        try:
            payload = json.loads(progress_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if payload != last_progress:
            last_progress = payload
            report_progress(payload)

    with log_path.open("w", encoding="utf-8") as log_file:
        process_options: dict[str, Any] = {
            "stdout": log_file,
            "stderr": subprocess.STDOUT,
            "text": True,
        }
        if os.name == "nt":
            process_options["creationflags"] = getattr(
                subprocess, "CREATE_NEW_PROCESS_GROUP", 0
            ) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        # On POSIX the worker deliberately stays in this server's process group:
        # the desktop app terminates that group on quit, which is the only way a
        # multi-minute translation cannot outlive the window that started it.
        process = subprocess.Popen(command, **process_options)
        with _TRANSLATION_PROCESSES_LOCK:
            _TRANSLATION_PROCESSES.add(process)
        try:
            while process.poll() is None:
                read_progress()
                if cancel_event is not None and cancel_event.wait(0.2):
                    _stop_translation_process(process)
                    raise ProcessingCancelled("Traduzione PDF annullata dall’utente.")
                if cancel_event is None:
                    time.sleep(0.2)
            return_code = process.returncode
            read_progress()
        finally:
            with _TRANSLATION_PROCESSES_LOCK:
                _TRANSLATION_PROCESSES.discard(process)

    _raise_if_cancelled(cancel_event)
    candidates = sorted(output_dir.glob(f"*.{target_language}.{output_kind}.pdf"))
    if not candidates:
        candidates = sorted(output_dir.glob(f"*.{output_kind}.pdf"))
    if return_code != 0 or not candidates:
        detail = log_path.read_text(encoding="utf-8", errors="replace")[-4000:]
        raise RuntimeError(
            "PDFMathTranslate non ha prodotto il documento richiesto. "
            + (detail.strip() or f"Codice di uscita: {return_code}")
        )

    suffix = "tradotto" if mode == "translated" else "bilingue"
    filename = f"{path.stem}.{target_language}.{suffix}.pdf"
    report_progress(
        {
            "state": "completed",
            "progress": 100.0,
            "stage": "Completed",
            "stage_label": "PDF pronto",
            "stage_progress": 100.0,
            "stage_current": 1,
            "stage_total": 1,
        }
    )
    return PDFTranslationResult(
        path=candidates[-1],
        filename=filename,
        meta={
            "source_language": source_language,
            "target_language": target_language,
            "translation_mode": mode,
            "model": PDF_TRANSLATION_MODEL,
            "concurrency_limit": ENGINE_CONCURRENCY["pdf-translate"],
        },
    )


def process_pdf_translation(
    path: Path,
    output_dir: Path,
    source_language: str,
    target_language: str,
    mode: str,
    cancel_event: threading.Event | None = None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> PDFTranslationResult:
    semaphore = _ENGINE_SEMAPHORES["pdf-translate"]
    while not semaphore.acquire(timeout=0.2):
        _raise_if_cancelled(cancel_event)
    try:
        return translate_pdf(
            path,
            output_dir,
            source_language,
            target_language,
            mode,
            cancel_event,
            progress_callback,
        )
    finally:
        semaphore.release()


def convert_markitdown(
    path: Path,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    _raise_if_cancelled(cancel_event)
    try:
        from markitdown import MarkItDown
    except ImportError as exc:
        raise RuntimeError(
            "Il motore di conversione documenti non è installato. Apri Modelli e completa l'installazione del runtime locale."
        ) from exc

    result = MarkItDown(enable_plugins=False).convert(str(path))
    _raise_if_cancelled(cancel_event)
    output = getattr(result, "markdown", None) or getattr(result, "text_content", None)
    if not output:
        raise RuntimeError("MarkItDown non ha prodotto contenuto.")
    return EngineResult(
        output=output,
        engine="Microsoft MarkItDown",
        output_format="markdown",
        meta={"characters": len(output)},
    )


def convert_docling(
    path: Path,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    _raise_if_cancelled(cancel_event)
    try:
        from docling.document_converter import DocumentConverter
    except ImportError as exc:
        raise RuntimeError(
            "Il motore documentale avanzato non è installato. Apri Modelli e "
            "completa l'installazione del runtime locale."
        ) from exc
    result = DocumentConverter().convert(str(path))
    _raise_if_cancelled(cancel_event)
    output = result.document.export_to_markdown()
    if not output.strip():
        raise RuntimeError(
            "Nessun testo estratto da questo documento: prova con «Forza OCR»."
        )
    return EngineResult(
        output=output,
        engine="Docling",
        output_format="markdown",
        meta={"characters": len(output)},
    )


@lru_cache(maxsize=1)
def _paddle_pipeline():
    try:
        from paddleocr import PPStructureV3
    except ImportError as exc:
        raise RuntimeError(
            "Il motore OCR non è installato. Apri Modelli e completa l'installazione del runtime locale."
        ) from exc

    options: dict[str, Any] = {
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
        "use_seal_recognition": False,
        "use_table_recognition": True,
        "use_formula_recognition": True,
        "use_chart_recognition": False,
        "use_region_detection": False,
        "lang": "it",
        "engine": PADDLE_ENGINE,
    }
    return PPStructureV3(**options)


def _collect_paddle_pages(
    prediction: Any,
    cancel_event: threading.Event | None,
) -> list[Any]:
    pages: list[Any] = []
    for page in prediction:
        _raise_if_cancelled(cancel_event)
        pages.append(page)
    _raise_if_cancelled(cancel_event)
    return pages


def convert_paddle(
    path: Path,
    output_format: str = "markdown",
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    _raise_if_cancelled(cancel_event)
    pipeline = _paddle_pipeline()
    warnings: list[str] = []
    try:
        pages = _collect_paddle_pages(
            pipeline.predict(
                input=str(path),
                use_e2e_wired_table_rec_model=True,
            ),
            cancel_event,
        )
    except Exception as structured_error:
        if isinstance(structured_error, ProcessingCancelled):
            raise
        try:
            pages = _collect_paddle_pages(
                pipeline.predict(
                    input=str(path),
                    use_table_recognition=False,
                    use_formula_recognition=False,
                ),
                cancel_event,
            )
        except ProcessingCancelled:
            raise
        except Exception:
            raise structured_error
        warnings.append(
            "Il riconoscimento strutturato di tabelle/formule non era stabile su "
            "questo file: PaddleOCR ha completato una seconda passata testuale."
        )
    if not pages:
        raise RuntimeError("PaddleOCR non ha trovato contenuti nel file.")

    if output_format == "json":
        output = json.dumps(
            [getattr(page, "json", {}) for page in pages],
            ensure_ascii=False,
            indent=2,
            default=str,
        )
    else:
        markdown_pages = [getattr(page, "markdown", {}) for page in pages]
        try:
            combined = pipeline.concatenate_markdown_pages(markdown_pages)
            output = (
                combined.get("markdown_texts", "")
                if isinstance(combined, dict)
                else str(combined)
            )
        except Exception:
            chunks: list[str] = []
            for page in markdown_pages:
                text = page.get("markdown_texts", "") if isinstance(page, dict) else ""
                if isinstance(text, list):
                    chunks.extend(str(item) for item in text)
                elif text:
                    chunks.append(str(text))
            output = "\n\n---\n\n".join(chunks)
        if output_format == "txt":
            output = strip_markdown(output)

    return EngineResult(
        output=output,
        engine=f"PaddleOCR PP-StructureV3 ({PADDLE_ENGINE})",
        output_format=output_format,
        warnings=warnings,
        meta={"pages": len(pages)},
    )


def _pdf_pages(
    path: Path,
    target: Path,
    cancel_event: threading.Event | None = None,
) -> list[Path]:
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError(
            "Per elaborare PDF con GLM-OCR serve PyMuPDF."
        ) from exc
    document = fitz.open(path)
    pages: list[Path] = []
    for index, page in enumerate(document):
        _raise_if_cancelled(cancel_event)
        image = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        destination = target / f"page-{index + 1:04d}.png"
        image.save(destination)
        pages.append(destination)
    return pages


def convert_glm(
    path: Path,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    _raise_if_cancelled(cancel_event)
    try:
        _ollama_request("/api/tags")
    except Exception as exc:
        raise RuntimeError(
            "Il servizio locale dei modelli non è avviato. Apri Modelli e premi «Avvia motori»."
        ) from exc

    with tempfile.TemporaryDirectory(prefix="glm-pages-") as raw_dir:
        temp_dir = Path(raw_dir)
        pages = (
            _pdf_pages(path, temp_dir, cancel_event)
            if path.suffix.lower() == ".pdf"
            else [path]
        )
        outputs: list[str] = []
        recognised: list[str] = []
        for index, page in enumerate(pages):
            _raise_if_cancelled(cancel_event)
            image = base64.b64encode(page.read_bytes()).decode("ascii")
            try:
                response = _ollama_request(
                    "/api/generate",
                    {
                        "model": OLLAMA_MODEL,
                        "prompt": (
                            "Document Parsing: restituisci Markdown fedele. "
                            "Preserva titoli, paragrafi, tabelle e formule."
                        ),
                        "images": [image],
                        "stream": False,
                    },
                    timeout=900,
                )
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"GLM-OCR ha restituito un errore: {detail}") from exc
            _raise_if_cancelled(cancel_event)
            page_text = str(response.get("response", ""))
            recognised.append(page_text)
            outputs.append(f"<!-- pagina {index + 1} -->\n\n{page_text}")

    # Check the raw model replies: `outputs` always contains the page comments,
    # so it is never empty even when nothing at all was recognised.
    if not any(chunk.strip() for chunk in recognised):
        raise RuntimeError("GLM-OCR non ha riconosciuto testo in nessuna pagina.")

    output = "\n\n---\n\n".join(outputs)
    return EngineResult(
        output=output,
        engine=f"GLM-OCR via Ollama ({OLLAMA_MODEL})",
        output_format="markdown",
        meta={"pages": len(outputs)},
    )


def _whisper_model():
    global _WHISPER_MODEL_INSTANCE

    if _WHISPER_MODEL_INSTANCE is not None:
        return _WHISPER_MODEL_INSTANCE

    with _WHISPER_INIT_LOCK:
        if _WHISPER_MODEL_INSTANCE is not None:
            return _WHISPER_MODEL_INSTANCE

        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError(
                "Il motore di trascrizione non è installato. Apri Modelli e completa l'installazione del runtime locale."
            ) from exc
        _WHISPER_MODEL_INSTANCE = WhisperModel(
            WHISPER_MODEL,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE_TYPE,
            download_root=str(MODELS_DIR / "faster-whisper"),
            cpu_threads=6,
            num_workers=2,
        )
        return _WHISPER_MODEL_INSTANCE

def _timestamp(seconds: float, srt: bool = False) -> str:
    millis = max(0, int(round(seconds * 1000)))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    separator = "," if srt else "."
    return f"{hours:02}:{minutes:02}:{secs:02}{separator}{millis:03}"


def transcribe(
    path: Path,
    language: str,
    output_format: str,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    _raise_if_cancelled(cancel_event)
    model = _whisper_model()
    segments_iter, info = model.transcribe(
        str(path),
        language=None if language == "auto" else language,
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
    )
    segments = []
    for segment in segments_iter:
        _raise_if_cancelled(cancel_event)
        segments.append(segment)
    _raise_if_cancelled(cancel_event)

    # An empty transcript is a failed job, not a finished one: reporting it as a
    # result would hand the user an empty file and call it done.
    if not segments:
        raise RuntimeError(
            "Nessun parlato riconosciuto: verifica che il file contenga una traccia "
            "audio con voce, oppure indica esplicitamente la lingua."
        )

    if output_format == "json":
        output = json.dumps(
            {
                "language": info.language,
                "language_probability": info.language_probability,
                "segments": [
                    {
                        "start": segment.start,
                        "end": segment.end,
                        "text": segment.text.strip(),
                    }
                    for segment in segments
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    elif output_format == "srt":
        blocks = []
        for index, segment in enumerate(segments, 1):
            blocks.append(
                f"{index}\n{_timestamp(segment.start, True)} --> "
                f"{_timestamp(segment.end, True)}\n{segment.text.strip()}"
            )
        output = "\n\n".join(blocks)
    else:
        output = "\n".join(
            f"[{_timestamp(segment.start)} → {_timestamp(segment.end)}] "
            f"{segment.text.strip()}"
            for segment in segments
        )

    return EngineResult(
        output=output,
        engine=f"Faster Whisper · {WHISPER_MODEL}",
        output_format=output_format,
        meta={
            "segments": len(segments),
            "language": info.language,
            "language_probability": round(float(info.language_probability), 4),
        },
    )


PII_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("PRIVATE_EMAIL", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)),
    ("PRIVATE_IBAN", re.compile(r"\bIT\d{2}[A-Z]\d{10}[A-Z0-9]{12}\b", re.I)),
    ("PRIVATE_FISCAL_CODE", re.compile(r"\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b", re.I)),
    ("PRIVATE_VAT", re.compile(r"(?<!\d)(?:IT)?\d{11}(?!\d)", re.I)),
    ("PRIVATE_PHONE", re.compile(r"(?<!\w)(?:\+39[\s.-]?)?(?:3\d{2}|0\d{1,3})[\s.-]?\d{5,8}(?!\w)")),
    ("PRIVATE_CARD", re.compile(r"\b(?:\d[ -]*?){13,19}\b")),
    ("PRIVATE_IP", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("PRIVATE_URL", re.compile(r"\bhttps?://[^\s<>()]+", re.I)),
    ("SECRET", re.compile(r"\b(?:sk|pk|api|token|secret)[-_][A-Z0-9_-]{12,}\b", re.I)),
]


def _regex_redact(text: str) -> tuple[str, list[dict[str, Any]]]:
    matches: list[dict[str, Any]] = []
    for label, pattern in PII_PATTERNS:
        for match in pattern.finditer(text):
            matches.append(
                {
                    "label": label,
                    "start": match.start(),
                    "end": match.end(),
                    "text": match.group(0),
                }
            )

    non_overlapping: list[dict[str, Any]] = []
    for item in sorted(matches, key=lambda value: (value["start"], -(value["end"] - value["start"]))):
        if any(
            item["start"] < existing["end"] and item["end"] > existing["start"]
            for existing in non_overlapping
        ):
            continue
        non_overlapping.append(item)

    redacted = text
    for item in sorted(non_overlapping, key=lambda value: value["start"], reverse=True):
        redacted = (
            redacted[: item["start"]]
            + f"[{item['label']}]"
            + redacted[item["end"] :]
        )
    return redacted, sorted(non_overlapping, key=lambda value: value["start"])


@lru_cache(maxsize=1)
def _privacy_filter():
    from opf import OPF

    return OPF(model=OPF_CHECKPOINT, device="cpu")


def _opf_redact(text: str) -> tuple[str, list[dict[str, Any]], str | None, bool]:
    """Returns (text, spans, warning, model_ran).

    `model_ran` is what decides the engine label: a caveat emitted *by* the
    model is not the same thing as the model never having run.
    """
    opf = find_binary("opf")
    if not opf:
        return text, [], (
            "Il modello Privacy Filter non è installato: sono state applicate soltanto "
            "le regole italiane locali. Completa l'installazione da Modelli per una "
            "copertura più ampia."
        ), False

    try:
        result = _privacy_filter().redact(text)
        payload = result.to_dict()
        return (
            payload.get("redacted_text", text),
            payload.get("detected_spans", []),
            payload.get("warning"),
            True,
        )
    except Exception:
        return text, [], (
            "Il modello Privacy Filter non ha risposto: sono state applicate soltanto "
            "le regole italiane locali."
        ), False


def protect_text(
    text: str,
    output_format: str,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    _raise_if_cancelled(cancel_event)
    opf_text, opf_spans, warning, model_ran = _opf_redact(text)
    _raise_if_cancelled(cancel_event)
    redacted, regex_spans = _regex_redact(opf_text)
    spans = [*opf_spans, *regex_spans]
    safe_spans = [
        {key: value for key, value in span.items() if key != "text"}
        for span in spans
    ]
    warnings = [warning] if warning else []
    warnings.append(
        "La mascheratura automatica riduce il rischio ma non garantisce anonimizzazione o conformità legale."
    )

    if output_format == "json":
        output = json.dumps(
            {
                "redacted_text": redacted,
                "detected_spans": safe_spans,
                "original_characters": len(text),
            },
            ensure_ascii=False,
            indent=2,
        )
    else:
        output = redacted
    return EngineResult(
        output=output,
        # Name the engine that actually ran: claiming the full filter when only
        # the regex rules were available would overstate the protection applied.
        engine=(
            "Privacy Filter + rilevatori italiani"
            if model_ran
            else "Regole italiane locali (modello Privacy Filter non disponibile)"
        ),
        output_format=output_format,
        warnings=warnings,
        meta={"detected_spans": len(safe_spans)},
    )


def strip_markdown(text: str) -> str:
    text = re.sub(r"!\[[^\]]*]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)]\([^)]*\)", r"\1", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.M)
    text = re.sub(r"[*_`~]{1,3}", "", text)
    return text.strip()


def looks_like_digital_pdf(path: Path) -> bool:
    if path.suffix.lower() != ".pdf":
        return False
    try:
        import fitz
        document = fitz.open(path)
        sample = "".join(page.get_text() for page in list(document)[:3])
        return len(sample.strip()) >= 180
    except Exception:
        return False


def resolve_tool(path: Path, tool: str) -> str:
    audio_extensions = {
        ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg",
        ".mp4", ".mov", ".mkv", ".webm", ".avi",
    }
    text_extensions = {".txt", ".md", ".csv", ".json", ".html", ".xml"}
    office_extensions = {".docx", ".xlsx", ".xls", ".pptx", ".epub"}
    suffix = path.suffix.lower()

    if tool == "auto":
        if suffix in audio_extensions:
            tool = "faster-whisper"
        elif suffix == ".zip":
            tool = "markitdown"
        elif suffix in office_extensions:
            tool = "docling" if _module_available("docling") else "markitdown"
        elif suffix in text_extensions:
            tool = "markitdown"
        elif suffix == ".pdf" and looks_like_digital_pdf(path):
            tool = "docling" if _module_available("docling") else "markitdown"
        elif suffix in {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tiff", ".bmp"}:
            if _module_available("paddleocr"):
                tool = "paddleocr"
            else:
                tool = "glmocr"
        else:
            tool = "markitdown"
    return tool


def _process_resolved_file(
    path: Path,
    tool: str,
    output_format: str,
    language: str,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    _raise_if_cancelled(cancel_event)
    if tool == "markitdown":
        result = convert_markitdown(path, cancel_event)
    elif tool == "docling":
        result = convert_docling(path, cancel_event)
    elif tool == "paddleocr":
        result = convert_paddle(path, output_format, cancel_event)
    elif tool == "glmocr":
        result = convert_glm(path, cancel_event)
    elif tool == "faster-whisper":
        result = transcribe(path, language, output_format, cancel_event)
    elif tool == "privacy":
        _raise_if_cancelled(cancel_event)
        result = protect_text(
            path.read_text(encoding="utf-8", errors="replace"),
            output_format,
            cancel_event,
        )
    else:
        raise RuntimeError(f"Motore non supportato: {tool}")

    if output_format == "txt" and result.output_format == "markdown":
        result.output = strip_markdown(result.output)
        result.output_format = "txt"
    result.meta.setdefault("resolved_tool", tool)
    result.meta.setdefault("concurrency_limit", ENGINE_CONCURRENCY[tool])
    return result


def process_file(
    path: Path,
    tool: str,
    output_format: str,
    language: str = "auto",
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    _raise_if_cancelled(cancel_event)
    resolved_tool = resolve_tool(path, tool)
    semaphore = _ENGINE_SEMAPHORES[resolved_tool]
    while not semaphore.acquire(timeout=0.2):
        _raise_if_cancelled(cancel_event)
    try:
        _raise_if_cancelled(cancel_event)
        return _process_resolved_file(
            path,
            resolved_tool,
            output_format,
            language,
            cancel_event,
        )
    finally:
        semaphore.release()


def process_text(
    text: str,
    output_format: str,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    semaphore = _ENGINE_SEMAPHORES["privacy"]
    while not semaphore.acquire(timeout=0.2):
        _raise_if_cancelled(cancel_event)
    try:
        result = protect_text(text, output_format, cancel_event)
    finally:
        semaphore.release()
    result.meta.setdefault("resolved_tool", "privacy")
    result.meta.setdefault(
        "concurrency_limit",
        ENGINE_CONCURRENCY["privacy"],
    )
    return result
