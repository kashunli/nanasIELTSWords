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
$RuntimeRoot = Join-Path $RepoRoot "var\content"

if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot "content.sqlite") -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $RuntimeRoot "media") -PathType Container)) {
  throw "The project runtime content is missing under $RuntimeRoot. Build and validate var\content before creating the launcher output."
}

$StaleRuntimeOutput = Join-Path $OutputRoot "var"
if (Test-Path -LiteralPath $StaleRuntimeOutput) {
  Write-Host "Removing the obsolete copied runtime content from the launcher output..."
  Remove-Item -LiteralPath $StaleRuntimeOutput -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $OutputRoot, $FrontendOutput | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot "launcher\target\release\IELTSVocabulary.exe") -Destination $OutputRoot -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot "backend\target\release\ielts-vocabulary-service.exe") -Destination $OutputRoot -Force
Copy-Item -Path (Join-Path $FrontendRoot "dist\*") -Destination $FrontendOutput -Recurse -Force

Write-Host "Windows launcher output ready: $OutputRoot\IELTSVocabulary.exe"
Write-Host "Runtime content remains in the project: $RuntimeRoot"
