#!/bin/sh
set -eu
host="${1:-}"
base_url="https://mooyu.fun"
if [ -z "$host" ]; then
  if command -v cursor >/dev/null 2>&1; then host=cursor
  elif command -v code >/dev/null 2>&1; then host=code
  else echo "Cursor or VS Code CLI was not found on PATH." >&2; exit 1
  fi
fi
case "$host" in cursor|code) ;; *) echo "Unsupported host: $host" >&2; exit 1 ;; esac
command -v node >/dev/null 2>&1 || { echo "Node.js is required to parse and verify the signed download manifest." >&2; exit 1; }
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
node - "$base_url" "$host" "$tmp_dir" <<'NODE'
const [baseUrl, host, tempDir] = process.argv.slice(2);
const { createHash } = await import('node:crypto');
const { writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');
const manifestResponse = await fetch(baseUrl + '/downloads/manifest.json');
if (!manifestResponse.ok) throw new Error('Unable to download the GameHub manifest.');
const manifest = await manifestResponse.json();
const extension = manifest.editorExtension;
if (!extension.supportedHosts.includes(host)) throw new Error('Unsupported host: ' + host);
const response = await fetch(extension.url);
if (!response.ok) throw new Error('Unable to download the GameHub VSIX.');
const bytes = Buffer.from(await response.arrayBuffer());
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== extension.sha256.toLowerCase()) throw new Error('GameHub VSIX SHA-256 verification failed.');
const output = join(tempDir, extension.filename);
await writeFile(output, bytes);
console.log(JSON.stringify({ output, version: extension.version }));
NODE
result="$(node -e 'const fs=require("fs");const p=process.argv[1];process.stdout.write(fs.readdirSync(p).find(x=>x.endsWith(".vsix"))||"")' "$tmp_dir")"
[ -n "$result" ] || { echo "Verified VSIX was not created." >&2; exit 1; }
"$host" --install-extension "$tmp_dir/$result" --force
echo "GameHub installed for $host. Reload the editor and open GameHub from the Activity Bar."
