import crypto from 'node:crypto';
import { loadConfig } from './config.mjs';
import { createOssClientProvider } from './oss-client.mjs';

const config = loadConfig(process.env);
if (config.objectStorageProvider !== 'aliyun-oss') {
  throw new Error('OBJECT_STORAGE_PROVIDER must be aliyun-oss to run the OSS smoke check.');
}

const getClient = createOssClientProvider({
  region: config.ossRegion,
  endpoint: config.ossEndpoint,
  bucket: config.ossBucket,
  roleName: config.ossEcsRoleName,
});
const client = await getClient();
const key = `staging/.healthchecks/${crypto.randomUUID()}.txt`;
const body = Buffer.from(`gamehub-oss-smoke:${crypto.randomUUID()}\n`, 'utf8');
let uploaded = false;

try {
  await client.put(key, body, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
  uploaded = true;
  const result = await client.get(key);
  if (!Buffer.isBuffer(result.content) || !result.content.equals(body)) {
    throw new Error('OSS smoke object content mismatch.');
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    provider: config.objectStorageProvider,
    region: config.ossRegion,
    bucket: config.ossBucket,
    endpoint: config.ossEndpoint,
    roleName: config.ossEcsRoleName,
  })}\n`);
} finally {
  if (uploaded) await client.delete(key).catch(() => {});
}
