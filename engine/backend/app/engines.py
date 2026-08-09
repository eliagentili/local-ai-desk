from __future__ import annotations

import base64
import importlib.metadata
import importlib.util
import json
import os
import platform
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from .config import (
    ARCHIVE_RATIO_FLOOR_BYTES,
    ENGINE_WORKER,
    MAX_ARCHIVE_BYTES,
    MAX_ARCHIVE_ENTRIES,
    MAX_ARCHIVE_RATIO,
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
    for name, payload in engines.items():
        pack = MODEL_PACKS.get(name)
        if pack is not None:
            payload["downloadable"] = True
            payload["pack_label"] = pack.label
            payload["pack_bytes"] = pack.approximate_bytes
        download = model_download_state(name)
        if download is not None:
            payload["download"] = download

    return {
        "local_only": True,
        "platform": f"{platform.system()} {platform.machine()}",
        "batch_parallelism": AUTO_BATCH_CONCURRENCY,
        "parallelism": ENGINE_CONCURRENCY,
        "engines": engines,
    }


# --------------------------------------------------------------- model packs
#
# Most engines get their models during the one-off install. The Privacy Filter
# checkpoint is 2.6 GB and only matters to people who mask personal data, so it
# is fetched on request instead of being imposed on every installation. Until it
# arrives the engine still works on the Italian rules alone, and says so.

@dataclass
class ModelPack:
    engine: str
    repo_id: str
    label: str
    target: Path
    # Only this folder of the repository is the checkpoint we need.
    subfolder: str
    approximate_bytes: int


MODEL_PACKS: dict[str, ModelPack] = {
    "privacy": ModelPack(
        engine="privacy",
        repo_id="openai/privacy-filter",
        label="Modello Privacy Filter",
        target=Path(OPF_CHECKPOINT),
        subfolder="original",
        approximate_bytes=2_600_000_000,
    ),
}

_MODEL_DOWNLOADS: dict[str, dict[str, Any]] = {}
_MODEL_DOWNLOAD_LOCK = threading.Lock()


def _directory_bytes(path: Path) -> int:
    total = 0
    for entry in path.rglob("*"):
        try:
            if entry.is_file():
                total += entry.stat().st_size
        except OSError:
            continue
    return total


def _set_download_state(engine: str, **updates: Any) -> None:
    with _MODEL_DOWNLOAD_LOCK:
        _MODEL_DOWNLOADS.setdefault(engine, {}).update(updates)


def model_download_state(engine: str) -> dict[str, Any] | None:
    with _MODEL_DOWNLOAD_LOCK:
        state = _MODEL_DOWNLOADS.get(engine)
        return dict(state) if state else None


def _run_model_download(pack: ModelPack) -> None:
    """Fetch a model pack into place, or leave no trace at all.

    The download lands in a staging folder and is moved into the target only
    once complete. Writing straight into the target would publish `config.json`
    within seconds, and `engine_status` would report the engine ready while its
    weights were still arriving — sending jobs to a model that is not there.
    """
    staging = pack.target.with_name(pack.target.name + ".incoming")
    stop_watching = threading.Event()

    def watch() -> None:
        while not stop_watching.wait(1.0):
            _set_download_state(pack.engine, downloaded_bytes=_directory_bytes(staging))

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    try:
        from huggingface_hub import snapshot_download

        # The repository ships several variants; only this one is the
        # checkpoint the filter loads. Without the filter it would be ~17 GB.
        patterns = [f"{pack.subfolder}/*"]

        total = pack.approximate_bytes
        try:
            from huggingface_hub import HfApi

            info = HfApi().model_info(pack.repo_id, files_metadata=True)
            measured = sum(
                sibling.size or 0
                for sibling in (info.siblings or [])
                if sibling.rfilename.startswith(f"{pack.subfolder}/")
            )
            if measured > 0:
                total = measured
        except Exception:
            # An estimate keeps the bar honest enough; real bytes still win.
            pass
        _set_download_state(pack.engine, total_bytes=total)

        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True, exist_ok=True)
        snapshot_download(
            repo_id=pack.repo_id,
            local_dir=str(staging),
            allow_patterns=patterns,
        )

        source = staging / pack.subfolder
        if not any(source.glob("*.safetensors")):
            raise RuntimeError("il pacchetto scaricato non contiene i pesi del modello")

        # Publish in one step, so the engine is never half-ready.
        shutil.rmtree(pack.target, ignore_errors=True)
        pack.target.parent.mkdir(parents=True, exist_ok=True)
        source.rename(pack.target)
        shutil.rmtree(staging, ignore_errors=True)

        _set_download_state(
            pack.engine,
            state="ready",
            downloaded_bytes=_directory_bytes(pack.target),
        )
    except Exception as exc:
        shutil.rmtree(staging, ignore_errors=True)
        _set_download_state(
            pack.engine,
            state="error",
            error=(
                "Download del modello non riuscito: verifica la connessione e riprova. "
                f"({type(exc).__name__})"
            ),
        )
    finally:
        stop_watching.set()


def start_model_download(engine: str) -> dict[str, Any]:
    pack = MODEL_PACKS.get(engine)
    if pack is None:
        raise KeyError(engine)
    with _MODEL_DOWNLOAD_LOCK:
        current = _MODEL_DOWNLOADS.get(engine, {})
        if current.get("state") == "downloading":
            return dict(current)
        _MODEL_DOWNLOADS[engine] = {
            "state": "downloading",
            "label": pack.label,
            "downloaded_bytes": 0,
            "total_bytes": pack.approximate_bytes,
            "error": None,
        }
    threading.Thread(target=_run_model_download, args=(pack,), daemon=True).start()
    return model_download_state(engine) or {}


def _stop_child_process(process: subprocess.Popen) -> None:
    """Terminate a child of this server, descendants included."""
    if process.poll() is not None:
        return
    if os.name == "nt":
        # terminate() is console-independent; taskkill also reaches descendants
        # spawned by the child when available.
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
    # The child shares this server's process group so the desktop app can stop
    # the whole tree at once. Signalling the group here would therefore also
    # kill this server, so the child is signalled directly.
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def stop_all_child_processes() -> None:
    """Stop every engine process this server owns: nothing outlives the app."""
    with _TRANSLATION_PROCESSES_LOCK:
        processes = list(_TRANSLATION_PROCESSES)
    for process in processes:
        _stop_child_process(process)
    stop_all_engine_workers()


# ------------------------------------------------------------- engine workers
#
# MarkItDown, Docling and the Privacy Filter each do their work in one blocking
# call with nowhere to check for cancellation. Run inside this server they would
# keep a core busy — and the per-engine slot held, which for `privacy` is the
# only one there is — long after the user asked the job to stop. So they run in
# child processes that can be terminated, exactly like the PDF translation
# worker.
#
# The processes are reused across jobs: loading the Privacy Filter checkpoint or
# building Docling's converter costs more than most conversions, and paying it
# per job would trade one defect for another. A cancelled worker is terminated
# and never handed out again, so the next job always starts from a clean process.

_ENGINE_WORKERS: dict[str, list["_EngineWorker"]] = {}
_ENGINE_WORKER_LOCK = threading.Lock()
_ENGINE_WORKER_PROCESSES: set[subprocess.Popen] = set()

WORKER_LOST_MESSAGE = (
    "Il motore locale si è interrotto durante l’elaborazione di questo file: "
    "riprova. Se l’errore si ripete, suddividi il file in parti più piccole."
)


@dataclass
class _EngineWorker:
    process: subprocess.Popen
    # Replies arrive on a queue instead of a blocking read, so that waiting for
    # the answer and watching for cancellation are the same loop.
    replies: "queue.Queue[str | None]"


def _worker_command(engine: str) -> list[str]:
    """The command that answers one engine's tasks in a separate process."""
    if not ENGINE_WORKER.is_file():
        raise RuntimeError(
            "Il pacchetto dei motori è incompleto: apri Modelli e ripeti "
            "l'installazione del runtime locale."
        )
    return [str(sys.executable), str(ENGINE_WORKER), engine]


def _pump_worker_replies(
    process: subprocess.Popen,
    replies: "queue.Queue[str | None]",
) -> None:
    try:
        if process.stdout is not None:
            for line in process.stdout:
                replies.put(line)
    except (OSError, ValueError):
        pass
    finally:
        # None means end of stream: the worker is gone and no answer is coming.
        replies.put(None)


def _spawn_worker(engine: str) -> _EngineWorker:
    options: dict[str, Any] = {
        "stdin": subprocess.PIPE,
        "stdout": subprocess.PIPE,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
        "bufsize": 1,
        "env": {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
    }
    if os.name == "nt":
        options["creationflags"] = getattr(
            subprocess, "CREATE_NEW_PROCESS_GROUP", 0
        ) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    # On POSIX the worker deliberately stays in this server's process group: the
    # desktop app stops that group when it quits, and that is the only thing
    # keeping a conversion from outliving the window that started it.
    try:
        process = subprocess.Popen(_worker_command(engine), **options)
    except OSError as exc:
        raise RuntimeError(
            "Il motore locale non può essere avviato: apri Modelli e completa "
            "l'installazione del runtime locale."
        ) from exc
    replies: "queue.Queue[str | None]" = queue.Queue()
    threading.Thread(
        target=_pump_worker_replies, args=(process, replies), daemon=True
    ).start()
    with _ENGINE_WORKER_LOCK:
        _ENGINE_WORKER_PROCESSES.add(process)
    return _EngineWorker(process=process, replies=replies)


def _checkout_worker(engine: str) -> _EngineWorker:
    while True:
        with _ENGINE_WORKER_LOCK:
            idle = _ENGINE_WORKERS.setdefault(engine, [])
            worker = idle.pop() if idle else None
        if worker is None:
            return _spawn_worker(engine)
        if worker.process.poll() is None and worker.replies.empty():
            return worker
        # Died while idle, or left something unread: not fit to answer a job.
        _discard_worker(worker)


def _release_worker(engine: str, worker: _EngineWorker) -> None:
    if worker.process.poll() is not None or not worker.replies.empty():
        _discard_worker(worker)
        return
    with _ENGINE_WORKER_LOCK:
        _ENGINE_WORKERS.setdefault(engine, []).append(worker)


def _retire_worker_process(process: subprocess.Popen) -> None:
    _stop_child_process(process)
    # The pipes are closed once the process is gone: a server that runs for days
    # would otherwise leak two descriptors for every cancelled job.
    for stream in (process.stdin, process.stdout):
        if stream is not None:
            try:
                stream.close()
            except (OSError, ValueError):
                pass


def _discard_worker(worker: _EngineWorker) -> None:
    _retire_worker_process(worker.process)
    with _ENGINE_WORKER_LOCK:
        _ENGINE_WORKER_PROCESSES.discard(worker.process)


def stop_all_engine_workers() -> None:
    with _ENGINE_WORKER_LOCK:
        processes = list(_ENGINE_WORKER_PROCESSES)
        _ENGINE_WORKERS.clear()
        _ENGINE_WORKER_PROCESSES.clear()
    for process in processes:
        _retire_worker_process(process)


def active_engine_worker_processes() -> list[subprocess.Popen]:
    """Worker processes this server is responsible for, live or not yet reaped."""
    with _ENGINE_WORKER_LOCK:
        return list(_ENGINE_WORKER_PROCESSES)


def _run_in_worker(
    engine: str,
    payload: dict[str, Any],
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    _raise_if_cancelled(cancel_event)
    worker = _checkout_worker(engine)
    try:
        if worker.process.stdin is None:
            raise OSError("worker stdin is not writable")
        worker.process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        worker.process.stdin.flush()
    except (OSError, ValueError) as exc:
        _discard_worker(worker)
        raise RuntimeError(WORKER_LOST_MESSAGE) from exc

    while True:
        try:
            line = worker.replies.get(timeout=0.2)
            break
        except queue.Empty:
            if cancel_event is not None and cancel_event.is_set():
                # Terminating the process is what actually stops the work and
                # frees the engine slot; the job is only cancelled after that.
                _discard_worker(worker)
                raise ProcessingCancelled("Elaborazione annullata dall’utente.")

    if line is None:
        _discard_worker(worker)
        _raise_if_cancelled(cancel_event)
        raise RuntimeError(WORKER_LOST_MESSAGE)
    try:
        reply = json.loads(line)
    except json.JSONDecodeError as exc:
        _discard_worker(worker)
        raise RuntimeError(WORKER_LOST_MESSAGE) from exc

    _release_worker(engine, worker)
    if not reply.get("ok"):
        raise RuntimeError(str(reply.get("error") or WORKER_LOST_MESSAGE))
    result = reply.get("result")
    if not isinstance(result, dict):
        raise RuntimeError(WORKER_LOST_MESSAGE)
    return result


def _engine_result(payload: dict[str, Any]) -> EngineResult:
    return EngineResult(
        output=str(payload.get("output", "")),
        engine=str(payload.get("engine", "")),
        output_format=str(payload.get("output_format", "txt")),
        warnings=[str(item) for item in payload.get("warnings", [])],
        meta=dict(payload.get("meta", {})),
    )


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
                    _stop_child_process(process)
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


def _markitdown_task(payload: dict[str, Any]) -> dict[str, Any]:
    """Convert a document with MarkItDown. Runs inside a worker process."""
    path = Path(str(payload["path"]))
    try:
        from markitdown import MarkItDown
    except ImportError as exc:
        raise RuntimeError(
            "Il motore di conversione documenti non è installato. Apri Modelli e completa l'installazione del runtime locale."
        ) from exc

    result = MarkItDown(enable_plugins=False).convert(str(path))
    output = getattr(result, "markdown", None) or getattr(result, "text_content", None)
    output = str(output or "")
    # An empty conversion is a failed job, not a finished one: reporting it as a
    # result would hand the user a file with nothing in it and call it done.
    if not output.strip():
        raise RuntimeError(
            "Da questo file non è stato estratto alcun testo: potrebbe essere "
            "vuoto o contenere solo immagini. Riprova con «Forza OCR»."
        )
    return {
        "output": output,
        "engine": "Microsoft MarkItDown",
        "output_format": "markdown",
        "meta": {"characters": len(output)},
    }


def _docling_task(payload: dict[str, Any]) -> dict[str, Any]:
    """Convert a document with Docling. Runs inside a worker process."""
    path = Path(str(payload["path"]))
    try:
        from docling.document_converter import DocumentConverter
    except ImportError as exc:
        raise RuntimeError(
            "Il motore documentale avanzato non è installato. Apri Modelli e "
            "completa l'installazione del runtime locale."
        ) from exc
    result = DocumentConverter().convert(str(path))
    output = str(result.document.export_to_markdown() or "")
    if not output.strip():
        raise RuntimeError(
            "Nessun testo estratto da questo documento: prova con «Forza OCR»."
        )
    return {
        "output": output,
        "engine": "Docling",
        "output_format": "markdown",
        "meta": {"characters": len(output)},
    }


def convert_markitdown(
    path: Path,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    return _engine_result(
        _run_in_worker("markitdown", {"path": str(path)}, cancel_event)
    )


def convert_docling(
    path: Path,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    return _engine_result(_run_in_worker("docling", {"path": str(path)}, cancel_event))


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

    # Pages were found, which does not mean anything was read from them: a blank
    # scan produces an empty string, and saving that would give the user a file
    # of nothing marked "risultato pronto".
    if not output.strip():
        raise RuntimeError(
            "Nessun testo riconosciuto in questo documento: le pagine risultano "
            "vuote. Verifica il file o riprova con una scansione più nitida."
        )

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


def _privacy_task(payload: dict[str, Any]) -> dict[str, Any]:
    """Mask personal data in a text. Runs inside a worker process."""
    output_format = str(payload.get("output_format", "txt"))
    raw_text = payload.get("text")
    if raw_text is None:
        raw_text = Path(str(payload["path"])).read_text(
            encoding="utf-8", errors="replace"
        )
    text = str(raw_text)
    # Refused up front: there is nothing to mask, and going on would produce an
    # empty file presented as a protected document.
    if not text.strip():
        raise RuntimeError(
            "Questo file non contiene testo da mascherare: scegli un file di "
            "testo con del contenuto, oppure estrai prima il testo con «Estrai»."
        )
    opf_text, opf_spans, warning, model_ran = _opf_redact(text)
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
    if not output.strip():
        raise RuntimeError(
            "Il mascheramento non ha prodotto testo: verifica che il file "
            "contenga del contenuto leggibile e riprova."
        )
    return {
        "output": output,
        # Name the engine that actually ran: claiming the full filter when only
        # the regex rules were available would overstate the protection applied.
        "engine": (
            "Privacy Filter + rilevatori italiani"
            if model_ran
            else "Regole italiane locali (modello Privacy Filter non disponibile)"
        ),
        "output_format": output_format,
        "warnings": warnings,
        "meta": {"detected_spans": len(safe_spans)},
    }


def protect_text(
    text: str,
    output_format: str,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    return _engine_result(
        _run_in_worker(
            "privacy",
            {"text": text, "output_format": output_format},
            cancel_event,
        )
    )


def protect_file(
    path: Path,
    output_format: str,
    cancel_event: threading.Event | None = None,
) -> EngineResult:
    """Mask a text file without loading it into this server's memory first."""
    return _engine_result(
        _run_in_worker(
            "privacy",
            {"path": str(path), "output_format": output_format},
            cancel_event,
        )
    )


WORKER_TASKS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "markitdown": _markitdown_task,
    "docling": _docling_task,
    "privacy": _privacy_task,
}


def run_worker_task(engine: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Entry point used by the worker process; see engine/scripts/engine_worker.py."""
    task = WORKER_TASKS.get(engine)
    if task is None:
        raise RuntimeError(f"Motore non supportato: {engine}")
    return task(payload)


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


# --------------------------------------------------------------- input guards
#
# Everything below runs before an engine is chosen, because the routing itself
# trusts the file: a password-protected PDF looks like a scan and would be sent
# to OCR, and an archive is expanded by the conversion engine, so the cost is
# decided by what its headers declare rather than by the file the user picked.

# Formats whose first bytes are unambiguous. Media containers are left out on
# purpose: they have too many legitimate variants to judge from a signature.
_FILE_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    ".pdf": (b"%PDF",),
    ".zip": (b"PK\x03\x04", b"PK\x05\x06"),
    ".docx": (b"PK",),
    ".xlsx": (b"PK",),
    ".pptx": (b"PK",),
    ".epub": (b"PK",),
    ".odt": (b"PK",),
    ".ods": (b"PK",),
    ".odp": (b"PK",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".gif": (b"GIF8",),
    ".bmp": (b"BM",),
    ".tif": (b"II*\x00", b"MM\x00*"),
    ".tiff": (b"II*\x00", b"MM\x00*"),
}
_NESTED_ARCHIVE_SUFFIXES = {".zip", ".gz", ".bz2", ".xz", ".7z", ".rar", ".tar", ".tgz"}


def _inspect_signature(path: Path) -> None:
    expected = _FILE_SIGNATURES.get(path.suffix.lower())
    if not expected:
        return
    try:
        with path.open("rb") as handle:
            head = handle.read(16)
    except OSError as exc:
        raise RuntimeError(
            "Il file non è più leggibile: verifica che sia ancora al suo posto e riprova."
        ) from exc
    if not any(head.startswith(signature) for signature in expected):
        raise RuntimeError(
            f"Il contenuto di questo file non corrisponde all’estensione "
            f"«{path.suffix.lower()}»: correggi l’estensione o scegli un altro file."
        )


def _inspect_archive(path: Path) -> None:
    if not zipfile.is_zipfile(path):
        raise RuntimeError(
            "Questo archivio non è leggibile: potrebbe essere incompleto o "
            "protetto. Estrai i file e caricali direttamente."
        )
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
    except (OSError, zipfile.BadZipFile) as exc:
        raise RuntimeError(
            "Questo archivio non è leggibile: potrebbe essere incompleto o "
            "protetto. Estrai i file e caricali direttamente."
        ) from exc

    if any(
        Path(entry.filename).suffix.lower() in _NESTED_ARCHIVE_SUFFIXES
        for entry in entries
    ):
        # A nested archive is also how an expansion bomb hides: every layer looks
        # modest on its own, and the engine opens them one inside the other.
        raise RuntimeError(
            "Questo archivio contiene altri archivi: estrai il contenuto e "
            "carica i documenti direttamente."
        )
    if len(entries) > MAX_ARCHIVE_ENTRIES:
        raise RuntimeError(
            f"Questo archivio contiene più di {MAX_ARCHIVE_ENTRIES} file: estrai "
            "i documenti che ti servono e caricali separatamente."
        )
    expanded = sum(max(0, entry.file_size) for entry in entries)
    packed = max(1, sum(max(0, entry.compress_size) for entry in entries))
    if expanded > MAX_ARCHIVE_BYTES:
        raise RuntimeError(
            f"Aperto, questo archivio occuperebbe più di "
            f"{MAX_ARCHIVE_BYTES // (1024 * 1024 * 1024)} GB: estrai i documenti "
            "che ti servono e caricali separatamente."
        )
    if expanded > ARCHIVE_RATIO_FLOOR_BYTES and expanded / packed > MAX_ARCHIVE_RATIO:
        raise RuntimeError(
            "Questo archivio si espande in modo sproporzionato rispetto alla sua "
            "dimensione e non viene aperto: estrai i file che ti servono e "
            "caricali singolarmente."
        )


def _inspect_pdf(path: Path) -> None:
    try:
        import fitz
    except ImportError:
        # PyMuPDF belongs to the runtime; when it is missing the engines already
        # say so with their own message, and guessing here would add noise.
        return
    try:
        document = fitz.open(path)
    except Exception as exc:
        raise RuntimeError(
            "Questo PDF non può essere aperto: il file sembra danneggiato o "
            "incompleto. Verifica il documento e riprova."
        ) from exc
    try:
        if document.needs_pass:
            raise RuntimeError(
                "Questo PDF è protetto da password: rimuovi la protezione e riprova."
            )
        if document.page_count == 0:
            raise RuntimeError(
                "Questo PDF non contiene pagine: verifica il documento e riprova."
            )
    finally:
        try:
            document.close()
        except Exception:
            pass


def inspect_input(path: Path) -> None:
    """Refuse an input that cannot be processed, before any engine is loaded."""
    if not path.is_file():
        raise RuntimeError(
            "Il file selezionato non è più disponibile: controlla che non sia "
            "stato spostato o rinominato e riprova."
        )
    _inspect_signature(path)
    suffix = path.suffix.lower()
    if suffix == ".zip":
        _inspect_archive(path)
    elif suffix == ".pdf":
        _inspect_pdf(path)


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


def _require_output(result: EngineResult) -> EngineResult:
    if not result.output.strip():
        raise RuntimeError(
            "L’elaborazione non ha prodotto testo: il file potrebbe essere vuoto "
            "o contenere solo immagini. Riprova con «Forza OCR» oppure scegli un "
            "altro file."
        )
    return result


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
        result = protect_file(path, output_format, cancel_event)
    else:
        raise RuntimeError(f"Motore non supportato: {tool}")

    if output_format == "txt" and result.output_format == "markdown":
        result.output = strip_markdown(result.output)
        result.output_format = "txt"
    # Last line of defence for every engine, present and future: stripping the
    # markdown of an image-only document empties it, and an empty file must never
    # be handed over as a finished result.
    _require_output(result)
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
    # Before routing: a protected or damaged PDF would otherwise look like a scan
    # and be sent to OCR, which fails much later and with a worse message.
    inspect_input(path)
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
        result = _require_output(protect_text(text, output_format, cancel_event))
    finally:
        semaphore.release()
    result.meta.setdefault("resolved_tool", "privacy")
    result.meta.setdefault(
        "concurrency_limit",
        ENGINE_CONCURRENCY["privacy"],
    )
    return result
