$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$version = '44.4.5'
$expected = '11c395820a5aaa8ebcc0686b476d0ac98a730274ebfbdc8cf5538a7c2815cb5d'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDir = Join-Path $taskRoot ".runtime\electron-v$version-win32-x64"
$archive = Join-Path $runtimeDir "electron-v$version-win32-x64.zip"
$baseUrl = "https://github.com/electron/electron/releases/download/v$version"
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri "$baseUrl/electron-v$version-win32-x64.zip" -OutFile $archive
}
$actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'Electron archive digest does not match the official pinned release.' }

$sumsFile = Join-Path $runtimeDir 'SHASUMS256.txt'
Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -OutFile $sumsFile
$sumLines = Get-Content -LiteralPath $sumsFile
$expectedLine = $sumLines | Where-Object { $_ -match ' \*?electron-v44\.4\.5-win32-x64\.zip$' }
if (!$expectedLine -or !($expectedLine.StartsWith($expected))) { throw 'Release checksum list mismatch.' }

$executable = Join-Path $runtimeDir 'electron.exe'
if (!(Test-Path -LiteralPath $executable)) {
    Expand-Archive -LiteralPath $archive -DestinationPath $runtimeDir
}
if (!(Test-Path -LiteralPath $executable)) { throw 'Runtime extraction did not create electron.exe.' }
$signature = Get-AuthenticodeSignature -LiteralPath $executable
$metadata = [ordered]@{
    version = $version
    source = "$baseUrl/electron-v$version-win32-x64.zip"
    archiveSha256 = $actual
    executableSha256 = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    authenticodeStatus = [string]$signature.Status
    signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    preparedAt = [DateTime]::UtcNow.ToString('o')
    executable = $executable
    launched = $false
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'provenance.json') -Encoding utf8
$metadata | ConvertTo-Json
