import { spawn } from 'node:child_process';
import { fail } from './errors.mjs';

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$wrapperSource = @'
using System;
using System.Windows.Forms;
public sealed class MooyuWindowOwner : IWin32Window {
  private readonly IntPtr handle;
  public MooyuWindowOwner(long value) { handle = new IntPtr(value); }
  public IntPtr Handle { get { return handle; } }
}
'@
Add-Type -TypeDefinition $wrapperSource -ReferencedAssemblies System.Windows.Forms
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Multiselect = ([int]$request.maxFiles -gt 1)
$dialog.CheckFileExists = $true
$dialog.CheckPathExists = $true
$dialog.RestoreDirectory = $true
if ($request.extensions.Count -gt 0) {
  $patterns = ($request.extensions | ForEach-Object { '*' + [string]$_ }) -join ';'
  $dialog.Filter = 'Allowed files|' + $patterns
} else { $dialog.Filter = 'All files|*.*' }
$owner = $null
if ($null -ne $request.ownerWindowHandle -and [string]$request.ownerWindowHandle -match '^[1-9][0-9]{0,19}$') {
  $owner = New-Object MooyuWindowOwner ([long]$request.ownerWindowHandle)
}
$result = if ($null -ne $owner) { $dialog.ShowDialog($owner) } else { $dialog.ShowDialog() }
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  $files = @($dialog.FileNames | Select-Object -First ([int]$request.maxFiles))
  [Console]::Out.Write((ConvertTo-Json -InputObject $files -Compress))
} else { [Console]::Out.Write('[]') }
`;
const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');

function invoke(request, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive',
      '-EncodedCommand', encoded], { windowsHide: false, shell: false,
      stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [], errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(Buffer.concat(output).toString('utf8'))
      : reject(Object.assign(new Error('CAPABILITY_DESKTOP_FILE_PICKER_FAILED'), {
        code: 'CAPABILITY_DESKTOP_FILE_PICKER_FAILED',
        detail: Buffer.concat(errors).toString('utf8').slice(0, 500) })));
    child.stdin.end(JSON.stringify(request));
  });
}

export function createWindowsFileSelectionAdapter({ platform = process.platform,
  run = request => invoke(request) } = {}) {
  if (platform !== 'win32' || typeof run !== 'function') {
    fail('CAPABILITY_DESKTOP_FILE_PICKER_CONFIG_INVALID');
  }
  const selectFiles = async ({ extensions = [], maxFiles = 1,
    ownerWindowHandle = null } = {}) => {
    if (!Array.isArray(extensions) || extensions.some(item => !/^\.[a-z0-9]{1,16}$/u.test(item))
      || !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 128
      || ownerWindowHandle != null && !/^[1-9][0-9]{0,19}$/u.test(ownerWindowHandle)) {
      fail('CAPABILITY_DESKTOP_FILE_PICKER_REQUEST_INVALID');
    }
    let value;
    try { value = JSON.parse(await run({ extensions, maxFiles, ownerWindowHandle })); }
    catch (error) {
      if (error?.code) throw error;
      fail('CAPABILITY_DESKTOP_FILE_PICKER_OUTPUT_INVALID');
    }
    if (!Array.isArray(value) || value.length > maxFiles
      || value.some(item => typeof item !== 'string')) {
      fail('CAPABILITY_DESKTOP_FILE_PICKER_OUTPUT_INVALID');
    }
    return value;
  };
  return { selectFiles };
}
