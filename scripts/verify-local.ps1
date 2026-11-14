[CmdletBinding()]
param([string]$PythonPath='D:\Anaconda3\envs\ielts-coach\python.exe',[switch]$Build,[switch]$Browser)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$verificationRoot=Join-Path $projectRoot 'local-data\verification'
New-Item -ItemType Directory -Force -Path $verificationRoot | Out-Null
$env:PYTHONNOUSERSITE='1'
$env:PYTHONUTF8='1'
$env:PYTHONDONTWRITEBYTECODE='1'
Push-Location (Join-Path $projectRoot 'backend')
try {
    & $PythonPath -m ruff check --no-cache app tests scripts
    if ($LASTEXITCODE -ne 0) { throw 'Ruff failed' }
    & $PythonPath -m pytest -p no:cacheprovider --basetemp (Join-Path $verificationRoot 'backend') --junitxml (Join-Path $verificationRoot 'backend.xml')
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed' }
} finally { Pop-Location }
Push-Location (Join-Path $projectRoot 'frontend')
try {
    & npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }
    if ($Build) {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    }
    if ($Browser) {
        $env:PLAYWRIGHT_CHANNEL='msedge'
        & npx playwright test --output (Join-Path $verificationRoot 'browser-results')
        if ($LASTEXITCODE -ne 0) { throw 'Browser tests failed' }
    }
} finally { Pop-Location }
