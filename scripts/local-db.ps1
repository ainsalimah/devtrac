param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$dataPath = Join-Path $projectRoot '.local-db'
$pgBin = if ($env:PG_BIN) { $env:PG_BIN } else { 'C:\Program Files\PostgreSQL\18\bin' }
if (!(Test-Path "$pgBin\pg_ctl.exe")) { throw 'Install PostgreSQL or set PG_BIN to its bin directory.' }
if ($Stop) { & "$pgBin\pg_ctl.exe" -D $dataPath stop -m fast; exit $LASTEXITCODE }
if (!(Test-Path (Join-Path $dataPath 'PG_VERSION'))) {
  $passwordBytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($passwordBytes)
  $rng.Dispose()
  $dbPassword = -join ($passwordBytes | ForEach-Object { $_.ToString('x2') })
  $passwordFile = Join-Path $projectRoot '.db-init-password'
  try {
    [IO.File]::WriteAllText($passwordFile, $dbPassword)
    & "$pgBin\initdb.exe" -D $dataPath -U devtrack --auth=scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed.' }
  } finally { Remove-Item -LiteralPath $passwordFile -ErrorAction SilentlyContinue }
  @"
DATABASE_URL="postgresql://devtrack:${dbPassword}@127.0.0.1:55439/devtrack?schema=public"
TEST_DATABASE_URL="postgresql://devtrack:${dbPassword}@127.0.0.1:55439/devtrack_test?schema=public"
PORT=4100
APP_ORIGIN="http://127.0.0.1:5173"
COOKIE_SECURE=false
DEMO_PASSWORD="LocalDemo!2026"
"@ | Set-Content (Join-Path $projectRoot '.env')
}
& "$pgBin\pg_ctl.exe" -D $dataPath status *> $null
if ($LASTEXITCODE -ne 0) {
  & "$pgBin\pg_ctl.exe" -D $dataPath -l (Join-Path $dataPath 'server.log') -o '-p 55439 -h 127.0.0.1' start
  if ($LASTEXITCODE -ne 0) { throw 'Database startup failed.' }
}
$envText = Get-Content (Join-Path $projectRoot '.env') -Raw
$dbUrl = [regex]::Match($envText, 'DATABASE_URL="([^"]+)"').Groups[1].Value
$dbUri = [Uri]$dbUrl
$env:PGPASSWORD = $dbUri.UserInfo.Split(':',2)[1]
try {
  foreach ($dbName in @('devtrack','devtrack_test')) {
    $exists = & "$pgBin\psql.exe" -h 127.0.0.1 -p 55439 -U devtrack -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'"
    if ($exists -ne '1') { & "$pgBin\createdb.exe" -h 127.0.0.1 -p 55439 -U devtrack $dbName }
  }
} finally { Remove-Item Env:PGPASSWORD }
Write-Host 'DevTrack PostgreSQL is ready on 127.0.0.1:55439. Existing PostgreSQL services were not modified.'
