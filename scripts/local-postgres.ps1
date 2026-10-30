param([ValidateSet('start', 'stop', 'status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI
# (GBK on this machine), so a UTF-8 Chinese comment can swallow the following line.
# Windows PostgreSQL only accepts dynamic_shared_memory_type=windows (PG 18 rejects
# mmap/sysv), so the Windows DSM fixed-address reservation cannot be bypassed by
# changing that parameter.
# Windows DSM maps a shared region at a fixed address inside every child process.
# When the host is short on memory that reservation fails with
# "could not reserve shared memory region ... error code 487", the backend dies with
# 0xC0000142 (STATUS_DLL_INIT_FAILED) and the postmaster resets all connections.
# Pre-allocating one DSM segment in the postmaster (min_dynamic_shared_memory) and
# disabling parallel workers removes the per-child reservations that trigger it.
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskLocal = [IO.Path]::GetFullPath((Join-Path $taskRoot '.local'))
if (!$taskLocal.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Local database path escaped repository' }
$taskRuntime = Join-Path $taskLocal 'pg-runtime'
$taskBin = Join-Path $taskRuntime 'embedded_postgres/pginstall/bin'
if (!(Test-Path -LiteralPath (Join-Path $taskBin 'pg_ctl.exe'))) {
  if ($Action -ne 'start') { Write-Output 'Project-local PostgreSQL is not installed'; exit 0 }
  python -m pip install --target $taskRuntime embedded-postgres==18.6.3 --disable-pip-version-check --no-input
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL binary package installation failed' }
}
$previousPassword = $env:PGPASSWORD
try {
  foreach ($taskDb in @(@{Directory='pg-dev';Port=55432;Name='skillforge';Password='skillforge_local'}, @{Directory='pg-test';Port=55433;Name='skillforge_test';Password='skillforge_test'})) {
    $taskData = Join-Path $taskLocal $taskDb.Directory
    $taskControl = Join-Path $taskBin 'pg_ctl.exe'
    if ($Action -eq 'status') { & $taskControl status -D $taskData; continue }
    if ($Action -eq 'stop') { if (Test-Path -LiteralPath (Join-Path $taskData 'postmaster.pid')) { & $taskControl stop -D $taskData -m fast }; continue }
    if (!(Test-Path -LiteralPath (Join-Path $taskData 'PG_VERSION'))) {
      $taskPasswordFile = Join-Path $taskLocal ($taskDb.Directory + '-bootstrap-password.txt')
      [IO.File]::WriteAllText($taskPasswordFile, $taskDb.Password)
      try {
        & (Join-Path $taskBin 'initdb.exe') -D $taskData -U skillforge "--pwfile=$taskPasswordFile" --auth=scram-sha-256 --encoding=UTF8 --locale=C
        if ($LASTEXITCODE -ne 0) { throw 'initdb failed; existing data was not removed' }
      } finally { Remove-Item -LiteralPath $taskPasswordFile -ErrorAction SilentlyContinue }
    }
    & $taskControl status -D $taskData *> $null
    if ($LASTEXITCODE -ne 0) {
      & $taskControl start -D $taskData -l (Join-Path $taskLocal ($taskDb.Directory + '.log')) -o "-p $($taskDb.Port) -h 127.0.0.1 -B 16MB -c max_connections=10 -c work_mem=1MB -c min_dynamic_shared_memory=64MB -c max_parallel_workers=0 -c max_parallel_maintenance_workers=0"
      if ($LASTEXITCODE -ne 0) { throw "Could not start project database on $($taskDb.Port); check port and log" }
    }
    $env:PGPASSWORD = $taskDb.Password
    $taskExists = & (Join-Path $taskBin 'psql.exe') -h 127.0.0.1 -p $taskDb.Port -U skillforge -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$($taskDb.Name)'"
    if ($LASTEXITCODE -ne 0) { throw 'Could not query project PostgreSQL' }
    if ($taskExists.Trim() -ne '1') { & (Join-Path $taskBin 'createdb.exe') -h 127.0.0.1 -p $taskDb.Port -U skillforge $taskDb.Name; if ($LASTEXITCODE -ne 0) { throw 'createdb failed' } }
    Write-Output "Ready: $($taskDb.Name) at 127.0.0.1:$($taskDb.Port) (PostgreSQL 18.6 portable, not Docker)"
  }
} finally { $env:PGPASSWORD = $previousPassword }
