param(
  [Parameter(Mandatory = $true)][string]$SourceDir,
  [Parameter(Mandatory = $true)][string]$DataDir
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

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
  $env:UV_UNMANAGED_INSTALL = $UvDir
  $env:UV_NO_MODIFY_PATH = "1"
  Invoke-RestMethod -UseBasicParsing "https://astral.sh/uv/install.ps1" | Invoke-Expression
}
if (-not (Test-Path $UvBin)) {
  throw "Il bootstrap ufficiale di uv non ha prodotto uv.exe"
}
$env:UV_PYTHON_INSTALL_DIR = Join-Path $DataDir "python"
& $UvBin python install 3.12 --install-dir $env:UV_PYTHON_INSTALL_DIR
$RuntimePython = Join-Path $DataDir ".venv\Scripts\python.exe"
if (-not (Test-Path $RuntimePython)) {
  & $UvBin venv --seed --python 3.12 (Join-Path $DataDir ".venv")
}
& $RuntimePython -m pip install --upgrade pip wheel setuptools
& $RuntimePython -m pip install -r (Join-Path $SourceDir "requirements-core.txt")

Write-Output "[2/6] Conversione, OCR e trascrizione"
& $RuntimePython -m pip install -r (Join-Path $SourceDir "requirements-tools.txt")
& $RuntimePython -m pip install -r (Join-Path $SourceDir "requirements-paddle.txt")

Write-Output "[3/6] Traduzione PDF con layout"
$TranslationDir = Join-Path $DataDir "tools\pdf2zh-next"
$TranslationPython = Join-Path $TranslationDir ".venv\Scripts\python.exe"
if (-not (Test-Path $TranslationPython)) {
  & $RuntimePython -m venv (Join-Path $TranslationDir ".venv")
}
& $TranslationPython -m pip install --upgrade pip
& $TranslationPython -m pip install "pdf2zh-next==2.9.0"
& $TranslationPython -c "from babeldoc.assets.assets import warmup; warmup()"

Write-Output "[4/6] Privacy Filter locale"
$PrivacySource = Join-Path $DataDir "tools\openai-privacy-filter"
if (-not (Test-Path (Join-Path $PrivacySource "pyproject.toml"))) {
  $PrivacyArchive = Join-Path $DataDir "work\privacy-filter.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/openai/privacy-filter/archive/f7f00ca7fb869683eb732c010299d901457f19c3.zip" -OutFile $PrivacyArchive
  $Staging = Join-Path $DataDir "work\privacy-filter-source"
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Staging
  Expand-Archive -Path $PrivacyArchive -DestinationPath $Staging -Force
  $Extracted = Get-ChildItem -Directory $Staging | Select-Object -First 1
  Copy-Item -Recurse -Force $Extracted.FullName $PrivacySource
}
& $RuntimePython -m pip install $PrivacySource

Write-Output "[5/6] Ollama e modelli di traduzione/OCR"
$OllamaDir = Join-Path $DataDir "tools\ollama"
$OllamaBin = Join-Path $OllamaDir "ollama.exe"
if (-not (Test-Path $OllamaBin)) {
  New-Item -ItemType Directory -Force -Path $OllamaDir | Out-Null
  $OllamaArchive = Join-Path $DataDir "work\ollama-windows-amd64.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "https://ollama.com/download/ollama-windows-amd64.zip" -OutFile $OllamaArchive
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
