$ErrorActionPreference = "Stop"
Set-Location "C:\Users\admin\Desktop\kritt-radar"
$logDir = "C:\Users\admin\Desktop\kritt-radar\.data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd"
$log = Join-Path $logDir "sync-$stamp.log"
function Write-Log($msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $log -Value $line
  Write-Output $line
}
try {
  Write-Log "sync start"
  & pnpm sync *>> $log 2>&1
  Write-Log "sync exit=$LASTEXITCODE"
  exit $LASTEXITCODE
} catch {
  Write-Log "sync error: $_"
  exit 1
}
