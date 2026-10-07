import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(new URL('../apps/realtime/package.json',import.meta.url));
const {WebSocket}=require('ws');
export const uuid=()=>crypto.randomUUID();
export const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
export function summary(values){return {count:values.length,p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),max:values.length?Math.max(...values):null};}
export const failure=code=>Object.assign(new Error(code),{code});
export async function jsonRequest(base,actor,path,{method='GET',body,headers={}}={}){
  const response=await fetch(base+path,{method,headers:{authorization:'Bearer '+actor.token,...(body?{'content-type':'application/json'}:{}),...headers},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
  const value=await response.json();
  if(!response.ok)throw failure(value.error?.code??('HTTP_'+response.status));
  return value.data;
}
// Fixed start times, at most one in-flight operation per stream. Missed starts
// are explicit failures of offered load, never hidden by a closed-loop driver.
export async function scheduled({durationMs,periodMs,offsetMs=0,run}){
  const starts=performance.now(),end=starts+durationMs;let active=null,missed=0,attempts=0;const errors=[];
  for(let due=starts+offsetMs;due<end;due+=periodMs){
    await delay(Math.max(0,due-performance.now()));
    if(active){missed++;continue;}
    if(performance.now()-due>periodMs){missed++;continue;}
    attempts++;active=Promise.resolve().then(run).catch(error=>errors.push(error.code??error.name??'FAILED')).finally(()=>{active=null;});
  }
  if(active)await active;
  return {attempts,missed,errors};
}
export async function openSocket(url){
  const socket=new WebSocket(url),pending=new Set(),snapshots=new Map();
  let closed=false,unexpected=0;
  const notify=message=>{
    if(message.type==='match.snapshot'){
      const prior=snapshots.get(message.matchId);
      if(!prior||Number(message.revision)>=Number(prior.revision))snapshots.set(message.matchId,message);
    }
    if(message.type==='error')unexpected++;
    for(const waiter of [...pending]){
      try{if(waiter.predicate(message)){pending.delete(waiter);clearTimeout(waiter.timer);waiter.resolve(message);}}
      catch(error){pending.delete(waiter);clearTimeout(waiter.timer);waiter.reject(error);}
    }
  };
  socket.on('message',value=>{try{notify(JSON.parse(value.toString()));}catch{unexpected++;}});
  const rejectAll=()=>{
    closed=true;
    for(const waiter of pending){clearTimeout(waiter.timer);waiter.reject(failure('SOCKET_CLOSED'));}
    pending.clear();
  };
  socket.on('error',rejectAll);socket.on('close',rejectAll);
  const wait=(predicate,timeout=5000)=>new Promise((resolve,reject)=>{
    if(closed)return reject(failure('SOCKET_CLOSED'));
    const waiter={predicate,resolve,reject};
    waiter.timer=setTimeout(()=>{pending.delete(waiter);reject(failure('SOCKET_TIMEOUT'));},timeout);
    pending.add(waiter);
  });
  try{await wait(message=>message.type==='session.ready');}catch(error){socket.terminate();throw error;}
  return {socket,snapshots,get unexpected(){return unexpected;},
    async request(type,extra={}){
      const id=uuid(),promise=wait(message=>{
        if(message.causedBy!==id&&message.payload?.receivedMessageId!==id)return false;
        if(['command.rejected','error'].includes(message.type))throw failure(message.payload?.code??'COMMAND_REJECTED');
        return type==='heartbeat.ping'?message.type==='heartbeat.pong':message.type==='command.ack';
      });
      socket.send(JSON.stringify({v:1,id,type,payload:{},...extra}));
      const reply=await promise;return {id,reply};
    },
    snapshot(matchId,revision){
      const current=snapshots.get(matchId);
      return current&&Number(current.revision)>=revision?Promise.resolve(current):wait(m=>m.type==='match.snapshot'&&m.matchId===matchId&&Number(m.revision)>=revision);
    },
    close(){socket.close();}
  };
}
export async function seedMixedFixture(pool,{actors=16,pairs=4,fillerMiB=64}={}){
  const workId='1a13df55-8906-4b03-a19a-5e5a3b776649',releaseId=uuid(),modeId=uuid(),people=[];
  if((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n>1)throw failure('NONEMPTY_TEST_DATABASE');
  for(let i=0;i<actors;i++){
    const actor={userId:uuid(),grantId:uuid(),token:crypto.randomBytes(32).toString('base64url'),bytes:crypto.randomBytes((i%4===3?256:50)*1024),writes:[],etag:null};
    await pool.query("INSERT INTO users(id,display_name,role,can_publish) VALUES($1,$2,$3,true)",[actor.userId,'Mixed load fixture '+i,i===0?'admin':'user']);
    await pool.query("INSERT INTO device_grants(id,user_id,device_label,client_kind,scopes,authenticated_at,expires_at) VALUES($1,$2,'Mixed load local test','browser',ARRAY['profile:read','works:read'],now(),now()+interval '2 hours')",[actor.grantId,actor.userId]);
    await pool.query("INSERT INTO access_tokens(id,token_hash,grant_id,expires_at) VALUES($1,$2,$3,now()+interval '2 hours')",[uuid(),Buffer.from(digest(actor.token),'hex'),actor.grantId]);
    people.push(actor);
  }
  await pool.query("INSERT INTO works(id,owner_user_id,title,kind,state,visibility) VALUES($1,$2,'Mixed load signed Mizhen fixture','game','published','public')",[workId,people[0].userId]);
  await pool.query("INSERT INTO work_targets(work_id,target_key,state) VALUES($1,'web','published')",[workId]);
  await pool.query("INSERT INTO releases(id,work_id,target_key,label,package_type,validation_state,serving_state,approved_capabilities) VALUES($1,$2,'web','mixed-load','web_zip','ready','enabled','[\"cloudSave\",\"multiplayer\"]')",[releaseId,workId]);
  await pool.query("UPDATE work_targets SET current_release_id=$2 WHERE work_id=$1",[workId,releaseId]);
  await pool.query("INSERT INTO game_release_service_scopes(work_id,release_id,channel,status,namespaces,approved_by,reason) VALUES($1,$2,'production','active',$3,$4,'isolated mixed load fixture only')",[workId,releaseId,JSON.stringify({default:{readSchema:{min:1,max:1},writeSchema:1}}),people[0].userId]);
  await pool.query("INSERT INTO game_save_policies(id,work_id,namespace,status,approved_by,reason,content_types) VALUES($1,$2,'default','active',$3,'isolated mixed load fixture only',ARRAY['application/octet-stream'])",[uuid(),workId,people[0].userId]);
  await pool.query("INSERT INTO multiplayer_game_modes(id,work_id,key,name,authority,min_players,max_players,ruleset_version,config) VALUES($1,$2,'duel','Mixed load duel','platform_authoritative',2,2,'1.0.0','{\"turnSeconds\":90}')",[modeId,workId]);
  // Incompressible, explicitly synthetic backup background; not user save data.
  await pool.query('CREATE TABLE mixed_load_fixture(id integer PRIMARY KEY,payload bytea NOT NULL)');
  for(let i=0;i<fillerMiB*4;i++)await pool.query('INSERT INTO mixed_load_fixture VALUES($1,$2)',[i,crypto.randomBytes(262144)]);
  return {workId,releaseId,modeId,people,pairs};
}
export async function prepareMixedClients({api,realtime,fixture,adapter}){
  const {people,workId,releaseId,modeId,pairs}=fixture,rooms=[];
  for(const actor of people){
    actor.session=(await jsonRequest(api,actor,'/v1/game-sessions',{method:'POST',body:{workId,releaseId,channel:'production',launchNonce:uuid()}})).gameSessionId;
    actor.path='/v1/me/game-saves/'+workId+'/slots/autosave?namespace=default';
    actor.headers={authorization:'Bearer '+actor.token,'x-gamehub-session':actor.session};
  }
  const save=async actor=>{
    actor.bytes.writeUInt32BE(actor.writes.length,0);
    const key=uuid(),hash=digest(actor.bytes),response=await fetch(api+actor.path,{method:'PUT',
      headers:{...actor.headers,'content-type':'application/octet-stream','x-gamehub-save-schema':'1','x-content-sha256':hash,'idempotency-key':key,...(actor.etag?{'if-match':actor.etag}:{'if-none-match':'*'})},
      body:actor.bytes,signal:AbortSignal.timeout(5000)});
    const body=await response.json();if(!response.ok)throw failure(body.error?.code??'SAVE_HTTP_FAILED');
    if(body.data.sha256!==hash||body.data.durability!=='cloud')throw failure('SAVE_ACK_MISMATCH');
    actor.etag=body.data.etag;actor.writes.push({key,revisionId:body.data.revisionId,hash});
  };
  const read=async (actor,{latest=false}={})=>{
    const response=await fetch(api+actor.path.replace('?namespace','/content?namespace'),{headers:actor.headers,signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw failure('READ_HTTP_'+response.status);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(digest(bytes)!==response.headers.get('x-content-sha256'))throw failure('READ_DIGEST_MISMATCH');
    if(latest&&(digest(bytes)!==actor.writes.at(-1).hash||response.headers.get('etag')!==actor.etag))throw failure('LATEST_ACK_NOT_READABLE');
  };
  for(const actor of people)await save(actor);
  for(let i=0;i<pairs*2;i++){
    const ticket=await jsonRequest(api,people[i],'/v1/realtime/tickets',{method:'POST'});
    // TLS is deliberately outside this loopback laboratory; authentication is real.
    people[i].socket=await openSocket(realtime+'/v1/realtime?ticket='+ticket.ticket);
  }
  const createMatch=async pair=>{
    const [a,b]=pair.players;
    const room=await jsonRequest(api,a,'/v1/multiplayer/rooms',{method:'POST',headers:{'idempotency-key':uuid()},body:{modeId,visibility:'public',capacity:2,settings:{turnSeconds:90}}});
    await jsonRequest(api,b,'/v1/multiplayer/rooms/'+room.id+'/join',{method:'POST',body:{}});
    for(const actor of [a,b])await jsonRequest(api,actor,'/v1/multiplayer/rooms/'+room.id+'/ready',{method:'POST',body:{ready:true}});
    const match=await jsonRequest(api,a,'/v1/multiplayer/rooms/'+room.id+'/start',{method:'POST',headers:{'idempotency-key':uuid()}});
    pair.matchId=match.id;pair.matchIds.push(match.id);
    for(const actor of [a,b])await actor.socket.request('match.sync.request',{matchId:match.id,payload:{afterSeq:0}});
    pair.current=await a.socket.snapshot(match.id,1);
  };
  for(let i=0;i<pairs;i++){const pair={players:people.slice(i*2,i*2+2),matchIds:[],commands:[]};rooms.push(pair);await createMatch(pair);}
  const act=async pair=>{
    if(pair.current.payload.match.status==='completed'){await createMatch(pair);return {restarted:true};}
    const actor=pair.players.find(a=>a.userId===pair.current.payload.match.turnUserId);
    const own=actor.socket.snapshots.get(pair.matchId).payload.state;
    const state={...own,players:{red:pair.players[0].userId,black:pair.players[1].userId}};
    const options=[];
    for(const piece of state.pieces)if(!piece.revealed)options.push({type:'reveal',pieceId:piece.id});
    for(const piece of state.pieces)if(piece.revealed)for(let to=0;to<64;to++)options.push({type:'move',pieceId:piece.id,to});
    const command=options.find(command=>adapter.validateCommand({state,command,actorUserId:actor.userId}).valid);
    const revision=Number(pair.current.revision),start=performance.now(),startedAt=new Date().toISOString();
    // Register both fan-out waits before sending; measure ACK and delivery independently.
    const delivery=Promise.all(pair.players.map(a=>a.socket.snapshot(pair.matchId,revision+1)));delivery.catch(()=>{});
    const request=actor.socket.request(command?'match.command':'match.resign',{matchId:pair.matchId,expectedRevision:revision,payload:command?{command}:{}});
    const {id}=await request,ackMs=performance.now()-start;
    const snapshots=await delivery;pair.current=snapshots[0];
    pair.commands.push(id);
    if(snapshots.some(s=>s.payload.stateHash!==snapshots[0].payload.stateHash))throw failure('MATCH_FANOUT_HASH_MISMATCH');
    return {startedAt,ackMs,fanoutMs:performance.now()-start};
  };
  return {save,read,act,rooms,close:()=>people.forEach(p=>p.socket?.close())};
}
export async function saveInvariants(pool){
  return (await pool.query("SELECT "+
    "(SELECT count(*)::int FROM game_save_slots s LEFT JOIN game_save_revisions r ON r.id=s.current_revision_id WHERE r.id IS NULL OR r.slot_id<>s.id OR r.revision<>s.revision) bad_pointers,"+
    "(SELECT count(*)::int FROM game_save_slots s JOIN game_save_revisions r ON r.id=s.current_revision_id LEFT JOIN game_save_payloads b ON b.revision_id=r.id WHERE NOT r.tombstone AND b.revision_id IS NULL) missing_current,"+
    "(SELECT count(*)::int FROM game_save_payloads b JOIN game_save_revisions r ON r.id=b.revision_id WHERE encode(sha256(b.payload_inline),'hex')<>r.payload_sha256 OR octet_length(b.payload_inline)<>r.stored_bytes) bad_payloads,"+
    "(SELECT count(*)::int FROM game_save_operations o JOIN game_save_revisions r ON r.id=o.revision_id WHERE o.slot_id<>r.slot_id OR o.result->>'etag'<>r.etag OR o.result->>'revisionId'<>r.id::text) bad_receipts,"+
    "(SELECT CASE WHEN retained_bytes=(SELECT COALESCE(sum(octet_length(payload_inline)),0) FROM game_save_payloads) THEN 0 ELSE 1 END FROM game_save_capacity WHERE singleton) bad_capacity,"+
    "(SELECT count(*)::int FROM game_save_usage u WHERE u.live_slots<>(SELECT count(*) FROM game_save_slots s WHERE (s.user_id,s.work_id,s.channel)=(u.user_id,u.work_id,u.channel) AND s.deleted_at IS NULL) OR "+
    "u.live_bytes<>(SELECT COALESCE(sum(r.stored_bytes),0) FROM game_save_slots s JOIN game_save_revisions r ON r.id=s.current_revision_id WHERE (s.user_id,s.work_id,s.channel)=(u.user_id,u.work_id,u.channel) AND NOT r.tombstone) OR "+
    "u.history_bytes<>(SELECT COALESCE(sum(r.stored_bytes),0) FROM game_save_slots s JOIN game_save_revisions r ON r.slot_id=s.id JOIN game_save_payloads b ON b.revision_id=r.id WHERE (s.user_id,s.work_id,s.channel)=(u.user_id,u.work_id,u.channel) AND r.id<>s.current_revision_id)) bad_usage,"+
    "(SELECT count(*)::int FROM multiplayer_matches m WHERE m.revision<>(SELECT COALESCE(max(e.seq),0) FROM multiplayer_match_events e WHERE e.match_id=m.id) OR m.next_event_seq<>m.revision+1) bad_match_sequence"
  )).rows[0];
}
