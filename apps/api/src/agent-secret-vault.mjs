import crypto from 'node:crypto';

const decodeMasterKey = value => {
  const raw=String(value??'').trim();
  if(!raw)return null;
  let key;
  if(/^[a-f0-9]{64}$/i.test(raw))key=Buffer.from(raw,'hex');
  else if(/^[A-Za-z0-9_-]{43}$/.test(raw))key=Buffer.from(raw,'base64url');
  else throw new Error('AGENT_SECRET_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex or 43 base64url characters');
  if(key.length!==32)throw new Error('AGENT_SECRET_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
};

export function createAgentSecretVault({masterKey}={}){
  const key=decodeMasterKey(masterKey);
  const available=Boolean(key);
  const requireKey=()=>{if(!key){const error=new Error('Agent secret encryption is not configured');error.code='AGENT_SECRET_VAULT_UNAVAILABLE';error.statusCode=503;throw error;}return key;};
  const aad=(agentUserId,provider)=>Buffer.from(`mooyu-agent-provider-secret-v1\0${agentUserId}\0${provider}`,'utf8');
  return {
    available,
    encrypt(agentUserId,provider,value){const secret=String(value??'').trim();if(secret.length<16||secret.length>2048||/[\x00-\x1f\x7f]/.test(secret)){const error=new Error('Provider key is invalid');error.code='AGENT_PROVIDER_KEY_INVALID';error.statusCode=400;throw error;}const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',requireKey(),nonce);cipher.setAAD(aad(agentUserId,provider));const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return{ciphertext,nonce,authTag:cipher.getAuthTag(),fingerprint:crypto.createHash('sha256').update(secret).digest('hex'),lastFour:secret.slice(-4)};},
    decrypt(agentUserId,provider,record){try{const decipher=crypto.createDecipheriv('aes-256-gcm',requireKey(),record.nonce);decipher.setAAD(aad(agentUserId,provider));decipher.setAuthTag(record.authTag??record.auth_tag);return Buffer.concat([decipher.update(record.ciphertext),decipher.final()]).toString('utf8');}catch(error){if(error?.code==='AGENT_SECRET_VAULT_UNAVAILABLE')throw error;const safe=new Error('Stored provider key cannot be decrypted');safe.code='AGENT_PROVIDER_KEY_DECRYPT_FAILED';safe.statusCode=503;throw safe;}},
  };
}

export {decodeMasterKey};
