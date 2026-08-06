from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


SOURCE_ROOT = Path(__file__).resolve().parents[2]
# Installed desktop bundles are read-only (especially below Program Files on
# Windows). Keep models, caches and temporary jobs in the per-user app data
# directory selected by the native shell.
ROOT = Path(os.getenv("LOCAL_AI_ENGINE_HOME", str(SOURCE_ROOT))).expanduser().resolve()
WORK_DIR = ROOT / "work"
JOBS_DIR = WORK_DIR / "jobs"
MODELS_DIR = ROOT / "models"
TOOLS_DIR = ROOT / "tools"

for directory in (WORK_DIR, JOBS_DIR, MODELS_DIR, TOOLS_DIR):
    directory.mkdir(parents=True, exist_ok=True)

# Keep third-party caches inside the project instead of writing to ~/.paddlex or
# ~/.cache. These variables must be set before importing PaddleX/Transformers.
os.environ.setdefault(
    "PADDLE_PDX_CACHE_HOME", str(MODELS_DIR / "paddlex")
)
os.environ.setdefault("HF_HOME", str(MODELS_DIR / "huggingface"))
os.environ.setdefault("DOCLING_CACHE_DIR", str(MODELS_DIR / "docling-cache"))
os.environ.setdefault("DOCLING_ARTIFACTS_PATH", str(MODELS_DIR / "docling"))

# Zero means unlimited. Uploads are streamed to the project work directory, so
# multi-gigabyte media never needs to be held in memory. A custom safety cap can
# still be configured through LOCAL_AI_MAX_FILE_BYTES.
MAX_FILE_BYTES = int(os.getenv("LOCAL_AI_MAX_FILE_BYTES", "0"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
PADDLE_ENGINE = os.getenv("PADDLEOCR_ENGINE", "transformers")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "glm-ocr")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
PDF_TRANSLATION_MODEL = os.getenv(
    "PDF_TRANSLATION_MODEL", "translategemma:12b"
)


def venv_binary(venv: Path, name: str) -> Path:
    """Return the conventional executable path for the current platform."""
    if os.name == "nt":
        suffix = "" if name.lower().endswith((".exe", ".bat", ".cmd")) else ".exe"
        return venv / "Scripts" / f"{name}{suffix}"
    return venv / "bin" / name


PDF2ZH_CLI = Path(
    os.getenv(
        "PDF2ZH_CLI",
        str(venv_binary(TOOLS_DIR / "pdf2zh-next" / ".venv", "pdf2zh_next")),
    )
)
PDF_TRANSLATION_WORKER = Path(
    os.getenv(
        "PDF_TRANSLATION_WORKER",
        str(SOURCE_ROOT / "scripts" / "pdf_translation_worker.py"),
    )
)
OPF_CHECKPOINT = os.getenv(
    "OPF_CHECKPOINT", str(MODELS_DIR / "privacy-filter")
)

PROJECT_OLLAMA_CANDIDATES = (
    TOOLS_DIR / "ollama" / "ollama.exe",
    TOOLS_DIR / "ollama" / "ollama",
    TOOLS_DIR / "ollama" / "Ollama.app" / "Contents" / "Resources" / "ollama",
)


def find_binary(name: str) -> str | None:
    if name == "pdf2zh_next" and PDF2ZH_CLI.exists():
        return str(PDF2ZH_CLI)
    if name == "ollama":
        for candidate in PROJECT_OLLAMA_CANDIDATES:
            if candidate.is_file():
                return str(candidate)
    project_binary = venv_binary(ROOT / ".venv", name)
    if project_binary.is_file():
        return str(project_binary)
    # A Windows console-script can be emitted as .cmd instead of .exe.
    if os.name == "nt":
        cmd_binary = project_binary.with_suffix(".cmd")
        if cmd_binary.is_file():
            return str(cmd_binary)
    return shutil.which(name)


def python_executable(venv: Path) -> Path:
    candidate = venv_binary(venv, "python")
    return candidate if candidate.is_file() else Path(sys.executable)
