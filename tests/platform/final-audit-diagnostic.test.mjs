import test from 'node:test';import assert from 'node:assert/strict';
import {classifyPendingEvent,summarizePendingEvents} from '../../scripts/diagnose-final-audit-readonly.mjs';
test('terminal stage notification classification requires exact event, idle lease and both terminal contexts',()=>{
 const e={aggregate_type:'stage',event_type:'stage.available',status:'pending',attempts:0,lease_until:null,stage_id:'stage',run_id:'run',stage_status:'succeeded',run_status:'succeeded',payload_binding_matches:true};
 assert.equal(classifyPendingEvent(e),'PENDING_NOTIFICATION_FOR_TERMINAL_STAGE');
 for(const patch of [{event_type:'message.send'},{status:'dispatching'},{attempts:1},{lease_until:'future'},{stage_id:null},{payload_binding_matches:false},{run_status:'uncertain'},{stage_status:'running'}])assert.equal(classifyPendingEvent({...e,...patch}),'REQUIRES_EVENT_SPECIFIC_REVIEW');
 const summary=summarizePendingEvents(Array.from({length:11},()=>({...e,workflow_key:'blog.project.single',payload_json:{private:'NOT_FOR_OUTPUT'}})));assert.equal(summary.eventsInspected,11);assert.equal(summary.groups[0].count,11);assert.equal(JSON.stringify(summary).includes('NOT_FOR_OUTPUT'),false);assert.equal(summary.eventStatusesModified,false);
});
