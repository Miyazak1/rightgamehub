import path from 'node:path';
import os from 'node:os';
import { createTransferService } from './transfer-service.mjs';
import { createGcmCredentialStore } from './credential-store.mjs';

export const name = 'gamehub-m0';
export const inject = ['connection'];
export async function apply(ctx) {
  const root = process.env.GAMEHUB_STORAGE_DIR || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'gamehub-storage');
  const credentialStore = await createGcmCredentialStore();
  const service = await createTransferService({ root, credentialStore, desktopOptions: { enabled: process.platform === 'win32' } });
  ctx.effect(() => () => service.close(), 'gamehub: close transfers');
  for (const route of service.routes) ctx.effect(() => ctx.connection.fetch.register(route), `gamehub: ${route.path}`);
}
