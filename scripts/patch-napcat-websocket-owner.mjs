// Deterministic patch of the exact vendor build used by the retained gateway.
// Never imports/starts QQ or modifies an input file in place.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
export const NAPCAT_OWNER_BASE_SHA256='7967149b1c4f3d30e0506c842f84b7b925c2d361e3c9c75ebf0d4ff24dbdedaa';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function patchNativeWebSocketClient(client){
 const replace=(before,after)=>{if(client.split(before).length!==2)throw Error('NATIVE_PATCH_TARGET_CHANGED');client=client.replace(before,after);};
 replace('this.isEnable = !1, this.connection && (this.connection.close(), this.connection = null), this.heartbeatRef && (clearInterval(this.heartbeatRef), this.heartbeatRef = null);',
  'this.isEnable = !1; const previous = this.connection; this.connection = null; previous && previous.close(); this.heartbeatRef && (clearInterval(this.heartbeatRef), this.heartbeatRef = null);');
 replace('async checkStateAndReply(e) {','async checkStateAndReply(e, owner = this.connection) {');
 replace('this.connection && this.connection.readyState === Sn.OPEN ? (this.connection.send(JSON.stringify(e)), r()) : n(new Error("WebSocket is not open"));',
  'owner && this.connection === owner && owner.readyState === Sn.OPEN ? (owner.send(JSON.stringify(e)), r()) : n(new Error("WebSocket owner is not active"));');
 const connectStart=client.indexOf('  async tryConnect() {'),connectEnd=client.indexOf('  async connectEvent(',connectStart);if(connectStart<0||connectEnd<connectStart)throw Error('NATIVE_CONNECT_TARGET_CHANGED');
 client=client.slice(0,connectStart)+`  async tryConnect() {
    if (this.connection || !this.isEnable) return;
    let errored = false;
    const options = {maxPayload: 50 * 1024 * 1024, handshakeTimeout: 2000, perMessageDeflate: false,
      headers: {"X-Self-ID": this.core.selfInfo.uin, Authorization: \`Bearer \${this.config.token}\`, "x-client-role": "Universal", "User-Agent": "OneBot/11"}};
    if (this.config.verifyCertificate !== undefined) options.rejectUnauthorized = this.config.verifyCertificate;
    const owner = new Sn(this.config.url, options); this.connection = owner;
    owner.on("pong", () => {});
    owner.on("open", () => {
      if (this.connection !== owner || !this.isEnable) return;
      this.connectEvent(this.core, owner).catch(() => this.logger.logError("[OneBot] [WebSocket Client] 发送连接生命周期失败"));
    });
    owner.on("message", bytes => {
      if (this.connection !== owner || !this.isEnable) return;
      this.handleMessage(bytes, owner).catch(() => this.logger.logError("[OneBot] [WebSocket Client] 处理消息失败"));
    });
    owner.once("close", () => {
      if (this.connection !== owner) return;
      this.connection = null;
      if (!errored && this.isEnable) {
        this.logger.logError("[OneBot] [WebSocket Client] 连接关闭，等待重新连接");
        setTimeout(() => this.tryConnect(), this.config.reconnectInterval);
      }
    });
    owner.on("error", () => {
      if (this.connection !== owner) return;
      errored = true; this.connection = null; owner.terminate();
      if (this.isEnable) {
        this.logger.logError("[OneBot] [WebSocket Client] 连接错误，等待重新连接");
        setTimeout(() => this.tryConnect(), this.config.reconnectInterval);
      }
    });
  }
`+client.slice(connectEnd);
 replace('async connectEvent(e) {','async connectEvent(e, owner = this.connection) {');
 replace('this.checkStateAndReply(new Vy(e, wh.CONNECT))','this.checkStateAndReply(new Vy(e, wh.CONNECT), owner)');
 replace('async handleMessage(e) {','async handleMessage(e, owner = this.connection) {');
 replace('this.checkStateAndReply(jt.error("json解析失败,请检查数据格式", 1400, n))','this.checkStateAndReply(jt.error("json解析失败,请检查数据格式", 1400, n), owner)');
 replace('this.checkStateAndReply(jt.error("不支持的Api " + r.action, 1404, n))','this.checkStateAndReply(jt.error("不支持的Api " + r.action, 1404, n), owner)');
 replace('this.checkStateAndReply({ ...jt.ok(s, n ?? "", !0) })','this.checkStateAndReply({ ...jt.ok(s, n ?? "", !0) }, owner)');
 replace('this.checkStateAndReply({ ...o })','this.checkStateAndReply({ ...o }, owner)');
 return client;
}
export function patchNapCatWebSocketOwner(source){
 if(sha(source)!==NAPCAT_OWNER_BASE_SHA256)throw Error('AUDITED_NAPCAT_SOURCE_REQUIRED');
 const start=source.indexOf('class pO extends vd {'),end=source.indexOf('\nvar G_',start);if(start<0||end<start)throw Error('NATIVE_CLIENT_BOUNDARIES_CHANGED');
 const client=patchNativeWebSocketClient(source.slice(start,end)),result=source.slice(0,start)+client+source.slice(end);
 return {source:result,baseSha256:sha(source),sha256:sha(result),onlyWebSocketClientChanged:result.slice(0,start)===source.slice(0,start)&&result.slice(start+client.length)===source.slice(end)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [input,output]=process.argv.slice(2),target=path.resolve(output??'');if(!input||!target.toLowerCase().startsWith('e:\\codexdata\\build\\right\\')||fs.existsSync(target))throw Error('NEW_E_BUILD_OUTPUT_REQUIRED');
 const result=patchNapCatWebSocketOwner(fs.readFileSync(input,'utf8'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,result.source,{flag:'wx'});
 const {source,...proof}=result;fs.writeFileSync(target+'.proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({...proof,output:target}));
}
