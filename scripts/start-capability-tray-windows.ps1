[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataRoot,
  [string]$Executable,
  [ValidateRange(500, 60000)]
  [int]$PollMilliseconds = 2000
)

$ErrorActionPreference = 'Stop'
if (-not [System.IO.Path]::IsPathRooted($DataRoot)) {
  throw 'CAPABILITY_TRAY_ROOT_REQUIRED'
}
if ([string]::IsNullOrWhiteSpace($Executable)) {
  $Executable = Join-Path $PSScriptRoot '..\.runtime\capability-tray\MooyuCapabilityTray.exe'
}
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
  throw 'CAPABILITY_TRAY_EXECUTABLE_NOT_FOUND'
}

$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$resolvedRoot = [System.IO.Path]::GetFullPath($DataRoot)
$process = Start-Process -FilePath $resolvedExecutable -ArgumentList @(
  '--root', ('"{0}"' -f $resolvedRoot),
  '--poll-ms', [string]$PollMilliseconds
) -WindowStyle Hidden -PassThru

[pscustomobject]@{
  schemaVersion = 'capability-desktop-tray-launch-v1'
  processId = $process.Id
  executable = $resolvedExecutable
  dataRoot = $resolvedRoot
} | ConvertTo-Json -Compress
