param([switch]$Restart)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot 'tmp'
$stateFile = Join-Path $runtimeDir 'local-services.json'
# Fail before touching saved PIDs when Windows process inspection is unavailable.
Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

if ($Restart -and (Test-Path -LiteralPath $stateFile)) {
    $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    foreach ($servicePid in @($saved.api, $saved.web)) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $servicePid" -ErrorAction SilentlyContinue
        if ($process -and $process.CommandLine -and $process.CommandLine.Contains($projectRoot)) {
            $descendants = [System.Collections.Generic.List[int]]::new()
            $pending = [System.Collections.Generic.Queue[int]]::new()
            $pending.Enqueue([int]$servicePid)
            while ($pending.Count) {
                $parent = $pending.Dequeue()
                Get-CimInstance Win32_Process -Filter "ParentProcessId = $parent" | ForEach-Object {
                    $pending.Enqueue([int]$_.ProcessId)
                    $descendants.Add([int]$_.ProcessId)
                }
            }
            $descendants.Reverse()
            foreach ($child in $descendants) { Stop-Process -Id $child -Force -ErrorAction SilentlyContinue }
            Stop-Process -Id $servicePid -Force -ErrorAction SilentlyContinue
        }
    }
}
foreach ($port in @(3000, 8000)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "Port $port is occupied. Stop the existing service or use -Restart for services started by this script."
    }
}
$pythonPath = Join-Path $projectRoot 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Create backend/.venv and install backend dependencies first.' }
$api = Start-Process -FilePath $pythonPath -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000' `
    -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDir 'backend.out.log') -RedirectStandardError (Join-Path $runtimeDir 'backend.err.log') -PassThru
$nextEntry = Join-Path $projectRoot 'frontend/node_modules/next/dist/bin/next'
$web = Start-Process -FilePath (Get-Command node).Source -ArgumentList $nextEntry,'dev','--hostname','127.0.0.1','--port','3000' `
    -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDir 'frontend.out.log') -RedirectStandardError (Join-Path $runtimeDir 'frontend.err.log') -PassThru
@{ api = $api.Id; web = $web.Id } | ConvertTo-Json | Set-Content -LiteralPath $stateFile
$readyBy = (Get-Date).AddSeconds(30)
do {
    $api.Refresh()
    $web.Refresh()
    if ($api.HasExited -or $web.HasExited) { throw 'A service exited during startup. See tmp/backend.err.log and tmp/frontend.err.log.' }
    try {
        $apiReady = (Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/health' -TimeoutSec 2).status -eq 'ok'
        $webReady = (Invoke-WebRequest 'http://127.0.0.1:3000/login' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200
        if ($apiReady -and $webReady) {
            Write-Output 'Ready: API http://127.0.0.1:8000 and Web http://localhost:3000. Logs: tmp/'
            return
        }
    } catch {
        # The services can still be loading; process exits are checked above.
    }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $readyBy)
throw 'Services did not become ready within 30 seconds. See tmp/ logs; process IDs remain saved for -Restart.'
