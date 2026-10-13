#!/bin/sh
set -eu
host="${1:-}"
base_url="https://mooyu.fun"
if [ -z "$host" ]; then
  for candidate in cursor code dsh codex claude; do
    if command -v "$candidate" >/dev/null 2>&1; then host="$candidate"; break; fi
  done
fi
[ "$host" = dsh ] && host=harness
case "$host" in cursor|code|harness|codex|claude) ;; *) echo "No supported Agent CLI was selected or found on PATH." >&2; exit 1 ;; esac
command -v node >/dev/null 2>&1 || { echo "Node.js is required to verify and install MOOYU.FUN." >&2; exit 1; }
data_root="${XDG_DATA_HOME:-$HOME/.local/share}/gamehub"
mkdir -p "$data_root"
node - "$base_url" "$host" "$data_root" <<'NODE'
const [baseUrl, host, dataRoot] = process.argv.slice(2);
const { createHash } = await import('node:crypto');
const { chmod, mkdir, writeFile } = await import('node:fs/promises');
const { dirname, isAbsolute, join, sep } = await import('node:path');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestResponse = await fetch(baseUrl + '/downloads/manifest.json');
if (!manifestResponse.ok) throw new Error('Unable to download the MOOYU.FUN manifest.');
const manifest = await manifestResponse.json();
if (host !== 'cursor' && host !== 'code') {
  const updater = manifest.updater?.portable;
  if (!updater) throw new Error('Portable MOOYU.FUN updater metadata is missing.');
  const updaterResponse = await fetch(updater.url);
  if (!updaterResponse.ok) throw new Error('Unable to download the MOOYU.FUN updater.');
  const updaterBytes = Buffer.from(await updaterResponse.arrayBuffer());
  if (hash(updaterBytes) !== updater.sha256.toLowerCase()) throw new Error('MOOYU.FUN updater SHA-256 verification failed.');
  const updaterPath = join(dataRoot, 'agent-update.mjs');
  await writeFile(updaterPath, updaterBytes);
  await chmod(updaterPath, 0o700);
}
if (host === 'cursor' || host === 'code') {
  const item = manifest.editorExtension;
  if (!item.supportedHosts.includes(host)) throw new Error('Unsupported editor host: ' + host);
  const response = await fetch(item.url);
  if (!response.ok) throw new Error('Unable to download the MOOYU.FUN VSIX.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== item.sha256.toLowerCase()) throw new Error('MOOYU.FUN VSIX SHA-256 verification failed.');
  const output = join(dataRoot, 'gamehub-agent-current.vsix');
  await writeFile(output, bytes);
  console.log(output);
} else if (host === 'harness') {
  const item = manifest.harnessPlugin;
  if (!item.supportedHosts.includes(host)) throw new Error('Unsupported Harness host.');
  const response = await fetch(item.url);
  if (!response.ok) throw new Error('Unable to download the MOOYU.FUN Harness package.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== item.sha256.toLowerCase()) throw new Error('MOOYU.FUN Harness package SHA-256 verification failed.');
  await writeFile(join(dataRoot, 'gamehub-dsh-plugin-current.tgz'), bytes);
} else {
  const item = manifest.agentPlugin;
  if (!item.supportedHosts.includes(host)) throw new Error('Unsupported Agent host: ' + host);
  const response = await fetch(item.url);
  if (!response.ok) throw new Error('Unable to download the MOOYU.FUN plugin bundle.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== item.sha256.toLowerCase()) throw new Error('MOOYU.FUN plugin bundle SHA-256 verification failed.');
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
  echo "MOOYU.FUN（墨鱼工坊）installed for $host. Reload the editor and open 墨鱼工坊 from the Activity Bar."
elif [ "$host" = harness ]; then
  command -v dsh >/dev/null 2>&1 || { echo "DeepSeek Harness CLI (dsh) was not found on PATH." >&2; exit 1; }
  dsh plugin --profile web add "$data_root/gamehub-dsh-plugin-current.tgz"
  echo "MOOYU.FUN（墨鱼工坊）installed for the Harness web profile. Restart dsh web."
else
  marketplace_root="$data_root/agent-marketplace"
  if ! "$host" plugin marketplace add "$marketplace_root"; then
    "$host" plugin marketplace list | grep -qi gamehub || { echo "$host could not add the MOOYU.FUN marketplace." >&2; exit 1; }
  fi
  if [ "$host" = claude ]; then
    claude plugin install gamehub@gamehub
    echo "MOOYU.FUN（墨鱼工坊）installed for Claude Code. Start a new session or reload plugins."
  else
    echo "MOOYU.FUN marketplace added to Codex. Open the Plugins Directory, select 墨鱼工坊插件, and install gamehub."
  fi
fi

updater="$data_root/agent-update.mjs"
if [ "$host" = cursor ] || [ "$host" = code ]; then
  echo "Future MOOYU.FUN updates download silently inside the editor extension and activate after restart."
elif command -v crontab >/dev/null 2>&1; then
  marker="# GameHub-Agent-Update-$host"
  schedule="17 */6 * * * /usr/bin/env node '$updater' '$host' '$data_root' --quiet $marker"
  { crontab -l 2>/dev/null | grep -v "GameHub-Agent-Update-$host" || true; echo "$schedule"; } | crontab -
  echo "Automatic MOOYU.FUN updates enabled for $host. Updates activate after the Agent restarts."
else
  echo "MOOYU.FUN is installed, but cron is unavailable; run $updater manually to update." >&2
fi
