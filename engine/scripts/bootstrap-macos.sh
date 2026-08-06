#!/bin/zsh
set -euo pipefail

source_dir=""
data_dir=""
while (( $# > 0 )); do
  case "$1" in
    --source) source_dir="$2"; shift 2 ;;
    --data) data_dir="$2"; shift 2 ;;
    *) echo "Argomento non riconosciuto: $1"; exit 2 ;;
  esac
done

[[ -d "$source_dir/backend" && -n "$data_dir" ]] || {
  echo "Percorsi del runtime non validi"
  exit 2
}

mkdir -p "$data_dir" "$data_dir/tools" "$data_dir/models" "$data_dir/work"
rm -f "$data_dir/.ready"

echo "[1/6] Ambiente Python locale"
uv_dir="$data_dir/tools/uv"
uv_bin="$uv_dir/uv"
if [[ ! -x "$uv_bin" ]]; then
  mkdir -p "$uv_dir"
  curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$uv_dir" sh
fi
export UV_PYTHON_INSTALL_DIR="$data_dir/python"
"$uv_bin" python install 3.12 --install-dir "$UV_PYTHON_INSTALL_DIR"
[[ -x "$data_dir/.venv/bin/python" ]] || "$uv_bin" venv --seed --python 3.12 "$data_dir/.venv"
runtime_python="$data_dir/.venv/bin/python"
"$runtime_python" -m pip install --upgrade pip wheel setuptools
"$runtime_python" -m pip install -r "$source_dir/requirements-core.txt"

echo "[2/6] Conversione, OCR e trascrizione"
"$runtime_python" -m pip install -r "$source_dir/requirements-tools.txt"
"$runtime_python" -m pip install -r "$source_dir/requirements-paddle.txt"

echo "[3/6] Traduzione PDF con layout"
translation_dir="$data_dir/tools/pdf2zh-next"
[[ -x "$translation_dir/.venv/bin/python" ]] || "$runtime_python" -m venv "$translation_dir/.venv"
"$translation_dir/.venv/bin/python" -m pip install --upgrade pip
"$translation_dir/.venv/bin/python" -m pip install "pdf2zh-next==2.9.0"
"$translation_dir/.venv/bin/python" - <<'PY'
from babeldoc.assets.assets import warmup
warmup()
PY

echo "[4/6] Privacy Filter locale"
privacy_source="$data_dir/tools/openai-privacy-filter"
if [[ ! -f "$privacy_source/pyproject.toml" ]]; then
  archive="$data_dir/work/privacy-filter.zip"
  curl -fL "https://github.com/openai/privacy-filter/archive/f7f00ca7fb869683eb732c010299d901457f19c3.zip" -o "$archive"
  "$runtime_python" - "$archive" "$privacy_source" <<'PY'
import shutil, sys, tempfile, zipfile
from pathlib import Path
archive, destination = Path(sys.argv[1]), Path(sys.argv[2])
with tempfile.TemporaryDirectory() as temporary:
    with zipfile.ZipFile(archive) as source:
        source.extractall(temporary)
    root = next(Path(temporary).iterdir())
    shutil.copytree(root, destination, dirs_exist_ok=True)
PY
fi
"$runtime_python" -m pip install "$privacy_source"

echo "[5/6] Ollama e modelli di traduzione/OCR"
ollama_dir="$data_dir/tools/ollama"
ollama_bin="$ollama_dir/Ollama.app/Contents/Resources/ollama"
if [[ ! -x "$ollama_bin" ]]; then
  mkdir -p "$ollama_dir"
  curl -fL "https://ollama.com/download/Ollama-darwin.zip" -o "$data_dir/work/Ollama-darwin.zip"
  ditto -x -k "$data_dir/work/Ollama-darwin.zip" "$ollama_dir"
fi
export OLLAMA_MODELS="$data_dir/models/ollama"
mkdir -p "$OLLAMA_MODELS"
if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  "$ollama_bin" serve >> "$data_dir/ollama-install.log" 2>&1 &
  ollama_pid=$!
  trap 'kill "$ollama_pid" 2>/dev/null || true' EXIT
  for _ in {1..60}; do
    curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
    sleep 1
  done
fi
"$ollama_bin" pull glm-ocr
"$ollama_bin" pull translategemma:12b

echo "[6/6] Modelli documentali e audio"
cd "$data_dir"
"$runtime_python" - <<'PY'
from faster_whisper import WhisperModel
WhisperModel("small", device="cpu", compute_type="int8", download_root="models/faster-whisper")
PY
DOCLING_CACHE_DIR="$data_dir/models/docling-cache" \
  "$data_dir/.venv/bin/docling-tools" models download --output-dir "$data_dir/models/docling"

printf 'runtime=1\ninstalled_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$data_dir/.ready"
echo "Installazione completata"
