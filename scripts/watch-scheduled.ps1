$ErrorActionPreference = "Stop"
Set-Location "C:\Users\admin\Desktop\kritt-radar"
$logDir = "C:\Users\admin\Desktop\kritt-radar\.data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd"
$log = Join-Path $logDir "watch-$stamp.log"
function Write-Log($msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $log -Value $line
  Write-Output $line
}
try {
  Write-Log "watch start"
  $job = Start-Job -ScriptBlock {
    Set-Location "C:\Users\admin\Desktop\kritt-radar"
    & pnpm watch 2>&1
  }
  Wait-Job $job -Timeout (25 * 60) | Out-Null
  if ($job.State -eq 'Running') {
    Stop-Job $job
    Write-Log "watch timeout after 25 minutes"
    exit 0
  }
  Receive-Job $job *>> $log
  Write-Log "watch exit=$($job.ChildJobs[0].JobStateInfo.Reason)"
  exit 0
} catch {
  Write-Log "watch error: $_"
  exit 1
}
