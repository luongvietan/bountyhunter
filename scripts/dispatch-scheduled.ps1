$ErrorActionPreference = "Stop"
Set-Location "C:\Users\admin\Desktop\kritt-radar"
$logDir = "C:\Users\admin\Desktop\kritt-radar\.data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd"
$log = Join-Path $logDir "dispatch-$stamp.log"
function Write-Log($msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $log -Value $line
  Write-Output $line
}
try {
  Write-Log "dispatch --apply start"
  & pnpm --filter @kritt-radar/worker run cli dispatch -- --apply *>> $log 2>&1
  Write-Log "dispatch exit=$LASTEXITCODE"
  if ($LASTEXITCODE -eq 0) {
    Write-Log "starting watch after dispatch"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\admin\Desktop\kritt-radar\scripts\watch-scheduled.ps1" *>> $log 2>&1
    Write-Log "watch exit=$LASTEXITCODE"
  }
  exit $LASTEXITCODE
} catch {
  Write-Log "dispatch error: $_"
  exit 1
}
