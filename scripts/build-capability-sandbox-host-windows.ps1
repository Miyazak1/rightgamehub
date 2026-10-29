[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [switch]$SkipFixture
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot '..\.runtime\capability-sandbox-host'
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$framework = Split-Path $compiler
$sourceRoot = Join-Path $PSScriptRoot '..\apps\capability-executor\native\windows'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
  throw 'CAPABILITY_SANDBOX_CSC_NOT_FOUND'
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function Invoke-Csc([string]$Source, [string]$Output) {
  & $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$Output" `
    "/reference:$(Join-Path $framework 'System.Web.Extensions.dll')" $Source
  if ($LASTEXITCODE -ne 0) { throw "CAPABILITY_SANDBOX_BUILD_FAILED:$Source" }
}

$hostSource = Join-Path $sourceRoot 'MooyuCapabilitySandboxHost.cs'
$fixtureSource = Join-Path $sourceRoot 'SandboxFixtureCapability.cs'
$hostOutput = Join-Path $OutputDirectory 'MooyuCapabilitySandboxHost.exe'
$fixtureOutput = Join-Path $OutputDirectory 'SandboxFixtureCapability.exe'
Invoke-Csc $hostSource $hostOutput
if (-not $SkipFixture) { Invoke-Csc $fixtureSource $fixtureOutput }

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  }
  finally { $stream.Dispose() }
}

$hostHash = Get-Sha256 $hostOutput
$result = [ordered]@{
  schemaVersion = 'capability-sandbox-host-build-v1'
  hostPath = (Resolve-Path $hostOutput).Path
  hostSha256 = $hostHash
}
if (-not $SkipFixture) {
  $result.fixturePath = (Resolve-Path $fixtureOutput).Path
  $result.fixtureSha256 = Get-Sha256 $fixtureOutput
}
[pscustomobject]$result | ConvertTo-Json -Compress
