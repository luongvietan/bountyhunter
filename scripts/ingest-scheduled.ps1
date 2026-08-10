$ErrorActionPreference = "Stop"
# Safety-net ingest (one-shot). For active scans, prefer scripts/watch-scheduled.ps1.
Set-Location "C:\Users\admin\Desktop\kritt-radar"
$logDir = "C:\Users\admin\Desktop\kritt-radar\.data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd"
$log = Join-Path $logDir "ingest-$stamp.log"
function Write-Log($msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $log -Value $line
  Write-Output $line
}
try {
  Write-Log "ingest start"
  & pnpm ingest *>> $log 2>&1
  Write-Log "ingest exit=$LASTEXITCODE"
  exit $LASTEXITCODE
} catch {
  Write-Log "ingest error: $_"
  exit 1
}
