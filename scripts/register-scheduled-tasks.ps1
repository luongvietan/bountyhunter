$ErrorActionPreference = "Stop"
$repo = "C:\Users\admin\Desktop\kritt-radar"
$script = Join-Path $repo "scripts\automate-scheduled.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""

$trigger = New-ScheduledTaskTrigger -Daily -At "06:00"

Register-ScheduledTask `
  -TaskName "KrittRadarAutomate" `
  -Action $action `
  -Trigger $trigger `
  -Description "Daily Kritt Radar A-Z automation: sync, auto-merge, dispatch, ingest." `
  -Force

Write-Output "Registered scheduled task KrittRadarAutomate (daily 06:00)."
