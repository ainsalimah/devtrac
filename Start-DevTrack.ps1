$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (!(Test-Path 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
& "$PSScriptRoot/scripts/local-db.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run db:generate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run db:migrate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run db:seed
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run dev
