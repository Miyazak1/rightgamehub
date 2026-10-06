$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$extensionRoot = Join-Path $projectRoot 'extensions\vscode'
$artifactRoot = Join-Path $projectRoot 'artifacts'
$package = Get-Content (Join-Path $extensionRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$artifact = Join-Path $artifactRoot ("{0}-{1}.vsix" -f $package.name, $package.version)

[System.IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
if ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($artifact)) -ne [System.IO.Path]::GetFullPath($artifactRoot)) {
  throw 'Refusing to write the VSIX outside the artifact directory.'
}
if (Test-Path -LiteralPath $artifact) { Remove-Item -LiteralPath $artifact -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($artifact, [System.IO.FileMode]::CreateNew)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false)

function Add-TextEntry([string]$name, [string]$text) {
  $entry = $archive.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
  $writer = New-Object System.IO.StreamWriter($entry.Open(), [System.Text.UTF8Encoding]::new($false))
  try { $writer.Write($text) } finally { $writer.Dispose() }
}

function Add-FileEntry([string]$name, [string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing VSIX input: $path" }
  $entry = $archive.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
  $input = [System.IO.File]::OpenRead($path)
  $output = $entry.Open()
  try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
}

$contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="cjs" ContentType="application/javascript" />
  <Default Extension="mjs" ContentType="application/javascript" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
'@
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="zh-CN" Id="$($package.name)" Version="$($package.version)" Publisher="$($package.publisher)" />
    <DisplayName>$($package.displayName)</DisplayName>
    <Description xml:space="preserve">$($package.description)</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($package.engines.vscode)" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
"@

try {
  Add-TextEntry '[Content_Types].xml' $contentTypes
  Add-TextEntry 'extension.vsixmanifest' $manifest
  Add-FileEntry 'extension/package.json' (Join-Path $extensionRoot 'package.json')
  Add-FileEntry 'extension/gamehub-extension.cjs' (Join-Path $extensionRoot 'gamehub-extension.cjs')
  Add-FileEntry 'extension/desktop-launcher.mjs' (Join-Path $projectRoot 'extensions\harness\src\desktop-launcher.mjs')
  foreach ($saveModule in @('store-contract.mjs', 'store-rpc.mjs', 'sqlite-store.mjs')) {
    Add-FileEntry "extension/save-cache/$saveModule" (Join-Path $projectRoot "packages/save-cache/src/$saveModule")
  }
  Add-FileEntry 'extension/media/gamehub.js' (Join-Path $extensionRoot 'media\gamehub.js')
  Add-FileEntry 'extension/media/arcade.svg' (Join-Path $extensionRoot 'media\arcade.svg')
} finally {
  $archive.Dispose()
  $stream.Dispose()
}

Write-Host "Packed $artifact"
