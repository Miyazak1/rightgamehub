[CmdletBinding()]
param(
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot '..\.runtime\capability-tray'
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$framework = Split-Path $compiler
$source = Join-Path $PSScriptRoot '..\apps\capability-executor\native\windows\MooyuCapabilityTray.cs'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
  throw 'CAPABILITY_TRAY_CSC_NOT_FOUND'
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$references = @(
  "/reference:$(Join-Path $framework 'System.dll')",
  "/reference:$(Join-Path $framework 'System.Core.dll')",
  "/reference:$(Join-Path $framework 'System.Drawing.dll')",
  "/reference:$(Join-Path $framework 'System.Security.dll')",
  "/reference:$(Join-Path $framework 'System.Web.Extensions.dll')",
  "/reference:$(Join-Path $framework 'System.Windows.Forms.dll')"
)

function Invoke-Csc([string]$Target, [string]$Output, [string[]]$Defines = @()) {
  $arguments = @('/nologo', "/target:$Target", '/platform:x64', '/optimize+', "/out:$Output")
  if ($Defines.Count -gt 0) { $arguments += "/define:$($Defines -join ';')" }
  $arguments += $references
  $arguments += $source
  & $compiler @arguments
  if ($LASTEXITCODE -ne 0) { throw "CAPABILITY_TRAY_BUILD_FAILED:$Target" }
}

$tray = Join-Path $OutputDirectory 'MooyuCapabilityTray.exe'
$acceptance = Join-Path $OutputDirectory 'MooyuCapabilityTrayAcceptance.exe'
Invoke-Csc 'winexe' $tray
Invoke-Csc 'exe' $acceptance @('TRAY_ACCEPTANCE_CONSOLE')

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  }
  finally { $stream.Dispose() }
}

[pscustomobject]@{
  schemaVersion = 'capability-desktop-tray-build-v1'
  trayPath = (Resolve-Path $tray).Path
  traySha256 = Get-Sha256 $tray
  acceptancePath = (Resolve-Path $acceptance).Path
  acceptanceSha256 = Get-Sha256 $acceptance
} | ConvertTo-Json -Compress
