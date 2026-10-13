param(
  [ValidateSet('cursor', 'code', 'harness', 'codex', 'claude')]
  [string]$HostName = '',
  [ValidateSet('auto', 'zh-CN', 'en')]
  [string]$Locale = 'auto'
)
$ErrorActionPreference = 'Stop'
$baseUrl = 'https://mooyu.fun'
$UseEnglish = if ($Locale -eq 'en') { $true } elseif ($Locale -eq 'zh-CN') { $false } else { -not [System.Globalization.CultureInfo]::CurrentUICulture.Name.StartsWith('zh', [System.StringComparison]::OrdinalIgnoreCase) }
function Text([string]$Zh, [string]$En) { if ($script:UseEnglish) { $En } else { $Zh } }
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
    if ($actual -ne $manifest.updater.windows.sha256.ToLowerInvariant()) { throw (Text '墨鱼工坊更新器 SHA-256 校验失败。' 'MOOYU.FUN updater SHA-256 verification failed.') }
    Move-Item -LiteralPath $partial -Destination $updaterPath -Force
    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$updaterPath`" -HostName $HostName -Quiet"
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(15) -RepetitionInterval (New-TimeSpan -Hours $manifest.updatePolicy.checkIntervalHours)
    $taskDescription = Text '下载经过校验的墨鱼工坊稳定版更新；Agent 重启后生效。' 'Download verified stable MOOYU.FUN updates; activate them after an Agent restart.'
    Register-ScheduledTask -TaskName "GameHub Agent Update ($HostName)" -Action $action -Trigger $trigger -Description $taskDescription -Force | Out-Null
    Write-Host (Text "已为 $HostName 启用墨鱼工坊自动更新；Agent 重启后生效。" "Automatic MOOYU.FUN updates are enabled for $HostName and activate after the Agent restarts.")
  } catch {
    Write-Warning (Text "墨鱼工坊已安装，但无法创建自动更新任务：$($_.Exception.Message)" "MOOYU.FUN is installed, but the automatic update task could not be created: $($_.Exception.Message)")
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
    if ($actual -ne $extension.sha256.ToLowerInvariant()) { throw (Text '墨鱼工坊 VSIX 的 SHA-256 校验失败。' 'MOOYU.FUN VSIX SHA-256 verification failed.') }
    & $HostName --install-extension $tempFile --force
    if ($LASTEXITCODE -ne 0) { throw (Text "$HostName 未能安装墨鱼工坊 VSIX。" "$HostName could not install the MOOYU.FUN VSIX.") }
    Write-Host (Text "墨鱼工坊 $($extension.version) 已安装到 $HostName；后续更新会在扩展内静默下载，并在编辑器重启后生效。" "MOOYU.FUN $($extension.version) is installed in $HostName. Verified updates will download silently and activate after the editor restarts.")
    Write-Host (Text '请重载编辑器，然后从 Activity Bar 打开墨鱼工坊。' 'Reload the editor, then open MOOYU.FUN from the Activity Bar.')
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
    if ($actual -ne $item.sha256.ToLowerInvariant()) { throw (Text '墨鱼工坊 Harness 包的 SHA-256 校验失败。' 'MOOYU.FUN Harness package SHA-256 verification failed.') }
    & dsh plugin --profile web add $tempFile
    if ($LASTEXITCODE -ne 0) { throw (Text 'DeepSeek Harness 未能安装墨鱼工坊包。' 'DeepSeek Harness could not install the MOOYU.FUN package.') }
    Write-Host (Text '墨鱼工坊已安装到 Harness web profile。请重启 dsh web。' 'MOOYU.FUN is installed in the Harness web profile. Restart dsh web.')
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
  if ($actual -ne $plugin.sha256.ToLowerInvariant()) { throw (Text '墨鱼工坊插件包的 SHA-256 校验失败。' 'MOOYU.FUN plugin bundle SHA-256 verification failed.') }
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
  if ($knownMarketplaces -notmatch 'gamehub') {
    $marketplaceError = Text "$HostName 无法添加墨鱼工坊 marketplace：$marketplaceOutput" "$HostName could not add the MOOYU.FUN marketplace: $marketplaceOutput"
    throw $marketplaceError
  }
}
if ($HostName -eq 'claude') {
  & claude plugin install gamehub@gamehub
  if ($LASTEXITCODE -ne 0) { throw (Text 'Claude Code 无法安装墨鱼工坊插件。' 'Claude Code could not install the MOOYU.FUN plugin.') }
  Write-Host (Text '墨鱼工坊已安装到 Claude Code。请新建会话或重新加载插件。' 'MOOYU.FUN is installed in Claude Code. Start a new session or reload plugins.')
} else {
  Write-Host (Text '墨鱼工坊 marketplace 已添加到 Codex。请打开 Plugins Directory，在“墨鱼工坊插件”来源中安装 gamehub。' 'The MOOYU.FUN marketplace was added to Codex. Open the Plugins Directory, select the MOOYU.FUN Plugins source, and install gamehub.')
}
Enable-GameHubUpdates
