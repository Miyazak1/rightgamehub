import OSS from 'ali-oss';
import Credentials, { Config as CredentialConfig } from '@alicloud/credentials';

export function createOssClientProvider({ region, endpoint, bucket, roleName }) {
  let pending;
  return async function getOssClient() {
    if (!pending) {
      pending = (async () => {
        const credentialClient = new Credentials.default(new CredentialConfig({
          type: 'ecs_ram_role',
          roleName,
          disableIMDSv1: true,
        }));
        const credential = await credentialClient.getCredential();
        return new OSS({
          region,
          endpoint,
          bucket,
          authorizationV4: true,
          secure: true,
          accessKeyId: credential.accessKeyId,
          accessKeySecret: credential.accessKeySecret,
          stsToken: credential.securityToken,
          refreshSTSTokenInterval: 0,
          refreshSTSToken: async () => {
            const refreshed = await credentialClient.getCredential();
            return {
              accessKeyId: refreshed.accessKeyId,
              accessKeySecret: refreshed.accessKeySecret,
              stsToken: refreshed.securityToken,
            };
          },
        });
      })().catch(error => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}
