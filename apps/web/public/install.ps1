param(
  [ValidateSet('cursor', 'code')]
  [string]$HostName = ''
)
$ErrorActionPreference = 'Stop'
$baseUrl = 'https://mooyu.fun'
if (-not $HostName) {
  if (Get-Command cursor -ErrorAction SilentlyContinue) { $HostName = 'cursor' }
  elseif (Get-Command code -ErrorAction SilentlyContinue) { $HostName = 'code' }
  else { throw 'Cursor or VS Code CLI was not found. Install one and ensure its command is on PATH.' }
}
$manifest = Invoke-RestMethod -Uri "$baseUrl/downloads/manifest.json"
$extension = $manifest.editorExtension
if ($extension.supportedHosts -notcontains $HostName) { throw "Unsupported host: $HostName" }
$tempFile = Join-Path ([System.IO.Path]::GetTempPath()) $extension.filename
try {
  Invoke-WebRequest -UseBasicParsing -Uri $extension.url -OutFile $tempFile
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $tempFile).Hash.ToLowerInvariant()
  if ($actual -ne $extension.sha256.ToLowerInvariant()) { throw 'GameHub VSIX SHA-256 verification failed.' }
  & $HostName --install-extension $tempFile --force
  if ($LASTEXITCODE -ne 0) { throw "$HostName rejected the GameHub VSIX." }
  Write-Host "GameHub $($extension.version) installed for $HostName. Reload the editor and open GameHub from the Activity Bar."
} finally {
  if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile -Force }
}
