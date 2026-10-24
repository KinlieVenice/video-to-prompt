param([ValidateRange(1024, 65535)][int]$Port = 9223)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$endpoint = "http://127.0.0.1:$Port"
$reaScript = Join-Path $PSScriptRoot 'rea.ps1'
$discovery = (& $reaScript -ReaArguments @('list-browser-targets', $endpoint, '--format', 'json')) | Out-String | ConvertFrom-Json
$targets = @($discovery.normalized_result.targets | Where-Object {
    $_.origin -eq 'https://flow.google.com' -or
    ($_.origin -eq 'https://labs.google' -and $_.url -like 'https://labs.google/fx/tools/flow*')
})
if ($targets.Count -ne 1) {
    throw 'Keep exactly one Flow page open in the separate inspection browser, finish signing in, then retry. Google sign-in pages are excluded.'
}
$artifactDirectory = Join-Path $workspaceRoot '.tmp/flow-rea'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$artifactPath = Join-Path $artifactDirectory ("page-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
& $reaScript -ReaArguments @('inspect-web-page', $endpoint, $targets[0].target_id, '--include-accessibility-text', '--include-json-body-shapes', '--format', 'json') |
    Set-Content -LiteralPath $artifactPath -Encoding UTF8
$evidence = Get-Content -LiteralPath $artifactPath -Raw | ConvertFrom-Json
Write-Output "Saved local REA evidence: $artifactPath"
Write-Output "Evidence: $($evidence.evidence_id)"
Write-Output "Capture completeness: $($evidence.normalized_result.completeness.status)"
