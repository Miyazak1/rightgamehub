import fs from 'node:fs';import path from 'node:path';import {processProbeCode} from './verify-napcat-mode-readonly.mjs';import vm from 'node:vm';
new vm.Script(processProbeCode);
const out=process.argv[2];if(!out||fs.existsSync(out))throw Error('NEW_OUTPUT_REQUIRED');
const source=fs.readFileSync(new URL('./verify-napcat-mode-readonly.mjs',import.meta.url),'utf8');
const shell=`(
set -euo pipefail
runtime=''
for candidate in /root/mooyu-qq-gateway-runtime-20261124-*/node; do
  if test -f "$candidate" && test -x "$candidate"; then
    case "$("$candidate" --version)" in v22.*) runtime="$candidate"; break ;; esac
  fi
done
if test -z "$runtime"; then printf '%s\\n' 'VERIFIED_PRIVATE_NODE22_NOT_FOUND'; exit 1; fi
"$runtime" --input-type=module <<'NODE'
${source}
await readOnlyModeVerification();
NODE
)
`;
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'server-qq-gateway-readonly-verification.txt'),shell);fs.writeFileSync(path.join(out,'syntax-check.mjs'),source+'\nawait readOnlyModeVerification();\n');console.log(out);
