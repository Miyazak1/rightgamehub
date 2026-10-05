const {MessageChannel}=require('node:worker_threads');
const crypto=require('node:crypto');
const target=()=>{const listeners=new Map();return {
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
  removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
  dispatch(event){for(const fn of listeners.get('message')??[])fn(event);},
};};
exports.createSaveBridge=async function({api,descriptor,identity=async()=> 'account/grant',onStatus=()=>{},cloudSaveTimeoutMs=2000}={}) {
  const {createWebGameHost}=await import('../../packages/platform-client/src/web-game-host.mjs');
  const {createGameHubClient}=await import('../../packages/web-game-sdk/src/index.mjs');
  const {bridgeEnvelope}=await import('../../packages/web-game-sdk/src/protocol.mjs');
  const hostWindow=target(),gameWindow=target(),ports=[],wire=[];let gamePort;
  const parent={postMessage:data=>hostWindow.dispatch({source:frame,data})};
  const frame={postMessage:(data,_origin,supplied)=>{
    wire.push(data);gamePort=supplied[0];gameWindow.dispatch({source:parent,data,ports:supplied});
  }};
  class Channel {
    constructor() {
      const channel=new MessageChannel();ports.push(channel.port1,channel.port2);
      channel.port1.on('message',data=>wire.push(data));channel.port2.on('message',data=>wire.push(data));
      return channel;
    }
  }
  const bridge=createWebGameHost({windowImpl:hostWindow,frame:{contentWindow:frame},launchId:crypto.randomUUID(),
    descriptor,apiClient:api,MessageChannelImpl:Channel,getAccountIdentity:identity,onCloudSaveStatus:onStatus,logger:{warn(){}}});
  const clients=[];
  const newClient=()=>{
    const client=createGameHubClient({windowImpl:gameWindow,parentWindow:parent,requestTimeoutMs:2000,cloudSaveTimeoutMs});
    clients.push(client);return client;
  };
  const client=newClient();await client.connect();
  return {
    client,bridge,wire,newClient,
    raw:(method,params={})=>new Promise((resolve,reject)=>{
      const id=crypto.randomUUID(),port=gamePort;
      const receive=({data})=>{if(data.id!==id)return;clearTimeout(timer);port.removeEventListener('message',receive);resolve(data);};
      const timer=setTimeout(()=>{port.removeEventListener('message',receive);reject(new Error('Raw request timed out'));},2000);
      port.addEventListener('message',receive);port.postMessage(bridgeEnvelope({type:'request',id,method,params}));
    }),
    close(){for(const item of clients)item.close();bridge.close();for(const port of ports)port.close();},
  };
};
