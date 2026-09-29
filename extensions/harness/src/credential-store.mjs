import { spawn } from 'node:child_process';

const SERVICE = { protocol: 'https', host: 'credentials.gamehub.local', username: 'gamehub-session' };
const TOKEN = /^[A-Za-z0-9_-]{32,512}$/;

const inputFor = extra => `${Object.entries({ ...SERVICE, ...extra }).map(([key, value]) => `${key}=${value}`).join('\n')}\n\n`;
const parseOutput = output => Object.fromEntries(output.split(/\r?\n/).filter(Boolean).map(line => {
  const split = line.indexOf('=');
  return split < 1 ? [line, ''] : [line.slice(0, split), line.slice(split + 1)];
}));
const validateTokens = tokens => {
  if (!tokens || !TOKEN.test(tokens.accessToken ?? '') || !TOKEN.test(tokens.refreshToken ?? '')) throw Object.assign(new Error('Credential payload is invalid.'), { code: 'CREDENTIAL_PAYLOAD_INVALID' });
  const serialized = JSON.stringify(tokens);
  if (Buffer.byteLength(serialized) > 8192) throw Object.assign(new Error('Credential payload is too large.'), { code: 'CREDENTIAL_PAYLOAD_INVALID' });
  return serialized;
};

export async function runCredentialManager(action, input = '') {
  const args = action === 'version' ? ['credential-manager', '--version'] : ['credential-manager', action];
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GCM_NAMESPACE: 'gamehub-harness', GCM_INTERACTIVE: 'Never', GCM_PROVIDER: 'generic', GCM_AUTODETECT_TIMEOUT: '-1' },
    });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(Object.assign(new Error('Credential Manager timed out.'), { code: 'CREDENTIAL_STORE_UNAVAILABLE' })); }, 5000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 16384) child.kill(); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 16384) child.kill(); });
    child.once('error', error => finish(Object.assign(error, { code: 'CREDENTIAL_STORE_UNAVAILABLE' })));
    child.once('close', code => code === 0 ? finish(null, stdout) : finish(Object.assign(new Error(stderr.trim() || `Credential Manager exited with ${code}.`), { code: 'CREDENTIAL_STORE_UNAVAILABLE' })));
    child.stdin.end(input);
  });
}

export async function createGcmCredentialStore({ run = runCredentialManager, platform = process.platform } = {}) {
  let available = true;
  try { await run('version'); } catch { available = false; }
  const persistence = available ? {
    kind: 'os-keychain',
    description: platform === 'win32' ? '登录凭据由 Windows 凭据管理器保护。' : platform === 'darwin' ? '登录凭据由 macOS 钥匙串保护。' : '登录凭据由系统凭据库保护。',
  } : { kind: 'memory', description: '系统凭据库不可用，凭据仅保留到 Harness 本次运行结束。' };
  const requireStore = () => { if (!available) throw Object.assign(new Error('System credential store is unavailable.'), { code: 'CREDENTIAL_STORE_UNAVAILABLE' }); };
  return {
    available,
    persistence,
    async get() {
      requireStore();
      let output;
      try { output = await run('get', inputFor({})); }
      catch (error) { if (error.code === 'CREDENTIAL_STORE_UNAVAILABLE') return null; throw error; }
      const result = parseOutput(output);
      if (!result.password) return null;
      try { return JSON.parse(Buffer.from(result.password, 'base64url').toString('utf8')); }
      catch { throw Object.assign(new Error('Stored credentials are invalid.'), { code: 'CREDENTIAL_STORE_CORRUPT' }); }
    },
    async set(tokens) {
      requireStore();
      const password = Buffer.from(validateTokens(tokens), 'utf8').toString('base64url');
      await run('store', inputFor({ password }));
    },
    async clear() { requireStore(); await run('erase', inputFor({})); },
  };
}
