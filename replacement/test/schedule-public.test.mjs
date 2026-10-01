import test from 'node:test';
import assert from 'node:assert/strict';
import {publicMatch,scheduleInput} from '../src/schedule-public-routes.mjs';
test('Schedule requires exact UTC timestamps and bounded positive duration',()=>{
  assert.deepEqual(scheduleInput({ring:' Ring  A ',startsAt:'2027-02-28T10:00:00.000Z',durationMinutes:30}),{ring:'ring a',startsAt:'2027-02-28T10:00:00.000Z',endsAt:'2027-02-28T10:30:00.000Z'});
  for(const body of [{ring:'',startsAt:'2027-02-28T10:00:00.000Z',durationMinutes:30},{ring:'A',startsAt:'2027-02-29T10:00:00.000Z',durationMinutes:30},{ring:'A',startsAt:'2027-02-28T10:00:00',durationMinutes:30},{ring:'A',startsAt:'2027-02-28T10:00:00.000Z',durationMinutes:0},{ring:'A',startsAt:'2027-02-28T10:00:00.000Z',durationMinutes:481}])assert.throws(()=>scheduleInput(body));
});
test('Public match projection exposes aliases and scores only',()=>{
  const match={round:1,index:1,status:'completed',left:'private-id-a',right:'private-id-b',winner:'private-id-a',scoreLeft:2,scoreRight:0,leftSource:'internal-ref',email:'private@example.invalid',name:'Private Full Name'};
  const output=publicMatch(match,new Map([['private-id-a','Athlete A'],['private-id-b','Athlete B']]));
  assert.deepEqual(output,{round:1,index:1,status:'completed',left:'Athlete A',right:'Athlete B',winner:'Athlete A',scoreLeft:2,scoreRight:0});
  assert.ok(!JSON.stringify(output).includes('private'));
});
