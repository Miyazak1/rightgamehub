#!/bin/sh
set -eu
host="${1:-}"
base_url="https://mooyu.fun"
if [ -z "$host" ]; then
  for candidate in cursor code codex claude; do
    if command -v "$candidate" >/dev/null 2>&1; then host="$candidate"; break; fi
  done
fi
case "$host" in cursor|code|codex|claude) ;; *) echo "No supported Agent CLI was selected or found on PATH." >&2; exit 1 ;; esac
command -v node >/dev/null 2>&1 || { echo "Node.js is required to verify and install GameHub." >&2; exit 1; }
data_root="${XDG_DATA_HOME:-$HOME/.local/share}/gamehub"
mkdir -p "$data_root"
node - "$base_url" "$host" "$data_root" <<'NODE'
const [baseUrl, host, dataRoot] = process.argv.slice(2);
const { createHash } = await import('node:crypto');
const { mkdir, writeFile } = await import('node:fs/promises');
const { dirname, isAbsolute, join, sep } = await import('node:path');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestResponse = await fetch(baseUrl + '/downloads/manifest.json');
if (!manifestResponse.ok) throw new Error('Unable to download the GameHub manifest.');
const manifest = await manifestResponse.json();
if (host === 'cursor' || host === 'code') {
  const item = manifest.editorExtension;
  if (!item.supportedHosts.includes(host)) throw new Error('Unsupported editor host: ' + host);
  const response = await fetch(item.url);
  if (!response.ok) throw new Error('Unable to download the GameHub VSIX.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== item.sha256.toLowerCase()) throw new Error('GameHub VSIX SHA-256 verification failed.');
  const output = join(dataRoot, 'gamehub-agent-current.vsix');
  await writeFile(output, bytes);
  console.log(output);
} else {
  const item = manifest.agentPlugin;
  if (!item.supportedHosts.includes(host)) throw new Error('Unsupported Agent host: ' + host);
  const response = await fetch(item.url);
  if (!response.ok) throw new Error('Unable to download the GameHub plugin bundle.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== item.sha256.toLowerCase()) throw new Error('GameHub plugin bundle SHA-256 verification failed.');
  const bundle = JSON.parse(bytes.toString('utf8'));
  const root = join(dataRoot, 'agent-marketplace');
  for (const file of bundle.files) {
    if (isAbsolute(file.path) || file.path.split('/').includes('..')) throw new Error('Unsafe plugin path: ' + file.path);
    const content = Buffer.from(file.contentBase64, 'base64');
    if (hash(content) !== file.sha256.toLowerCase()) throw new Error('Plugin file verification failed: ' + file.path);
    const output = join(root, ...file.path.split('/'));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, content);
  }
  console.log(root);
}
NODE
if [ "$host" = cursor ] || [ "$host" = code ]; then
  vsix="$data_root/gamehub-agent-current.vsix"
  [ -f "$vsix" ] || { echo "Verified VSIX was not created." >&2; exit 1; }
  "$host" --install-extension "$vsix" --force
  echo "GameHub installed for $host. Reload the editor and open GameHub from the Activity Bar."
else
  marketplace_root="$data_root/agent-marketplace"
  if ! "$host" plugin marketplace add "$marketplace_root"; then
    "$host" plugin marketplace list | grep -qi gamehub || { echo "$host could not add the GameHub marketplace." >&2; exit 1; }
  fi
  if [ "$host" = claude ]; then
    claude plugin install gamehub@gamehub
    echo "GameHub installed for Claude Code. Start a new session or reload plugins."
  else
    echo "GameHub marketplace added to Codex. Open the Plugins Directory, select GameHub Plugins, and install gamehub."
  fi
fi
