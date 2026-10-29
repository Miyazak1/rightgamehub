import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';

const MAX_RENDERED_BYTES = 2 * 1024 * 1024;
const ARTIFACT_NAME = /^[a-z][a-z0-9.-]{2,119}\.json$/u;
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.action -eq 'preview') {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = [string]$request.title
  $form.Width = 960
  $form.Height = 720
  $form.StartPosition = 'CenterScreen'
  $viewer = New-Object System.Windows.Forms.TextBox
  $viewer.Dock = 'Fill'
  $viewer.Multiline = $true
  $viewer.ReadOnly = $true
  $viewer.WordWrap = $false
  $viewer.ScrollBars = 'Both'
  $viewer.Font = New-Object System.Drawing.Font('Consolas', 10)
  $viewer.Text = [string]$request.content
  $form.Controls.Add($viewer)
  [void]$form.ShowDialog()
  $result = @{ opened = $true; cancelled = $false }
} elseif ($request.action -eq 'save') {
  $dialog = New-Object System.Windows.Forms.SaveFileDialog
  $dialog.Title = '保存墨鱼工坊任务产物'
  $dialog.FileName = [string]$request.suggestedName
  $dialog.Filter = 'JSON 文件 (*.json)|*.json'
  $dialog.AddExtension = $true
  $dialog.DefaultExt = 'json'
  $dialog.OverwritePrompt = $true
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $result = @{ selectedPath = $dialog.FileName; cancelled = $false }
  } else { $result = @{ selectedPath = $null; cancelled = $true } }
} else { throw 'CAPABILITY_DESKTOP_ARTIFACT_UI_ACTION_INVALID' }
[Console]::Out.Write((ConvertTo-Json -InputObject $result -Compress))
`;
const encodedScript = Buffer.from(SCRIPT, 'utf16le').toString('base64');

function invoke(request, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive',
      '-EncodedCommand', encodedScript], { windowsHide: true, shell: false,
      stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [], errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(Buffer.concat(output).toString('utf8'))
      : reject(Object.assign(new Error('CAPABILITY_DESKTOP_ARTIFACT_UI_FAILED'), {
        code: 'CAPABILITY_DESKTOP_ARTIFACT_UI_FAILED',
        detail: Buffer.concat(errors).toString('utf8').slice(0, 500) })));
    child.stdin.end(JSON.stringify(request));
  });
}

const validRequest = request => request && typeof request === 'object'
  && typeof request.title === 'string' && request.title.length >= 3 && request.title.length <= 120
  && ARTIFACT_NAME.test(request.suggestedName) && request.mediaType === 'application/json'
  && typeof request.content === 'string' && Buffer.byteLength(request.content, 'utf8') > 0
  && Buffer.byteLength(request.content, 'utf8') <= MAX_RENDERED_BYTES
  && request.readOnly === true
  && ['host-preview', 'external-app', 'download'].includes(request.requestedMode);

export function createWindowsCapabilityArtifactUi({ platform = process.platform,
  run = request => invoke(request), fileSystem = fs.promises } = {}) {
  if (platform !== 'win32' || typeof run !== 'function'
    || typeof fileSystem?.writeFile !== 'function') {
    fail('CAPABILITY_DESKTOP_ARTIFACT_UI_CONFIG_INVALID');
  }
  const parse = async request => {
    let value;
    try { value = JSON.parse(await run(request)); }
    catch (error) {
      if (error?.code) throw error;
      fail('CAPABILITY_DESKTOP_ARTIFACT_UI_OUTPUT_INVALID');
    }
    return value;
  };
  const previewJson = async request => {
    if (!validRequest(request) || request.requestedMode === 'download') {
      fail('CAPABILITY_DESKTOP_ARTIFACT_UI_REQUEST_INVALID');
    }
    const value = await parse({ action: 'preview', title: request.title,
      content: request.content });
    if (!value || Object.keys(value).length !== 2 || value.opened !== true
      || value.cancelled !== false) fail('CAPABILITY_DESKTOP_ARTIFACT_UI_OUTPUT_INVALID');
    return { opened: true, cancelled: false };
  };
  const saveJson = async request => {
    if (!validRequest(request) || request.requestedMode !== 'download') {
      fail('CAPABILITY_DESKTOP_ARTIFACT_UI_REQUEST_INVALID');
    }
    const value = await parse({ action: 'save', suggestedName: request.suggestedName });
    if (!value || Object.keys(value).length !== 2 || typeof value.cancelled !== 'boolean'
      || !Object.hasOwn(value, 'selectedPath')) {
      fail('CAPABILITY_DESKTOP_ARTIFACT_UI_OUTPUT_INVALID');
    }
    if (value.cancelled === true && value.selectedPath === null) {
      return { opened: false, cancelled: true };
    }
    if (value.cancelled !== false || typeof value.selectedPath !== 'string'
      || !path.isAbsolute(value.selectedPath) || path.extname(value.selectedPath).toLowerCase() !== '.json') {
      fail('CAPABILITY_DESKTOP_ARTIFACT_UI_OUTPUT_INVALID');
    }
    await fileSystem.writeFile(value.selectedPath, request.content, { encoding: 'utf8' });
    return { opened: true, cancelled: false };
  };
  return Object.freeze({ previewJson, saveJson });
}
