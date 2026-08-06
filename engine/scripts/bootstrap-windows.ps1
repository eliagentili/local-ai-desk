param(
  [Parameter(Mandatory = $true)][string]$SourceDir,
  [Parameter(Mandatory = $true)][string]$DataDir
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$UvVersion = "0.12.2"
$UvSha256 = "01442d8ce5c7124151a73e697c836d252c6da853c18c73206d3cc4c2378a91d2"
$OllamaVersion = "v0.32.6"
$OllamaSha256 = "756dd7e41fbde34b8869bd7106d626d913a566cce4d0a95a61aa0579f455ddbc"
$PrivacySha256 = "024fbe180ad5f327e3222246dad08d048dabb39d7cec5e00ee20fb8bbed66210"

function Assert-Sha256 {
  param([string]$Path, [string]$Expected)
  $Actual = (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected.ToLowerInvariant()) {
    throw "Checksum non valido per $([IO.Path]::GetFileName($Path))"
  }
}

if (-not (Test-Path (Join-Path $SourceDir "backend"))) {
  throw "Pacchetto del runtime non valido"
}
New-Item -ItemType Directory -Force -Path $DataDir, (Join-Path $DataDir "tools"), (Join-Path $DataDir "models"), (Join-Path $DataDir "work") | Out-Null
$ReadyFile = Join-Path $DataDir ".ready"
Remove-Item -Force -ErrorAction SilentlyContinue $ReadyFile

Write-Output "[1/6] Ambiente Python locale"
$UvDir = Join-Path $DataDir "tools\uv"
$UvBin = Join-Path $UvDir "uv.exe"
if (-not (Test-Path $UvBin)) {
  New-Item -ItemType Directory -Force -Path $UvDir | Out-Null
  $UvArchive = Join-Path $DataDir "work\uv-x86_64-pc-windows-msvc.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip" -OutFile $UvArchive
  Assert-Sha256 -Path $UvArchive -Expected $UvSha256
  Expand-Archive -Path $UvArchive -DestinationPath $UvDir -Force
}
if (-not (Test-Path $UvBin)) {
  throw "Il bootstrap ufficiale di uv non ha prodotto uv.exe"
}
$env:UV_PYTHON_INSTALL_DIR = Join-Path $DataDir "python"
& $UvBin python install 3.12 --install-dir $env:UV_PYTHON_INSTALL_DIR
$RuntimePython = Join-Path $DataDir ".venv\Scripts\python.exe"
if (-not (Test-Path $RuntimePython)) {
  & $UvBin venv --python 3.12 (Join-Path $DataDir ".venv")
}
Write-Output "[2/6] Conversione, OCR e trascrizione"
& $UvBin pip install --python $RuntimePython --require-hashes -r (Join-Path $SourceDir "requirements-runtime-windows.lock")

Write-Output "[3/6] Traduzione PDF con layout"
$TranslationDir = Join-Path $DataDir "tools\pdf2zh-next"
$TranslationPython = Join-Path $TranslationDir ".venv\Scripts\python.exe"
if (-not (Test-Path $TranslationPython)) {
  & $UvBin venv --python $RuntimePython (Join-Path $TranslationDir ".venv")
}
& $UvBin pip install --python $TranslationPython --require-hashes -r (Join-Path $SourceDir "requirements-translation-windows.lock")
& $UvBin pip uninstall --python $TranslationPython gradio gradio-client gradio-i18n gradio-pdf
& $UvBin pip install --python $TranslationPython --require-hashes -r (Join-Path $SourceDir "requirements-translation-overrides.lock")
& $TranslationPython -c "from babeldoc.assets.assets import warmup; from pdf2zh_next.high_level import do_translate_async_stream; warmup()"

Write-Output "[4/6] Privacy Filter locale"
$PrivacySource = Join-Path $DataDir "tools\openai-privacy-filter"
if (-not (Test-Path (Join-Path $PrivacySource "pyproject.toml"))) {
  $PrivacyArchive = Join-Path $DataDir "work\privacy-filter.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/openai/privacy-filter/archive/f7f00ca7fb869683eb732c010299d901457f19c3.zip" -OutFile $PrivacyArchive
  Assert-Sha256 -Path $PrivacyArchive -Expected $PrivacySha256
  $Staging = Join-Path $DataDir "work\privacy-filter-source"
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Staging
  Expand-Archive -Path $PrivacyArchive -DestinationPath $Staging -Force
  $Extracted = Get-ChildItem -Directory $Staging | Select-Object -First 1
  Copy-Item -Recurse -Force $Extracted.FullName $PrivacySource
}
& $UvBin pip install --python $RuntimePython --no-deps $PrivacySource

Write-Output "[5/6] Ollama e modelli di traduzione/OCR"
$OllamaDir = Join-Path $DataDir "tools\ollama"
$OllamaBin = Join-Path $OllamaDir "ollama.exe"
if (-not (Test-Path $OllamaBin)) {
  New-Item -ItemType Directory -Force -Path $OllamaDir | Out-Null
  $OllamaArchive = Join-Path $DataDir "work\ollama-windows-amd64.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/ollama/ollama/releases/download/$OllamaVersion/ollama-windows-amd64.zip" -OutFile $OllamaArchive
  Assert-Sha256 -Path $OllamaArchive -Expected $OllamaSha256
  Expand-Archive -Path $OllamaArchive -DestinationPath $OllamaDir -Force
}
$env:OLLAMA_MODELS = Join-Path $DataDir "models\ollama"
New-Item -ItemType Directory -Force -Path $env:OLLAMA_MODELS | Out-Null
$OllamaWasRunning = $false
try {
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:11434/api/tags" | Out-Null
  $OllamaWasRunning = $true
} catch {}
if (-not $OllamaWasRunning) {
  $OllamaProcess = Start-Process -FilePath $OllamaBin -ArgumentList "serve" -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $DataDir "ollama-install.log") -RedirectStandardError (Join-Path $DataDir "ollama-install-error.log")
  for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
    Start-Sleep -Seconds 1
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:11434/api/tags" | Out-Null
      break
    } catch {}
  }
}
& $OllamaBin pull glm-ocr
& $OllamaBin pull translategemma:12b

Write-Output "[6/6] Modelli documentali e audio"
Push-Location $DataDir
try {
  & $RuntimePython -c 'from faster_whisper import WhisperModel; WhisperModel("small", device="cpu", compute_type="int8", download_root="models/faster-whisper")'
  $DoclingTools = Join-Path $DataDir ".venv\Scripts\docling-tools.exe"
  & $DoclingTools models download --output-dir (Join-Path $DataDir "models\docling")
} finally {
  Pop-Location
  if ((-not $OllamaWasRunning) -and ($null -ne $OllamaProcess)) {
    Stop-Process -Id $OllamaProcess.Id -Force -ErrorAction SilentlyContinue
  }
}

"runtime=1`ninstalled_at=$([DateTime]::UtcNow.ToString('o'))" | Set-Content -Encoding UTF8 $ReadyFile
Write-Output "Installazione completata"
