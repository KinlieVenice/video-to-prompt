param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ReaArguments
)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$toolDirectory = Join-Path $workspaceRoot '.tmp/rea-tools/node_modules'
$nodeExecutable = Join-Path $toolDirectory 'node/bin/node.exe'
$reaEntry = Join-Path $toolDirectory 'rea-agents/scripts/rea.mjs'
if (!(Test-Path -LiteralPath $nodeExecutable) -or !(Test-Path -LiteralPath $reaEntry)) {
    throw 'Run scripts/flow/install-rea.ps1 to prepare the isolated REA CLI and portable Node runtime.'
}
& $nodeExecutable $reaEntry @ReaArguments
if ($LASTEXITCODE -ne 0) { throw "REA exited with code $LASTEXITCODE." }
