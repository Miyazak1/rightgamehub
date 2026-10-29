param(
  [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
  [Parameter(Mandatory = $true)][string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
$source = [System.IO.Path]::GetFullPath($ReleaseDirectory)
$archive = [System.IO.Path]::GetFullPath($ArchivePath)
if (-not [System.IO.Directory]::Exists($source)) { throw "Release directory does not exist: $source" }
if (-not [System.IO.File]::Exists([System.IO.Path]::Combine($source, 'runtime.json'))) {
  throw 'Release directory does not contain runtime.json'
}
if ([System.IO.File]::Exists($archive)) { throw "Archive already exists: $archive" }
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($archive)) | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveStream = [System.IO.File]::Open($archive, [System.IO.FileMode]::CreateNew)
try {
  $zip = [System.IO.Compression.ZipArchive]::new(
    $archiveStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $true
  )
  try {
    $entries = Get-ChildItem -LiteralPath $source -Force -Recurse
    if ($entries | Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 }) {
      throw 'Release directory contains a reparse point'
    }
    $entries | Where-Object { -not $_.PSIsContainer } |
      Sort-Object FullName |
      ForEach-Object {
        $relative = $_.FullName.Substring($source.Length).TrimStart('\', '/') -replace '\\', '/'
        $entry = $zip.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
        $entryStream = $entry.Open()
        $inputStream = [System.IO.File]::OpenRead($_.FullName)
        try { $inputStream.CopyTo($entryStream) }
        finally { $inputStream.Dispose(); $entryStream.Dispose() }
      }
  } finally { $zip.Dispose() }
} catch {
  $archiveStream.Dispose()
  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  throw
} finally {
  $archiveStream.Dispose()
}
$stream = [System.IO.File]::OpenRead($archive)
try {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '' }
  finally { $sha.Dispose() }
} finally { $stream.Dispose() }
$size = ([System.IO.FileInfo]$archive).Length
[ordered]@{
  schemaVersion = 'windows-runtime-archive-v1'
  archivePath = $archive
  sha256 = $hash
  sizeBytes = $size
} | ConvertTo-Json -Compress
