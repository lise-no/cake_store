$ErrorActionPreference = "Stop"
$utf8Encoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8Encoding
$OutputEncoding = $utf8Encoding
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDirectory

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js is not installed. Install Node.js 22.13 or later, then relaunch Lancer.bat."
}

$nodeVersionText = & $node.Source -p "process.versions.node"
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion -lt [version]"22.13") {
  throw "Node.js 22.13 or later is required. Detected version: $nodeVersionText."
}

if (-not (Test-Path (Join-Path $projectDirectory "node_modules\express"))) {
  Write-Host "Installing server dependencies..."
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed. Check your Internet connection and relaunch Lancer.bat."
  }
}

$environmentFile = Join-Path $projectDirectory ".env"
if (-not (Test-Path $environmentFile)) {
  Copy-Item (Join-Path $projectDirectory ".env.example") $environmentFile
  Write-Host "Created local configuration in .env."
}

$healthUri = "http://127.0.0.1:3000/api/health"
$localDirectory = Join-Path $projectDirectory ".local"
$pidFile = Join-Path $localDirectory "server.pid"
$serverScript = Join-Path $projectDirectory "server.js"
$running = $false
try {
  $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 2
  $running = $health.status -eq "ok" -and $health.engine -eq "sqlite"
} catch {
  $running = $false
}

if (-not $running) {
  New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null
  $stdoutLog = Join-Path $localDirectory "server.out.log"
  $stderrLog = Join-Path $localDirectory "server.err.log"

  $serverProcess = Start-Process -FilePath $node.Source `
    -ArgumentList @("`"$serverScript`"") `
    -WorkingDirectory $projectDirectory `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
  Set-Content -Path (Join-Path $localDirectory "server.pid") -Value $serverProcess.Id

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    try {
      $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 2
      if ($health.status -eq "ok" -and $health.engine -eq "sqlite") {
        $running = $true
        break
      }
    } catch {
      $running = $false
    }
  }

  if (-not $running) {
    if (Test-Path $stderrLog) {
      Get-Content $stderrLog -Tail 30
    }
    throw "The shop could not start. Check $stderrLog."
  }
}

if (-not (Test-Path $pidFile)) {
  $matchingServers = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -eq $node.Source -and
      $_.CommandLine.Contains($serverScript)
    })
  if ($matchingServers.Count -eq 1) {
    Set-Content -Path $pidFile -Value $matchingServers[0].ProcessId
  }
}

$config = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/config" -TimeoutSec 5
Start-Process "http://localhost:3000"
Write-Host ""
Write-Host "La boutique est ouverte : http://localhost:3000"
Write-Host "Order database: stored locally in data\orders.sqlite."
if (-not $config.paypalConfigured) {
  Write-Warning "The shop is ready, but checkout requires PayPal Sandbox API credentials in .env."
  Write-Host "After obtaining these credentials in your PayPal Developer account, set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env and relaunch Lancer.bat."
}
Write-Host "Double-click Arreter.bat to stop the server."
