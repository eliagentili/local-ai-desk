from __future__ import annotations

import os
import re
import shutil
import signal
import tempfile
import threading
import time
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse
from starlette.requests import ClientDisconnect

from .config import JOBS_DIR, MAX_FILE_BYTES, WORK_DIR
from .engines import (
    EngineResult,
    ProcessingCancelled,
    cancel_all_translation_processes,
    engine_status,
    process_file,
    process_pdf_translation,
    process_text,
)


app = FastAPI(
    title="Local AI Desk",
    version="1.2.0",
    description="Backend locale per sei motori AI.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3010",
        "http://127.0.0.1:3010",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=[
        "Content-Disposition",
        "X-Local-Engine",
        "X-Elapsed-Seconds",
        "X-Translation-Mode",
    ],
)

ALLOWED_TOOLS = {
    "auto",
    "markitdown",
    "paddleocr",
    "glmocr",
    "faster-whisper",
    "privacy",
}
ALLOWED_FORMATS = {"markdown", "txt", "srt", "json"}
TRANSLATION_LANGUAGES = {
    "en", "it", "es", "fr", "de", "pt", "nl", "pl", "ru", "uk",
    "ar", "zh-CN", "ja", "ko", "hi", "tr",
}
TRANSLATION_MODES = {"translated", "bilingual"}
UPLOAD_SUFFIXES = {
    ".aac": ".aac",
    ".avi": ".avi",
    ".bmp": ".bmp",
    ".csv": ".csv",
    ".doc": ".doc",
    ".docx": ".docx",
    ".eml": ".eml",
    ".epub": ".epub",
    ".flac": ".flac",
    ".gif": ".gif",
    ".htm": ".htm",
    ".html": ".html",
    ".jpeg": ".jpeg",
    ".jpg": ".jpg",
    ".json": ".json",
    ".log": ".log",
    ".m4a": ".m4a",
    ".m4v": ".m4v",
    ".md": ".md",
    ".mkv": ".mkv",
    ".mov": ".mov",
    ".mp3": ".mp3",
    ".mp4": ".mp4",
    ".msg": ".msg",
    ".odp": ".odp",
    ".ods": ".ods",
    ".odt": ".odt",
    ".ogg": ".ogg",
    ".pdf": ".pdf",
    ".png": ".png",
    ".ppt": ".ppt",
    ".pptx": ".pptx",
    ".rtf": ".rtf",
    ".tif": ".tif",
    ".tiff": ".tiff",
    ".toml": ".toml",
    ".tsv": ".tsv",
    ".txt": ".txt",
    ".wav": ".wav",
    ".webm": ".webm",
    ".webp": ".webp",
    ".xls": ".xls",
    ".xlsx": ".xlsx",
    ".xml": ".xml",
    ".yaml": ".yaml",
    ".yml": ".yml",
    ".zip": ".zip",
}
LAUNCHER_PID_FILE = WORK_DIR / "local-ai-desk.pid"

_JOB_EVENTS: dict[str, threading.Event] = {}
_JOB_PROGRESS: dict[str, dict[str, object]] = {}
_JOB_LOCK = threading.Lock()
_JOB_PROGRESS_TTL_SECONDS = 30 * 60


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "local_only": True,
        "streaming_uploads": True,
        "max_file_bytes": MAX_FILE_BYTES or None,
    }


@app.get("/api/status")
def status():
    payload = engine_status()
    payload["streaming_uploads"] = True
    payload["max_file_bytes"] = MAX_FILE_BYTES or None
    return payload


def safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(name).name).strip("-")
    return "input.bin" if cleaned in {"", ".", ".."} else cleaned


def upload_storage_path(directory: Path, filename: str) -> Path:
    """Create a server-owned path without copying user input into the path."""
    requested_suffix = Path(filename).suffix.lower()
    storage_suffix = UPLOAD_SUFFIXES.get(requested_suffix, ".bin")
    return directory.resolve() / f"{uuid4().hex}{storage_suffix}"


def extension_for(output_format: str) -> str:
    return {
        "markdown": "md",
        "txt": "txt",
        "srt": "srt",
        "json": "json",
    }.get(output_format, "txt")


def validate_options(tool: str, output_format: str) -> None:
    if tool not in ALLOWED_TOOLS:
        raise HTTPException(400, f"Motore non riconosciuto: {tool}")
    if output_format not in ALLOWED_FORMATS:
        raise HTTPException(400, "Formato risultato non supportato.")


def validate_size(size: int) -> None:
    if MAX_FILE_BYTES > 0 and size > MAX_FILE_BYTES:
        raise HTTPException(
            413,
            f"Il file supera il limite locale di "
            f"{MAX_FILE_BYTES // (1024 * 1024)} MB.",
        )


def register_job(requested_id: str) -> tuple[str, threading.Event]:
    job_id = requested_id if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", requested_id) else uuid4().hex
    now = time.time()
    with _JOB_LOCK:
        expired = [
            known_id
            for known_id, payload in _JOB_PROGRESS.items()
            if now - float(payload.get("updated_at", now)) > _JOB_PROGRESS_TTL_SECONDS
        ]
        for known_id in expired:
            _JOB_PROGRESS.pop(known_id, None)
        if job_id in _JOB_EVENTS:
            raise HTTPException(409, "Questo lavoro è già attivo.")
        event = threading.Event()
        _JOB_EVENTS[job_id] = event
        _JOB_PROGRESS[job_id] = {
            "job_id": job_id,
            "state": "queued",
            "progress": 0.0,
            "stage": "Queued",
            "stage_label": "In coda",
            "stage_progress": 0.0,
            "stage_current": 0,
            "stage_total": 0,
            "part_index": 1,
            "total_parts": 1,
            "updated_at": now,
        }
    return job_id, event


def unregister_job(job_id: str) -> None:
    with _JOB_LOCK:
        _JOB_EVENTS.pop(job_id, None)


def update_job_progress(job_id: str, **updates: object) -> None:
    with _JOB_LOCK:
        payload = _JOB_PROGRESS.get(job_id)
        if payload is None:
            return
        payload.update(updates)
        payload["updated_at"] = time.time()


@app.get("/api/jobs/{job_id}/status")
def job_status(job_id: str, response: Response):
    with _JOB_LOCK:
        payload = _JOB_PROGRESS.get(job_id)
        snapshot = dict(payload) if payload is not None else None
    if snapshot is None:
        raise HTTPException(404, "Lavoro non trovato.")
    response.headers["Cache-Control"] = "no-store"
    return snapshot


def raise_if_cancelled(cancel_event: threading.Event) -> None:
    if cancel_event.is_set():
        raise ProcessingCancelled("Elaborazione annullata dall’utente.")


def response_payload(
    result: EngineResult,
    stem: str,
    output_format: str,
    started: float,
) -> dict[str, object]:
    result_format = result.output_format or output_format
    return {
        "output": result.output,
        "format": result_format,
        "filename": f"{stem}.{extension_for(result_format)}",
        "engine": result.engine,
        "elapsed_seconds": time.perf_counter() - started,
        "warnings": result.warnings,
        "meta": result.meta,
    }


def local_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ProcessingCancelled):
        return HTTPException(499, str(exc))
    if isinstance(exc, RuntimeError):
        return HTTPException(503, str(exc))
    if isinstance(exc, OSError) and getattr(exc, "errno", None) == 28:
        return HTTPException(507, "Spazio su disco insufficiente per salvare il file.")
    return HTTPException(
        500,
        f"Errore locale durante l’elaborazione: {type(exc).__name__}: {exc}",
    )


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    with _JOB_LOCK:
        event = _JOB_EVENTS.get(job_id)
        if event is not None:
            event.set()
    if event is not None:
        update_job_progress(
            job_id,
            state="cancelling",
            stage="Cancelling",
            stage_label="Interruzione in corso",
        )
    return {"job_id": job_id, "cancelled": event is not None}


@app.on_event("shutdown")
def stop_child_processes() -> None:
    with _JOB_LOCK:
        events = list(_JOB_EVENTS.values())
    for event in events:
        event.set()
    cancel_all_translation_processes()


@app.post("/api/translate-pdf")
async def translate_streamed_pdf(
    request: Request,
    source_language: str = "en",
    target_language: str = "it",
    mode: str = "translated",
    filename: str = "documento.pdf",
    job_id: str = "",
):
    if source_language not in TRANSLATION_LANGUAGES:
        raise HTTPException(400, "Lingua sorgente non supportata.")
    if target_language not in TRANSLATION_LANGUAGES:
        raise HTTPException(400, "Lingua di destinazione non supportata.")
    if source_language == target_language:
        raise HTTPException(400, "Scegli due lingue diverse.")
    if mode not in TRANSLATION_MODES:
        raise HTTPException(400, "Tipo di PDF tradotto non supportato.")

    active_job_id, cancel_event = register_job(job_id)
    update_job_progress(
        active_job_id,
        state="uploading",
        progress=0.5,
        stage="Upload",
        stage_label="Caricamento del PDF",
    )
    started = time.perf_counter()
    raw_job = tempfile.mkdtemp(prefix="translation-", dir=JOBS_DIR)
    job_dir = Path(raw_job)
    keep_until_sent = False
    try:
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit():
            validate_size(int(content_length))

        source_name = safe_name(filename)
        if Path(source_name).suffix.lower() != ".pdf":
            raise HTTPException(400, "Seleziona un file PDF.")
        source = upload_storage_path(job_dir, "document.pdf")
        size = 0
        expected_size = (
            int(content_length)
            if content_length and content_length.isdigit()
            else 0
        )
        last_upload_progress = 0.0
        with source.open("wb") as destination:
            async for chunk in request.stream():
                raise_if_cancelled(cancel_event)
                if not chunk:
                    continue
                size += len(chunk)
                validate_size(size)
                destination.write(chunk)
                if expected_size:
                    upload_progress = min(3.5, size / expected_size * 3.5)
                    if upload_progress - last_upload_progress >= 0.2:
                        update_job_progress(
                            active_job_id,
                            progress=round(upload_progress, 2),
                            stage_progress=round(
                                min(100.0, size / expected_size * 100), 2
                            ),
                            stage_current=size,
                            stage_total=expected_size,
                        )
                        last_upload_progress = upload_progress
        raise_if_cancelled(cancel_event)
        update_job_progress(
            active_job_id,
            state="preparing",
            progress=4.0,
            stage="Warmup",
            stage_label="Preparazione del motore locale",
            stage_progress=0.0,
            stage_current=0,
            stage_total=0,
        )

        def report_translation_progress(payload: dict[str, object]) -> None:
            safe_payload = {
                key: value
                for key, value in payload.items()
                if key
                in {
                    "state",
                    "progress",
                    "stage",
                    "stage_label",
                    "stage_progress",
                    "stage_current",
                    "stage_total",
                    "part_index",
                    "total_parts",
                }
            }
            update_job_progress(active_job_id, **safe_payload)

        result = await run_in_threadpool(
            process_pdf_translation,
            source,
            job_dir / "output",
            source_language,
            target_language,
            mode,
            cancel_event,
            report_translation_progress,
        )
        result.filename = (
            f"{Path(source_name).stem}.{target_language}."
            f"{'tradotto' if mode == 'translated' else 'bilingue'}.pdf"
        )
        elapsed = time.perf_counter() - started
        update_job_progress(
            active_job_id,
            state="completed",
            progress=100.0,
            stage="Completed",
            stage_label="PDF pronto",
            stage_progress=100.0,
            stage_current=1,
            stage_total=1,
        )
        keep_until_sent = True
        return FileResponse(
            result.path,
            media_type="application/pdf",
            filename=result.filename,
            headers={
                "X-Local-Engine": result.engine,
                "X-Elapsed-Seconds": f"{elapsed:.6f}",
                "X-Translation-Mode": mode,
            },
            background=BackgroundTask(shutil.rmtree, job_dir, ignore_errors=True),
        )
    except HTTPException as exc:
        update_job_progress(
            active_job_id,
            state="error",
            stage="Error",
            stage_label="Traduzione non riuscita",
            error=str(exc.detail),
        )
        raise
    except ClientDisconnect as exc:
        cancel_event.set()
        update_job_progress(
            active_job_id,
            state="cancelled",
            stage="Cancelled",
            stage_label="Upload annullato",
        )
        raise HTTPException(499, "Upload annullato dal browser.") from exc
    except Exception as exc:
        update_job_progress(
            active_job_id,
            state="cancelled" if isinstance(exc, ProcessingCancelled) else "error",
            stage="Cancelled" if isinstance(exc, ProcessingCancelled) else "Error",
            stage_label=(
                "Traduzione annullata"
                if isinstance(exc, ProcessingCancelled)
                else "Traduzione non riuscita"
            ),
        )
        raise local_error(exc) from exc
    finally:
        unregister_job(active_job_id)
        if not keep_until_sent:
            shutil.rmtree(job_dir, ignore_errors=True)


@app.post("/api/process-file")
async def process_streamed_file(
    request: Request,
    tool: str = "auto",
    output_format: str = "markdown",
    language: str = "auto",
    filename: str = "input.bin",
    job_id: str = "",
):
    """Stream a file straight to disk before running the selected local engine."""
    validate_options(tool, output_format)
    active_job_id, cancel_event = register_job(job_id)
    started = time.perf_counter()
    try:
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit():
            validate_size(int(content_length))

        source_name = safe_name(filename)
        with tempfile.TemporaryDirectory(prefix="job-", dir=JOBS_DIR) as raw_job:
            source = upload_storage_path(Path(raw_job), filename)
            size = 0
            with source.open("wb") as destination:
                async for chunk in request.stream():
                    raise_if_cancelled(cancel_event)
                    if not chunk:
                        continue
                    size += len(chunk)
                    validate_size(size)
                    destination.write(chunk)

            raise_if_cancelled(cancel_event)
            result = await run_in_threadpool(
                process_file,
                source,
                tool,
                output_format,
                language,
                cancel_event,
            )
            result.meta.setdefault("input_bytes", size)
            result.meta.setdefault("streamed_upload", True)
            return response_payload(
                result, Path(source_name).stem, output_format, started
            )
    except HTTPException:
        raise
    except ClientDisconnect as exc:
        cancel_event.set()
        raise HTTPException(499, "Upload annullato dal browser.") from exc
    except Exception as exc:
        raise local_error(exc) from exc
    finally:
        unregister_job(active_job_id)


@app.post("/api/process")
async def process(
    tool: str = Form("auto"),
    output_format: str = Form("markdown"),
    language: str = Form("auto"),
    text: str = Form(""),
    job_id: str = Form(""),
    file: UploadFile | None = File(None),
):
    """Compatibility endpoint for pasted text and smaller multipart clients."""
    validate_options(tool, output_format)
    if not file and not (tool == "privacy" and text.strip()):
        raise HTTPException(400, "Seleziona un file da elaborare.")

    active_job_id, cancel_event = register_job(job_id)
    started = time.perf_counter()
    try:
        if tool == "privacy" and text.strip() and not file:
            result = await run_in_threadpool(
                process_text,
                text,
                output_format,
                cancel_event,
            )
            stem = "testo-protetto"
        else:
            assert file is not None
            source_name = safe_name(file.filename or "input.bin")
            with tempfile.TemporaryDirectory(prefix="job-", dir=JOBS_DIR) as raw_job:
                source = upload_storage_path(
                    Path(raw_job), file.filename or "input.bin"
                )
                size = 0
                with source.open("wb") as destination:
                    while chunk := await file.read(1024 * 1024):
                        raise_if_cancelled(cancel_event)
                        size += len(chunk)
                        validate_size(size)
                        destination.write(chunk)
                result = await run_in_threadpool(
                    process_file,
                    source,
                    tool,
                    output_format,
                    language,
                    cancel_event,
                )
                stem = Path(source_name).stem
        return response_payload(result, stem, output_format, started)
    except HTTPException:
        raise
    except Exception as exc:
        raise local_error(exc) from exc
    finally:
        unregister_job(active_job_id)


def terminate_launcher(pid: int) -> None:
    time.sleep(0.4)
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass


@app.post("/api/shutdown", status_code=202)
def shutdown(background_tasks: BackgroundTasks):
    try:
        pid = int(LAUNCHER_PID_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError) as exc:
        raise HTTPException(409, "Il processo principale non è stato rilevato.") from exc
    if pid <= 1:
        raise HTTPException(409, "Identificativo del processo non valido.")
    background_tasks.add_task(terminate_launcher, pid)
    return {"stopping": True}
