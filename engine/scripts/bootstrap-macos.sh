#!/bin/zsh
set -euo pipefail

uv_version="0.12.2"
uv_sha256="fa909fea3bc06f460db79017030a221fdbc43ec4478f089cb554d8335c090817"
ollama_version="v0.32.6"
ollama_sha256="cc708ee7a9366b73b97d3f2999e25bb24b0a86feb41a0d2ced784ff4d4855e6d"
privacy_sha256="024fbe180ad5f327e3222246dad08d048dabb39d7cec5e00ee20fb8bbed66210"

verify_sha256() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || {
    echo "Checksum non valido per $(basename "$file")"
    return 1
  }
}

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
  uv_archive="$data_dir/work/uv-aarch64-apple-darwin.tar.gz"
  curl -fL "https://github.com/astral-sh/uv/releases/download/$uv_version/uv-aarch64-apple-darwin.tar.gz" -o "$uv_archive"
  verify_sha256 "$uv_archive" "$uv_sha256"
  tar -xzf "$uv_archive" -C "$uv_dir" --strip-components=1
fi
export UV_PYTHON_INSTALL_DIR="$data_dir/python"
"$uv_bin" python install 3.12 --install-dir "$UV_PYTHON_INSTALL_DIR"
[[ -x "$data_dir/.venv/bin/python" ]] || "$uv_bin" venv --python 3.12 "$data_dir/.venv"
runtime_python="$data_dir/.venv/bin/python"
echo "[2/6] Conversione, OCR e trascrizione"
"$uv_bin" pip install --python "$runtime_python" --require-hashes -r "$source_dir/requirements-runtime-macos.lock"

echo "[3/6] Traduzione PDF con layout"
translation_dir="$data_dir/tools/pdf2zh-next"
[[ -x "$translation_dir/.venv/bin/python" ]] || "$uv_bin" venv --python "$runtime_python" "$translation_dir/.venv"
"$uv_bin" pip install --python "$translation_dir/.venv/bin/python" --require-hashes -r "$source_dir/requirements-translation-macos.lock"
"$uv_bin" pip uninstall --python "$translation_dir/.venv/bin/python" gradio gradio-client gradio-i18n gradio-pdf
"$uv_bin" pip install --python "$translation_dir/.venv/bin/python" --require-hashes -r "$source_dir/requirements-translation-overrides.lock"
"$translation_dir/.venv/bin/python" - <<'PY'
from babeldoc.assets.assets import warmup
from pdf2zh_next.high_level import do_translate_async_stream  # noqa: F401
warmup()
PY

echo "[4/6] Privacy Filter locale"
privacy_source="$data_dir/tools/openai-privacy-filter"
if [[ ! -f "$privacy_source/pyproject.toml" ]]; then
  archive="$data_dir/work/privacy-filter.zip"
  curl -fL "https://github.com/openai/privacy-filter/archive/f7f00ca7fb869683eb732c010299d901457f19c3.zip" -o "$archive"
  verify_sha256 "$archive" "$privacy_sha256"
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
"$uv_bin" pip install --python "$runtime_python" --no-deps "$privacy_source"

echo "[5/6] Ollama e modelli di traduzione/OCR"
ollama_dir="$data_dir/tools/ollama"
ollama_bin="$ollama_dir/Ollama.app/Contents/Resources/ollama"
if [[ ! -x "$ollama_bin" ]]; then
  mkdir -p "$ollama_dir"
  ollama_archive="$data_dir/work/Ollama-darwin.zip"
  curl -fL "https://github.com/ollama/ollama/releases/download/$ollama_version/Ollama-darwin.zip" -o "$ollama_archive"
  verify_sha256 "$ollama_archive" "$ollama_sha256"
  ditto -x -k "$ollama_archive" "$ollama_dir"
fi
# Share Ollama's conventional per-user store instead of keeping a private copy
# inside the app container. These are official registry models of several GB: a
# machine that already has them must never download a second copy, and one that
# does not ends up with them where Ollama itself would have put them.
export OLLAMA_MODELS="${OLLAMA_MODELS:-$HOME/.ollama/models}"
mkdir -p "$OLLAMA_MODELS"

# An earlier version kept its own store; move it rather than re-downloading.
legacy_models="$data_dir/models/ollama"
if [[ -d "$legacy_models/blobs" && ! -d "$OLLAMA_MODELS/blobs" ]]; then
  echo "Riuso i modelli gia' scaricati"
  mv "$legacy_models"/* "$OLLAMA_MODELS"/ 2>/dev/null || true
fi

ensure_model() {
  # `show` succeeds only when the model is already present locally.
  if "$ollama_bin" show "$1" >/dev/null 2>&1; then
    echo "Modello gia' presente: $1"
  else
    "$ollama_bin" pull "$1"
  fi
}
if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  "$ollama_bin" serve >> "$data_dir/ollama-install.log" 2>&1 &
  ollama_pid=$!
  trap 'kill "$ollama_pid" 2>/dev/null || true' EXIT
  for _ in {1..60}; do
    curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
    sleep 1
  done
fi
ensure_model glm-ocr
ensure_model translategemma:12b

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
