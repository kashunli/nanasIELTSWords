param(
  [string]$OutputRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) "dist\IELTSVocabulary"),
  [switch]$RefreshIcon
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$FrontendRoot = Join-Path $RepoRoot "frontend"
$BackendManifest = Join-Path $RepoRoot "backend\Cargo.toml"
$LauncherManifest = Join-Path $RepoRoot "launcher\Cargo.toml"

Write-Host "Building the frontend..."
Push-Location $FrontendRoot
try {
  pnpm install --frozen-lockfile
  pnpm test
  pnpm build
} finally {
  Pop-Location
}

Write-Host "Building the backend..."
cargo test --manifest-path $BackendManifest
cargo build --release --manifest-path $BackendManifest

$IconPath = Join-Path $RepoRoot "launcher\assets\ielts-vocabulary.ico"
if ($RefreshIcon) {
  Write-Host "Regenerating the Windows icon..."
  python (Join-Path $PSScriptRoot "build_windows_icon.py")
} elseif (-not (Test-Path -LiteralPath $IconPath)) {
  throw "The Windows icon is missing: $IconPath"
}

Write-Host "Building IELTSVocabulary.exe..."
cargo build --release --manifest-path $LauncherManifest

$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$FrontendOutput = Join-Path $OutputRoot "frontend\dist"
$ContentSource = Join-Path $RepoRoot "var\content"
$ContentOutput = Join-Path $OutputRoot "var\content"

New-Item -ItemType Directory -Force -Path $OutputRoot, $FrontendOutput | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot "launcher\target\release\IELTSVocabulary.exe") -Destination $OutputRoot -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot "backend\target\release\ielts-vocabulary-service.exe") -Destination $OutputRoot -Force
Copy-Item -Path (Join-Path $FrontendRoot "dist\*") -Destination $FrontendOutput -Recurse -Force

if (Test-Path -LiteralPath $ContentSource) {
  New-Item -ItemType Directory -Force -Path $ContentOutput | Out-Null
  Copy-Item -Path (Join-Path $ContentSource "*") -Destination $ContentOutput -Recurse -Force
} else {
  Write-Warning "No var\content directory exists. The package was built without the runtime database and media; create the runtime projection before using the launcher."
}

Write-Host "Windows package ready: $OutputRoot\IELTSVocabulary.exe"
