$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectRoot 'artifacts/native'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler is required on Windows.' }
& $compiler /nologo /optimize+ /target:exe /platform:x64 /r:System.Drawing.dll /r:System.Web.Extensions.dll "/out:$outputDir/WindowBridge.exe" (Join-Path $projectRoot 'poc/native/WindowBridge.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native probe build failed.' }
Write-Output "Built $outputDir/WindowBridge.exe"
