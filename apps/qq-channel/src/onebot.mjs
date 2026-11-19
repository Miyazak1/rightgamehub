import http from 'node:http';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
const error=(code,notSent=false)=>Object.assign(new Error(code),{code,notSent});
export class OneBotGateway {
  constructor(config,{receive,log=()=>{},actionTimeoutMs=10000}={}){
    this.config=config;this.receive=receive;this.log=log;this.timeout=actionTimeoutMs;this.socket=null;this.pending=new Map();this.stopping=false;
  }
  connected(){return !this.stopping&&this.socket?.readyState===WebSocket.OPEN;}
  async start({port=this.config.port}={}){
    this.server=http.createServer((req,res)=>{
      res.writeHead(req.url==='/health'?200:404,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify(req.url==='/health'?{service:'mooyu-qq-local',connected:this.connected()}:{}));
    });
    this.wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
    this.server.on('upgrade',(req,socket,head)=>{
      const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+this.config.accessToken);
      if(this.stopping||req.url!=='/onebot/v11'||actual.length!==expected.length||!timingSafeEqual(actual,expected)
        ||String(req.headers['x-self-id']??'')!==this.config.botId||this.connected()){
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
      }
      this.wss.handleUpgrade(req,socket,head,ws=>this.wss.emit('connection',ws));
    });
    this.wss.on('connection',socket=>{
      this.socket=socket;let alive=true,inflight=0;
      const timer=setInterval(()=>{if(!alive){socket.terminate();return;}alive=false;socket.ping();},15000);timer.unref();
      socket.on('pong',()=>{alive=true;});
      socket.on('close',()=>{clearInterval(timer);if(this.socket===socket)this.socket=null;
        for(const [echo,item]of this.pending)if(item.socket===socket){clearTimeout(item.timer);this.pending.delete(echo);item.reject(error('QQ_DELIVERY_UNCERTAIN'));}
        this.log({event:'gateway-disconnected'});
      });
      socket.on('error',()=>this.log({event:'gateway-error',code:'QQ_SOCKET_ERROR'}));
      socket.on('message',(bytes,binary)=>{
        if(binary||this.stopping)return;
        let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{socket.close(1008,'invalid JSON');return;}
        if(!value||typeof value!=='object'||Array.isArray(value))return;
        if(Object.hasOwn(value,'echo')){
          const item=this.pending.get(value.echo);if(!item||item.socket!==socket)return;
          clearTimeout(item.timer);this.pending.delete(value.echo);
          if(value.status==='ok'&&value.retcode===0&&Number.isSafeInteger(value.data?.message_id))item.resolve(String(value.data.message_id));
          else item.reject(error('QQ_GATEWAY_SEND_REJECTED'));
          return;
        }
        if(inflight>=16){socket.close(1013,'inbox busy');return;}
        inflight++;
        Promise.resolve().then(()=>this.receive(value)).catch(()=>{
          this.log({event:'admission-failed',code:'QQ_INBOX_UNAVAILABLE'});socket.close(1011,'inbox unavailable');
        }).finally(()=>{inflight--;});
      });
      this.log({event:'gateway-connected'});
    });
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(port,'127.0.0.1',resolve);});
    return this.server.address();
  }
  async send(row){
    if(!this.connected())throw error('QQ_GATEWAY_OFFLINE',true);
    const socket=this.socket,echo=randomUUID();
    const message=[{type:'reply',data:{id:row.message_id}},{type:'at',data:{qq:row.user_id}},{type:'text',data:{text:' '+row.reply}}];
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(echo);reject(error('QQ_DELIVERY_UNCERTAIN'));},this.timeout);timer.unref();
      this.pending.set(echo,{socket,timer,resolve,reject});
      try{socket.send(JSON.stringify({action:'send_group_msg',params:{group_id:Number(this.config.groupId),message},echo}),err=>{
        if(err){clearTimeout(timer);this.pending.delete(echo);reject(error('QQ_DELIVERY_UNCERTAIN'));}
      });}catch{clearTimeout(timer);this.pending.delete(echo);reject(error('QQ_DELIVERY_UNCERTAIN'));}
    });
  }
  async stop(){
    this.stopping=true;
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error('QQ_DELIVERY_UNCERTAIN'));}this.pending.clear();
    for(const socket of this.wss?.clients??[])socket.terminate();
    await new Promise(resolve=>this.wss?this.wss.close(resolve):resolve());
    await new Promise(resolve=>this.server?this.server.close(resolve):resolve());
  }
}
