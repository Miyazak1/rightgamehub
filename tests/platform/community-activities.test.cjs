const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const moduleUrl=name=>pathToFileURL(path.resolve(__dirname,'../../apps/api/src',name));

test('community activity routes expose real events, parties, overview and participation',async t=>{
  const {createApp}=await import(moduleUrl('app.mjs'));
  const {AuthError}=await import(moduleUrl('auth-service.mjs'));
  const eventId=crypto.randomUUID(),partyId=crypto.randomUUID(),workId=crypto.randomUUID(),modeId=crypto.randomUUID(),calls=[];
  const events={list:async()=>[],get:async()=>({id:eventId,version:1}),create:async(actor,body)=>{calls.push(['event-create',body]);return {id:eventId,version:1};},update:async(actor,id,body)=>{calls.push(['event-update',body]);return {id,version:2};},register:async()=>({id:eventId,version:1}),unregister:async()=>({id:eventId,version:1})};
  const parties={list:async()=>[],get:async()=>({id:partyId,version:1}),create:async(actor,body)=>{calls.push(['party-create',body]);return {id:partyId,version:1};},join:async()=>({id:partyId,version:2}),leave:async()=>({id:partyId,version:3}),ready:async(actor,id,ready)=>{calls.push(['party-ready',ready]);return {id,version:4};},start:async()=>({id:partyId,version:5}),finish:async(actor,id,state)=>{calls.push(['party-finish',state]);return {id,version:6};}};
  const notificationId=crypto.randomUUID();
  const experience={overview:async()=>({happening:[],projects:[]}),participation:async()=>({events:[],parties:[],projects:[],notifications:[]}),read:async(actor,id)=>{calls.push(['notification-read',id]);return {read:true};}};
  const service={config:{enabled:true,imagesEnabled:false},events,parties,experience};
  const app=createApp({config:{requestBodyLimit:65536,community:{enabled:true}},database:{ping:async()=>true},migrations:{status:async()=>({ready:true})},communityService:service,communityMediaService:{},authService:{authenticateBearer:async authorization=>{if(!authorization)throw new AuthError('AUTH_REQUIRED',401,'Authentication required.');return {userId:crypto.randomUUID()};}}});
  t.after(()=>app.close());const auth={authorization:'Bearer token'};
  assert.equal((await app.inject({method:'GET',url:'/v1/community/overview'})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:'/v1/community/me/participation',headers:auth})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:`/v1/community/me/participation/notifications/${notificationId}/read`,headers:auth})).statusCode,200);
  const createdEvent=await app.inject({method:'POST',url:'/v1/community/events',headers:auth,payload:{title:'周末试玩会',summary:'一起测试移动端的新版本和新手引导。',eventType:'playtest',startsAt:'2030-01-01T12:00:00.000Z',endsAt:'2030-01-01T13:00:00.000Z',capacity:12,codeOfConduct:'尊重所有参与者并提供具体反馈。',cancellationPolicy:'如有变化至少提前一小时通知报名成员。'}});
  assert.equal(createdEvent.statusCode,200);assert.equal(createdEvent.headers.etag,'"1"');
  assert.equal((await app.inject({method:'POST',url:`/v1/community/events/${eventId}/register`,headers:auth})).statusCode,200);
  const createdParty=await app.inject({method:'POST',url:'/v1/community/parties',headers:auth,payload:{title:'周末竞速队',workId,modeId,modeLabel:'竞速',note:'新手友好，开局前先说明规则。',startsAt:'2030-01-01T12:00:00.000Z',capacity:4,roomMode:'gamehub'}});
  assert.equal(createdParty.statusCode,200);
  assert.equal((await app.inject({method:'POST',url:`/v1/community/parties/${partyId}/ready`,headers:auth,payload:{ready:true}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:`/v1/community/parties/${partyId}/start`,headers:auth})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:`/v1/community/parties/${partyId}/finish`,headers:auth,payload:{state:'ended'}})).statusCode,200);
  assert.deepEqual(calls.map(call=>call[0]),['notification-read','event-create','party-create','party-ready','party-finish']);
});

test('community activities migration constrains capacity, privacy state and append-only audits',async()=>{
  const sql=await fs.readFile('apps/api/migrations/0057_community_events_and_parties.sql','utf8');
  assert.match(sql,/CREATE TABLE community_events/);assert.match(sql,/CREATE TABLE community_event_attendees/);assert.match(sql,/capacity smallint NOT NULL CHECK \(capacity BETWEEN 2 AND 200\)/);
  assert.match(sql,/meeting_url text CHECK \(meeting_url IS NULL OR meeting_url ~ '\^https:\/\/'\)/);assert.match(sql,/CREATE TABLE community_game_parties/);assert.match(sql,/CREATE TABLE community_game_party_members/);
  assert.match(sql,/CREATE TABLE community_participation_notifications/);
  assert.match(sql,/UNIQUE|PRIMARY KEY\(party_id,user_id\)|PRIMARY KEY\(event_id,user_id\)/);assert.match(sql,/community activity audit is append-only/);
});

test('community activity service keeps meeting links gated and party capacity transactional',async()=>{
  const source=await fs.readFile('apps/api/src/community-activity-service.mjs','utf8');
  assert.match(source,/registered&&now>=start-Number\(row\.join_window_minutes\)/);
  assert.match(source,/meetingUrl:canOpenMeeting\?row\.meeting_url:null/);
  assert.match(source,/SELECT \* FROM community_game_parties WHERE id=\$1 FOR UPDATE/);
  assert.match(source,/if\(count>=party\.capacity\)fail\('PARTY_FULL'/);
  assert.match(source,/community-party:\$\{id\}/);
  assert.match(source,/membership_state='left',ready=false,left_at=now\(\)/);
});

test('community client ships event, party, overview and participation operations',async()=>{
  const source=await fs.readFile('packages/platform-api-client/src/community.mjs','utf8');
  for(const name of ['communityOverview','communityParticipation','communityParticipationNotificationRead','communityEventCreate','communityEventRegister','communityPartyCreate','communityPartyJoin','communityPartyReady','communityPartyStart','communityPartyFinish'])assert.match(source,new RegExp(name+':'));
});
