param(
  [string]$Bind = "127.0.0.1:8770"
)

$ErrorActionPreference = "Stop"
$env:IELTS_VOCAB_BIND = $Bind
$env:IELTS_VOCAB_CONTENT_DB = (Join-Path $PSScriptRoot "var\content\content.sqlite")
$env:IELTS_VOCAB_MEDIA_ROOT = (Join-Path $PSScriptRoot "var\content\media")
$env:IELTS_VOCAB_FRONTEND_ROOT = (Join-Path $PSScriptRoot "frontend\dist")
$env:IELTS_VOCAB_EXPORT_ROOT = (Join-Path $PSScriptRoot "var\content\exports")

Push-Location (Join-Path $PSScriptRoot "backend")
try {
  cargo run
} finally {
  Pop-Location
}
