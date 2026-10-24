$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$toolDirectory = Join-Path $workspaceRoot '.tmp/rea-tools'
New-Item -ItemType Directory -Force -Path $toolDirectory | Out-Null
@{
    name = 'recast-rea-tools'
    private = $true
    dependencies = @{ 'rea-agents' = '6.7.0'; node = '22.23.4' }
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $toolDirectory 'package.json') -Encoding UTF8
& npm.cmd install --prefix $toolDirectory --omit=optional --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'REA tool installation failed.' }
& (Join-Path $PSScriptRoot 'rea.ps1') -ReaArguments @('--version')
