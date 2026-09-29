param(
  [ValidateSet('cursor', 'code', 'harness', 'codex', 'claude')]
  [string]$HostName = ''
)
$ErrorActionPreference = 'Stop'
$baseUrl = 'https://mooyu.fun'
if (-not $HostName) {
  foreach ($candidate in @('cursor', 'code', 'codex', 'claude')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) { $HostName = $candidate; break }
  }
  if (-not $HostName -and (Get-Command dsh -ErrorAction SilentlyContinue)) { $HostName = 'harness' }
  if (-not $HostName) { throw 'No supported Agent CLI was found on PATH.' }
}
$manifest = Invoke-RestMethod -Uri "$baseUrl/downloads/manifest.json"

function Enable-GameHubUpdates {
  try {
    $root = Join-Path $env:LOCALAPPDATA 'GameHub'
    [System.IO.Directory]::CreateDirectory($root) | Out-Null
    $updaterPath = Join-Path $root 'agent-update.ps1'
    $partial = "$updaterPath.part"
    Invoke-WebRequest -UseBasicParsing -Uri $manifest.updater.windows.url -OutFile $partial
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $partial).Hash.ToLowerInvariant()
    if ($actual -ne $manifest.updater.windows.sha256.ToLowerInvariant()) { throw 'GameHub updater SHA-256 verification failed.' }
    Move-Item -LiteralPath $partial -Destination $updaterPath -Force
    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$updaterPath`" -HostName $HostName -Quiet"
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(15) -RepetitionInterval (New-TimeSpan -Hours $manifest.updatePolicy.checkIntervalHours)
    Register-ScheduledTask -TaskName "GameHub Agent Update ($HostName)" -Action $action -Trigger $trigger -Description 'Downloads verified stable GameHub updates; the Agent activates them after restart.' -Force | Out-Null
    Write-Host "Automatic GameHub updates enabled for $HostName. Updates activate after the Agent restarts."
  } catch {
    Write-Warning "GameHub was installed, but automatic update scheduling was unavailable: $($_.Exception.Message)"
  } finally {
    if ($partial -and (Test-Path -LiteralPath $partial)) { Remove-Item -LiteralPath $partial -Force }
  }
}

if ($HostName -in @('cursor', 'code')) {
  $extension = $manifest.editorExtension
  if ($extension.supportedHosts -notcontains $HostName) { throw "Unsupported editor host: $HostName" }
  $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) $extension.filename
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $extension.url -OutFile $tempFile
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $tempFile).Hash.ToLowerInvariant()
    if ($actual -ne $extension.sha256.ToLowerInvariant()) { throw 'GameHub VSIX SHA-256 verification failed.' }
    & $HostName --install-extension $tempFile --force
    if ($LASTEXITCODE -ne 0) { throw "$HostName rejected the GameHub VSIX." }
    Write-Host "GameHub $($extension.version) installed for $HostName. Reload the editor and open GameHub from the Activity Bar."
    Enable-GameHubUpdates
  } finally {
    if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile -Force }
  }
  exit 0
}

if ($HostName -eq 'harness') {
  if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) { throw 'DeepSeek Harness CLI (dsh) was not found on PATH.' }
  $item = $manifest.harnessPlugin
  $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) $item.filename
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $item.url -OutFile $tempFile
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $tempFile).Hash.ToLowerInvariant()
    if ($actual -ne $item.sha256.ToLowerInvariant()) { throw 'GameHub Harness package SHA-256 verification failed.' }
    & dsh plugin --profile web add $tempFile
    if ($LASTEXITCODE -ne 0) { throw 'DeepSeek Harness rejected the GameHub package.' }
    Write-Host 'GameHub installed for the Harness web profile. Restart dsh web.'
    Enable-GameHubUpdates
  } finally {
    if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile -Force }
  }
  exit 0
}

$plugin = $manifest.agentPlugin
if ($plugin.supportedHosts -notcontains $HostName) { throw "Unsupported Agent host: $HostName" }
$bundleFile = Join-Path ([System.IO.Path]::GetTempPath()) $plugin.filename
$marketplaceRoot = Join-Path $env:LOCALAPPDATA 'GameHub\agent-marketplace'
try {
  Invoke-WebRequest -UseBasicParsing -Uri $plugin.url -OutFile $bundleFile
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundleFile).Hash.ToLowerInvariant()
  if ($actual -ne $plugin.sha256.ToLowerInvariant()) { throw 'GameHub plugin bundle SHA-256 verification failed.' }
  $bundle = Get-Content -LiteralPath $bundleFile -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($file in $bundle.files) {
    if ($file.path -match '(^|/)\.\.(/|$)' -or [System.IO.Path]::IsPathRooted($file.path)) { throw "Unsafe plugin path: $($file.path)" }
    $bytes = [Convert]::FromBase64String($file.contentBase64)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $fileHash = ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
    if ($fileHash -ne $file.sha256.ToLowerInvariant()) { throw "Plugin file verification failed: $($file.path)" }
    $destination = Join-Path $marketplaceRoot ($file.path.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($destination)) | Out-Null
    [System.IO.File]::WriteAllBytes($destination, $bytes)
  }
} finally {
  if (Test-Path -LiteralPath $bundleFile) { Remove-Item -LiteralPath $bundleFile -Force }
}
if (-not (Get-Command $HostName -ErrorAction SilentlyContinue)) { throw "$HostName CLI was not found on PATH." }
$marketplaceOutput = & $HostName plugin marketplace add $marketplaceRoot 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  $knownMarketplaces = & $HostName plugin marketplace list 2>&1 | Out-String
  if ($knownMarketplaces -notmatch 'gamehub') { throw "$HostName could not add the GameHub marketplace: $marketplaceOutput" }
}
if ($HostName -eq 'claude') {
  & claude plugin install gamehub@gamehub
  if ($LASTEXITCODE -ne 0) { throw 'Claude Code could not install the GameHub plugin.' }
  Write-Host 'GameHub installed for Claude Code. Start a new session or reload plugins.'
} else {
  Write-Host 'GameHub marketplace added to Codex. Open the Plugins Directory, select GameHub Plugins, and install gamehub.'
}
Enable-GameHubUpdates
