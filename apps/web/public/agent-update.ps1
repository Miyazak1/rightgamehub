param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('cursor', 'code', 'harness', 'codex', 'claude')]
  [string]$HostName,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$baseUrl = 'https://mooyu.fun'
$dataRoot = Join-Path $env:LOCALAPPDATA 'GameHub'
$stateRoot = Join-Path $dataRoot 'updates'
$stateFile = Join-Path $stateRoot "$HostName.json"
[System.IO.Directory]::CreateDirectory($stateRoot) | Out-Null
$script:updateVersion = $null
$script:updateSha = $null
$previous = if (Test-Path -LiteralPath $stateFile) { Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }

function Write-UpdateState([string]$Phase, [Nullable[int]]$Percent = $null, [string]$Message = $null, [bool]$RestartRequired = $false) {
  $temporary = "$stateFile.tmp"
  @{
    host = $HostName
    channel = 'stable'
    phase = $Phase
    version = $script:updateVersion
    sha256 = $script:updateSha
    percent = $Percent
    message = $Message
    updatedAt = [DateTime]::UtcNow.ToString('o')
    restartRequired = $RestartRequired
  } | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $stateFile -Force
}

trap {
  Write-UpdateState 'failed' $null '更新暂未完成，后台稍后会自动重试。' $false
  exit 1
}
Write-UpdateState 'checking'

function Write-UpdateMessage([string]$Message) {
  if (-not $Quiet) { Write-Host $Message }
}

function Get-VerifiedFile($Item, [string]$Destination) {
  $partial = "$Destination.part"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Item.url -OutFile $partial
    Write-UpdateState 'verifying' 100
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $partial).Hash.ToLowerInvariant()
    if ($actual -ne $Item.sha256.ToLowerInvariant()) { throw "GameHub update verification failed for $($Item.filename)." }
    Move-Item -LiteralPath $partial -Destination $Destination -Force
  } finally {
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  }
}

function Install-PortablePlugin($Item) {
  $bundleFile = Join-Path $stateRoot $Item.filename
  Get-VerifiedFile $Item $bundleFile
  $bundle = Get-Content -LiteralPath $bundleFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $marketplaceRoot = Join-Path $dataRoot 'agent-marketplace'
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
  return $marketplaceRoot
}

$manifest = Invoke-RestMethod -Uri "$baseUrl/downloads/manifest.json"
if ($manifest.updater -and $manifest.updater.windows) {
  $updater = $manifest.updater.windows
  $currentScript = $MyInvocation.MyCommand.Path
  $currentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $currentScript).Hash.ToLowerInvariant()
  if ($currentHash -ne $updater.sha256.ToLowerInvariant()) {
    $nextScript = "$currentScript.next"
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $updater.url -OutFile $nextScript
      $nextHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $nextScript).Hash.ToLowerInvariant()
      if ($nextHash -ne $updater.sha256.ToLowerInvariant()) { throw 'GameHub updater self-update verification failed.' }
      Move-Item -LiteralPath $nextScript -Destination $currentScript -Force
      Write-UpdateMessage 'GameHub updater refreshed; the new updater will be used on the next check.'
    } finally {
      if (Test-Path -LiteralPath $nextScript) { Remove-Item -LiteralPath $nextScript -Force }
    }
  }
}
if ($manifest.channel -ne 'stable') { throw 'GameHub updater only accepts the stable channel.' }
if ($HostName -in @('cursor', 'code')) {
  # Editor extensions update inside Cursor/VS Code so users can see progress and receive a restart prompt.
  Unregister-ScheduledTask -TaskName "GameHub Agent Update ($HostName)" -Confirm:$false -ErrorAction SilentlyContinue
  exit 0
}
if ($HostName -in @('cursor', 'code')) {
  $item = $manifest.editorExtension
  if ($previous.version -eq $item.version -and $previous.sha256 -eq $item.sha256) { exit 0 }
  if (-not (Get-Command $HostName -ErrorAction SilentlyContinue)) { throw "$HostName CLI is not available." }
  $artifact = Join-Path $stateRoot $item.filename
  Get-VerifiedFile $item $artifact
  & $HostName --install-extension $artifact --force
  if ($LASTEXITCODE -ne 0) { throw "$HostName rejected the staged GameHub update." }
} elseif ($HostName -eq 'harness') {
  $item = $manifest.harnessPlugin
  $script:updateVersion = [string]$item.version
  $script:updateSha = [string]$item.sha256
  if ($previous.version -eq $item.version -and $previous.sha256 -eq $item.sha256) {
    if ($previous.phase -eq 'ready') { Write-UpdateState 'ready' 100 $null $true } else { Write-UpdateState 'current' 100 }
    exit 0
  }
  if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) { throw 'DeepSeek Harness CLI (dsh) is not available.' }
  $artifact = Join-Path $stateRoot $item.filename
  Write-UpdateState 'downloading'
  Get-VerifiedFile $item $artifact
  Write-UpdateState 'installing' 100
  & dsh plugin --profile web add $artifact
  if ($LASTEXITCODE -ne 0) { throw 'DeepSeek Harness rejected the staged GameHub update.' }
} else {
  $item = $manifest.agentPlugin
  if ($previous.version -eq $item.version -and $previous.sha256 -eq $item.sha256) { exit 0 }
  $marketplaceRoot = Install-PortablePlugin $item
  if (-not (Get-Command $HostName -ErrorAction SilentlyContinue)) { throw "$HostName CLI is not available." }
  if ($HostName -eq 'codex') {
    & codex plugin marketplace upgrade gamehub
    if ($LASTEXITCODE -ne 0) { throw 'Codex could not refresh the GameHub marketplace.' }
  } else {
    # Claude Code reloads marketplace content on its native plugin refresh path.
    # We stage the verified files here and leave activation to the host.
    Write-UpdateMessage "GameHub $($item.version) is staged for Claude Code. Restart Claude Code and refresh the GameHub marketplace."
  }
}

@{ host = $HostName; channel = 'stable'; phase = 'ready'; version = $item.version; sha256 = $item.sha256; percent = 100; message = $null; updatedAt = [DateTime]::UtcNow.ToString('o'); stagedAt = [DateTime]::UtcNow.ToString('o'); restartRequired = $true } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
Write-UpdateMessage "GameHub $($item.version) is installed or staged for $HostName. Restart the host to activate it."
