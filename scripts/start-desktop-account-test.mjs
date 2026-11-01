import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createIsolatedAccountApi } from '../tests/desktop/account-api-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)), base=path.join(root,'.runtime/desktop-shell');
await fs.mkdir(base,{recursive:true});
const profile=await fs.mkdtemp(path.join(base,'manual-account-'));
const backend=await createIsolatedAccountApi({onMail:code=>{ console.log('本轮本地模拟邮箱验证码（不发送邮件）: '+code); }});
console.log('隔离账号测试；可输入任意 example.test 邮箱。API: '+backend.origin+'；数据只在内存中。');
const child=spawn(process.execPath,[path.join(root,'scripts/start-desktop-shell.mjs'),'--account-api',backend.origin,'--profile-root',profile],{cwd:root,stdio:'inherit',windowsHide:true});
try { await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{process.exitCode=code??1;resolve();});}); }
finally { await backend.close(); }
