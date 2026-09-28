# Measures MeiliOps memory the honest way: private bytes summed over the WHOLE
# process tree (the app + every msedgewebview2.exe child), not just the host exe.
#
# Usage:
#   pwsh scripts/measure-memory.ps1                       # launch release build, sample idle
#   pwsh scripts/measure-memory.ps1 -AttachPid 1234       # measure an already-running app
param(
  [string]$Exe = "$PSScriptRoot\..\src-tauri\target\release\meiliops.exe",
  [int]$AttachPid = 0,
  [int]$WarmupSeconds = 8,
  [int]$Samples = 10
)

function Get-Tree([int]$RootPid) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, PrivatePageCount, WorkingSetSize
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($RootPid)
  do {
    $added = 0
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added++ }
    }
  } while ($added -gt 0)
  $all | Where-Object { $ids.Contains([int]$_.ProcessId) }
}

$started = $false
if ($AttachPid -eq 0) {
  if (-not (Test-Path $Exe)) { throw "Build first: npm run tauri build -- --no-bundle ($Exe not found)" }
  $proc = Start-Process -FilePath $Exe -PassThru
  $AttachPid = $proc.Id
  $started = $true
  Start-Sleep -Seconds $WarmupSeconds
}

$private = @(); $ws = @()
for ($i = 0; $i -lt $Samples; $i++) {
  $tree = Get-Tree $AttachPid
  $private += ($tree | Measure-Object PrivatePageCount -Sum).Sum / 1MB
  $ws += ($tree | Measure-Object WorkingSetSize -Sum).Sum / 1MB
  Start-Sleep -Milliseconds 500
}

$tree = Get-Tree $AttachPid
"Process tree ($($tree.Count) processes):"
$tree | Sort-Object PrivatePageCount -Descending | ForEach-Object {
  "  {0,-24} pid {1,-7} private {2,7:N1} MB   working set {3,7:N1} MB" -f $_.Name, $_.ProcessId, ($_.PrivatePageCount / 1MB), ($_.WorkingSetSize / 1MB)
}
""
"TOTAL private bytes  : median {0:N1} MB  (min {1:N1}, max {2:N1})" -f (($private | Sort-Object)[[int]($private.Count / 2)]), ($private | Measure-Object -Minimum).Minimum, ($private | Measure-Object -Maximum).Maximum
"TOTAL working set    : median {0:N1} MB" -f (($ws | Sort-Object)[[int]($ws.Count / 2)])

if ($started) { Stop-Process -Id $AttachPid -ErrorAction SilentlyContinue }
