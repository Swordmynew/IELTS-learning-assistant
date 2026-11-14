[CmdletBinding()]
param(
    [string]$PythonPath = 'D:\Anaconda3\envs\ielts-coach\python.exe',
    [switch]$BackendOnly,
    [switch]$FrontendOnly
)
$ErrorActionPreference = 'Stop'
if ($BackendOnly -and $FrontendOnly) { throw 'Choose either -BackendOnly or -FrontendOnly.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot 'local-data\runtime'
$backendRoot = Join-Path $projectRoot 'backend'
$frontendRoot = Join-Path $projectRoot 'frontend'
if (-not (Test-Path -LiteralPath $PythonPath)) { throw "Conda interpreter not found: $PythonPath" }
$nextPath = Join-Path $frontendRoot 'node_modules\next\dist\bin\next'
$nodePath = $null
if (-not $BackendOnly) {
    if (-not (Test-Path -LiteralPath $nextPath)) { throw 'Run npm ci in frontend first.' }
    $nodePath = (Get-Command node -ErrorAction Stop).Source
}
if (-not $FrontendOnly -and -not (Test-Path -LiteralPath (Join-Path $backendRoot 'app\data\vocabulary\starter.json'))) {
    throw 'Run backend/scripts/import_starter_vocabulary.py with the selected Conda interpreter first.'
}
$ports = @()
if (-not $FrontendOnly) { $ports += 8000 }
if (-not $BackendOnly) { $ports += 3000 }
foreach ($port in $ports) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "Port $port is occupied. Open the existing preview, or use -FrontendOnly / -BackendOnly to start its missing service."
    }
}
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$statePath = Join-Path $runtimeRoot 'processes.json'
$previous = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
$state = @{ api=$previous.api; web=$previous.web; url='http://127.0.0.1:3000'; offline=$true; database='local-data/runtime/preview.db'; source_commit=(& git -C $projectRoot rev-parse HEAD) }
$env:TEMP = Join-Path $runtimeRoot 'process-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
if (-not $FrontendOnly) {
    $secretPath = Join-Path $runtimeRoot 'jwt-secret.local'
    if (-not (Test-Path -LiteralPath $secretPath)) {
        ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')) | Set-Content -LiteralPath $secretPath -Encoding ascii
    }
    $env:PYTHONNOUSERSITE = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $env:PYTHONUTF8 = '1'
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:APP_ENV = 'development'
    $env:LEARNING_TIMEZONE = 'Asia/Shanghai'
    $dbPath = (Join-Path $runtimeRoot 'preview.db').Replace('\', '/')
    $env:DATABASE_URL = "sqlite+aiosqlite:///$dbPath"
    $env:UPLOAD_DIR = Join-Path $runtimeRoot 'uploads'
    $env:FASTEMBED_CACHE_PATH = Join-Path $runtimeRoot 'cache\fastembed'
    $env:HUGGINGFACE_CACHE_PATH = Join-Path $runtimeRoot 'cache\huggingface'
    $env:HF_HOME = $env:HUGGINGFACE_CACHE_PATH
    $env:COACH_API_KEY = ''
    $env:OPENAI_API_KEY = ''
    $env:EMBEDDING_API_KEY = ''
    $env:COACH_OFFLINE = 'true'
    $env:LLM_PROVIDER = 'offline'
    $env:EMBEDDING_PROVIDER = 'hashing'
    $env:VOCABULARY_WORKER_ENABLED = 'true'
    $env:REDIS_URL = 'redis://127.0.0.1:1/0'
    $env:CORS_ORIGINS = 'http://127.0.0.1:3000,http://localhost:3000'
    $env:JWT_SECRET = (Get-Content -LiteralPath $secretPath -Raw).Trim()
    Push-Location $backendRoot
    try {
        & $PythonPath -m alembic upgrade head
        if ($LASTEXITCODE -ne 0) { throw 'Preview database migration failed.' }
    } finally { Pop-Location }
    $apiProcess = Start-Process -FilePath $PythonPath -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000' -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'backend.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'backend.err.log')
    $state.api = $apiProcess.Id
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}
if (-not $BackendOnly) {
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:BACKEND_INTERNAL_URL = 'http://127.0.0.1:8000'
    $env:NEXT_PUBLIC_API_URL = '/api/v1'
    $webProcess = Start-Process -FilePath $nodePath -ArgumentList "`"$nextPath`"",'dev','--hostname','127.0.0.1','--port','3000' -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'frontend.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'frontend.err.log')
    $state.web = $webProcess.Id
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}
$ready = $false
for ($attempt=0; $attempt -lt 20; $attempt++) {
    try { $ready = (Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/health' -TimeoutSec 2).status -eq 'ok' } catch { }
    if ($ready) { break }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw "API not ready; see $runtimeRoot\backend.err.log" }
if (-not $BackendOnly) {
    $webReady = $false
    for ($attempt=0; $attempt -lt 20; $attempt++) {
        try { $webReady = (Invoke-WebRequest 'http://127.0.0.1:3000' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { }
        if ($webReady) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $webReady) { throw "Web not ready; see $runtimeRoot\frontend.err.log" }
}
Write-Host 'Offline preview ready: http://127.0.0.1:3000'
Write-Host "API PID: $($state.api); Web PID: $($state.web). Runtime: $runtimeRoot"
