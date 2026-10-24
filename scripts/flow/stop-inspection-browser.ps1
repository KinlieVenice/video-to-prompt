param([ValidateRange(1024, 65535)][int]$Port = 9223)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$statePath = Join-Path $workspaceRoot ".tmp/flow-rea-browser-$Port.json"
$expectedProfile = Join-Path $workspaceRoot ".tmp/flow-rea-browser-$Port"
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.profilePath -ne $expectedProfile) { throw 'Browser profile does not match this workspace.' }
$inspectionProcessId = [int]$state.processId
$inspectionProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$inspectionProcessId"
if (!$inspectionProcess) { Write-Output 'The inspection browser is already stopped.'; return }
if ($inspectionProcess.Name -ne 'chrome.exe' -or !$inspectionProcess.CommandLine.Contains($expectedProfile)) {
    throw 'Saved process does not belong to this inspection profile. It was not stopped.'
}
# Chrome children can outlive a terminated parent and keep this profile locked.
# Build the tree from the verified browser PID; other Chrome windows are excluded.
$chromeProcesses = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'")
$ownedProcessIds = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$ownedProcessIds.Add($inspectionProcessId)
do {
    $added = $false
    foreach ($processRecord in $chromeProcesses) {
        if ($ownedProcessIds.Contains([int]$processRecord.ParentProcessId) -and
            $ownedProcessIds.Add([int]$processRecord.ProcessId)) {
            $added = $true
        }
    }
} while ($added)
foreach ($ownedProcessId in $ownedProcessIds) {
    if ($ownedProcessId -ne $inspectionProcessId) {
        Stop-Process -Id $ownedProcessId -Force -ErrorAction SilentlyContinue
    }
}
Stop-Process -Id $inspectionProcessId -Force -ErrorAction SilentlyContinue
Write-Output "Stopped the separate Flow inspection browser and its Chrome children for port $Port. The local profile is retained."
