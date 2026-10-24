param(
    [ValidateRange(1024, 65535)][int]$Port = 9223,
    [switch]$Visible,
    [string]$ChromePath
)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$profilePath = Join-Path $workspaceRoot ".tmp/flow-rea-browser-$Port"
$statePath = Join-Path $workspaceRoot ".tmp/flow-rea-browser-$Port.json"
$endpoint = "http://127.0.0.1:$Port"
try {
    $existing = Invoke-RestMethod -Uri "$endpoint/json/version" -TimeoutSec 1
    if ($existing) { throw "CDP port $Port is already in use. Reuse its verified endpoint or choose a different port." }
} catch {
    if ($_.Exception.Message -like 'CDP port*') { throw }
}
if (!$ChromePath) {
    $ChromePath = @(
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (!$ChromePath -or !(Test-Path -LiteralPath $ChromePath)) { throw 'Supply -ChromePath with your Chrome executable.' }
New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
$browserArguments = @(
    "--remote-debugging-port=$Port",
    '--remote-debugging-address=127.0.0.1',
    ('--user-data-dir="' + $profilePath + '"'),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    'https://labs.google/fx/tools/flow'
)
if (!$Visible) { $browserArguments = @('--headless=new') + $browserArguments }
$windowStyle = if ($Visible) { 'Normal' } else { 'Hidden' }
$inspectionBrowser = Start-Process -FilePath $ChromePath -ArgumentList $browserArguments -WindowStyle $windowStyle -PassThru
@{
    processId = $inspectionBrowser.Id
    profilePath = $profilePath
    endpoint = $endpoint
    visible = [bool]$Visible
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
$deadline = (Get-Date).AddSeconds(15)
do {
    try {
        $ready = Invoke-RestMethod -Uri "$endpoint/json/version" -TimeoutSec 1
        if ($ready) {
            Write-Output "Flow inspection browser ready: $endpoint"
            Write-Output "Separate profile: $profilePath"
            if ($Visible) { Write-Output 'Sign into Google Flow in this separate window; keep it open for inspection.' }
            return
        }
    } catch { }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
throw 'Chrome did not expose its CDP endpoint within 15 seconds. Check Chrome policy and the saved browser state file.'
