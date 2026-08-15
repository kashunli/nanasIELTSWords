param(
  [string]$PackageRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) "dist\IELTSVocabulary")
)

$ErrorActionPreference = "Stop"
$Port = 8770
$ServiceProcessId = $null

try {
  if (@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
    throw "Port $Port is already in use; stop the existing service before running this test."
  }

  $LauncherPath = Join-Path $PackageRoot "IELTSVocabulary.exe"
  $Launcher = Start-Process -FilePath $LauncherPath -PassThru
  if (-not $Launcher.WaitForExit(15000)) {
    throw "IELTSVocabulary.exe did not finish opening the browser within 15 seconds."
  }
  if ($Launcher.ExitCode -ne 0) {
    throw "IELTSVocabulary.exe exited with code $($Launcher.ExitCode)."
  }

  $Health = $null
  $Deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ([DateTime]::UtcNow -lt $Deadline) {
    try {
      $Health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health"
      break
    } catch {
      Start-Sleep -Milliseconds 100
    }
  }

  if ($null -eq $Health -or $Health.StatusCode -ne 200 -or $Health.Content.Trim() -ne "ok") {
    throw "The launcher did not produce a healthy backend response."
  }

  $Index = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/"
  if ($Index.StatusCode -ne 200 -or $Index.Content -notmatch "IELTS Vocabulary") {
    throw "The launcher did not serve the frontend index."
  }

  $ServiceProcessId = Get-NetTCPConnection -LocalPort $Port -State Listen |
    Select-Object -First 1 -ExpandProperty OwningProcess

  $SecondLauncher = Start-Process -FilePath $LauncherPath -PassThru
  if (-not $SecondLauncher.WaitForExit(5000) -or $SecondLauncher.ExitCode -ne 0) {
    throw "A second launcher click did not reuse the healthy backend."
  }
  $SecondOwner = Get-NetTCPConnection -LocalPort $Port -State Listen |
    Select-Object -First 1 -ExpandProperty OwningProcess
  if ($SecondOwner -ne $ServiceProcessId) {
    throw "A second launcher click replaced the original backend process."
  }

  Write-Output "Launcher exit code: $($Launcher.ExitCode)"
  Write-Output "Second launcher exit code: $($SecondLauncher.ExitCode)"
  Write-Output "Health: $($Health.StatusCode) $($Health.Content.Trim())"
  Write-Output "Index: $($Index.StatusCode) contains IELTS Vocabulary"
  Write-Output "Started backend PID: $ServiceProcessId"
} finally {
  if ($null -ne $ServiceProcessId) {
    Stop-Process -Id $ServiceProcessId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }
}

if (@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -ne 0) {
  throw "The launcher test backend listener remained after cleanup."
}

Write-Output "Backend cleanup: complete"
