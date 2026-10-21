$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $projectDirectory ".local\server.pid"
$serverScript = Join-Path $projectDirectory "server.js"

if (-not (Test-Path $pidFile)) {
  Write-Host "No server started by Lancer.bat is registered."
  exit 0
}

$serverId = [int](Get-Content $pidFile -Raw)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverId"
if (-not $process) {
  Remove-Item $pidFile
  Write-Host "The server is already stopped."
  exit 0
}

$executablePath = (Get-Command node.exe).Source
$isOurServer = $process.ExecutablePath -eq $executablePath -and
  $process.CommandLine.Contains($serverScript)
if (-not $isOurServer) {
  throw "Process $serverId does not match the Maison Sucree server. It was not stopped."
}

Stop-Process -Id $serverId
Remove-Item $pidFile
Write-Host "The Maison Sucree server is stopped."
