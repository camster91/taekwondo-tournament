import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function patternsJourney({request,pool,path,cookie,scoreCookie,organizationId,foreign,foreignCompetitorId}){
  const before=(await pool.query('SELECT count(*)::integer AS count FROM bowin_rebuild.audit_events')).rows[0].count;
  const create=await request(path,{method:'POST',cookie,body:{name:'QA Patterns Final',venue:'QA Gym',eventDate:'2027-02-28',timeZone:'America/Toronto'}});
  assert.equal(create.status,201);const tournamentId=(await create.json()).id,tournamentPath=path+'/'+tournamentId;
  const division=await request(tournamentPath+'/divisions',{method:'POST',cookie,body:{name:'QA Patterns',discipline:'patterns',format:'scored_final'}});
  assert.equal(division.status,201);const divisionId=(await division.json()).id,base=tournamentPath+`/divisions/${divisionId}/patterns`,ids=[],registrations=[];
  for(const label of ['A','B','C']){
    const competitor=await request(tournamentPath+'/competitors',{method:'POST',cookie,body:{name:'Private pattern '+label,club:'Private school',publicDisplayName:'Patterns athlete '+label}});
    assert.equal(competitor.status,201);const id=(await competitor.json()).id;ids.push(id);
    const registration=await request(tournamentPath+'/registrations',{method:'POST',cookie,body:{competitorId:id,divisionId}});
    assert.equal(registration.status,201);registrations.push((await registration.json()).id);
  }
  assert.equal((await request(base,{method:'POST',cookie})).status,409,'Un-checked entrants must prevent a frozen final');
  for(const id of registrations)assert.equal((await request(tournamentPath+`/registrations/${id}/check-in`,{method:'POST',cookie})).status,200);
  assert.equal((await request(base,{method:'POST',cookie:scoreCookie})).status,403);
  const started=await request(base,{method:'POST',cookie});assert.equal(started.status,201);const final=await started.json();assert.deepEqual(new Set(final.participant_ids),new Set(ids));
  assert.equal((await request(base,{method:'POST',cookie})).status,409);
  assert.equal((await request(`/api/organizations/${foreign}/tournaments/${tournamentId}/divisions/${divisionId}/patterns`,{cookie})).status,404);
  for(const scoreHundredths of [-1,1001,.5,'900'])assert.equal((await request(base+'/scores',{method:'POST',cookie:scoreCookie,body:{competitorId:ids[0],scoreHundredths,expectedVersion:1}})).status,400);
  assert.equal((await request(base+'/scores',{method:'POST',cookie:scoreCookie,body:{competitorId:randomUUID(),scoreHundredths:900,expectedVersion:1}})).status,404);
  assert.equal((await request(base+'/scores',{method:'POST',cookie:scoreCookie,body:{competitorId:foreignCompetitorId,scoreHundredths:900,expectedVersion:1}})).status,404);
  assert.equal((await request(`/api/organizations/${foreign}/tournaments/${tournamentId}/divisions/${divisionId}/patterns/scores`,{method:'POST',cookie:scoreCookie,body:{competitorId:ids[0],scoreHundredths:900,expectedVersion:1}})).status,404);
  assert.equal((await request(base+'/scores',{method:'POST',body:{competitorId:ids[0],scoreHundredths:900,expectedVersion:1}})).status,401);
  assert.equal((await request(base+'/scores',{method:'POST',cookie:scoreCookie,body:{competitorId:ids[0],scoreHundredths:900,expectedVersion:1}})).status,200);
  assert.equal((await request(base+'/complete',{method:'POST',cookie,body:{expectedVersion:2}})).status,409);
  const auditBefore=(await pool.query('SELECT count(*)::integer AS count FROM bowin_rebuild.audit_events')).rows[0].count;
  await pool.query("CREATE FUNCTION bowin_rebuild.qa_fail_patterns_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='patterns.scored' THEN RAISE EXCEPTION 'QA audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_patterns_audit BEFORE INSERT ON bowin_rebuild.audit_events FOR EACH ROW EXECUTE FUNCTION bowin_rebuild.qa_fail_patterns_audit()");
  try{
    assert.equal((await request(base+'/scores',{method:'POST',cookie:scoreCookie,body:{competitorId:ids[1],scoreHundredths:900,expectedVersion:2}})).status,503);
    const unchanged=await (await request(base,{cookie})).json();assert.equal(unchanged.version,2);assert.deepEqual(unchanged.scores,{[ids[0]]:900});
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM bowin_rebuild.audit_events')).rows[0].count,auditBefore);
  }finally{await pool.query('DROP TRIGGER qa_fail_patterns_audit ON bowin_rebuild.audit_events; DROP FUNCTION bowin_rebuild.qa_fail_patterns_audit()');}
  assert.equal((await request(base+'/scores',{method:'POST',cookie:scoreCookie,body:{competitorId:ids[1],scoreHundredths:900,expectedVersion:2}})).status,200);
  assert.equal((await request(base+'/scores',{method:'POST',cookie:scoreCookie,body:{competitorId:ids[2],scoreHundredths:800,expectedVersion:2}})).status,409);
  const race=await Promise.all([1,2].map(()=>request(base+'/scores',{method:'POST',cookie:scoreCookie,body:{competitorId:ids[2],scoreHundredths:800,expectedVersion:3}})));
  assert.deepEqual(race.map(response=>response.status).sort(),[200,409]);
  assert.equal((await request(base+'/scores',{method:'POST',cookie:scoreCookie,body:{competitorId:ids[0],scoreHundredths:900,expectedVersion:4}})).status,409);
  assert.equal((await request(base+'/complete',{method:'POST',cookie:scoreCookie,body:{expectedVersion:4}})).status,403);
  assert.equal((await request(base+'/complete',{method:'POST',cookie,body:{expectedVersion:3}})).status,409);
  await pool.query("CREATE FUNCTION bowin_rebuild.qa_fail_patterns_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='patterns.completed' THEN RAISE EXCEPTION 'QA completion audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_patterns_completion BEFORE INSERT ON bowin_rebuild.audit_events FOR EACH ROW EXECUTE FUNCTION bowin_rebuild.qa_fail_patterns_completion()");
  try{
    assert.equal((await request(base+'/complete',{method:'POST',cookie,body:{expectedVersion:4}})).status,503);
    const rolledBack=await (await request(base,{cookie})).json();assert.equal(rolledBack.version,4);assert.equal(rolledBack.completed_at,null);assert.deepEqual(rolledBack.results,[]);
    assert.equal((await pool.query('SELECT status FROM bowin_rebuild.divisions WHERE id=$1',[divisionId])).rows[0].status,'running');
  }finally{await pool.query('DROP TRIGGER qa_fail_patterns_completion ON bowin_rebuild.audit_events; DROP FUNCTION bowin_rebuild.qa_fail_patterns_completion()');}
  const complete=await request(base+'/complete',{method:'POST',cookie,body:{expectedVersion:4}});assert.equal(complete.status,200);
  const completed=await complete.json();assert.deepEqual(completed.results.map(row=>row.rank),[1,1,3]);assert.equal(completed.version,5);
  assert.equal((await request(base+'/scores',{method:'POST',cookie:scoreCookie,body:{competitorId:ids[0],scoreHundredths:1000,expectedVersion:5}})).status,409);
  assert.equal((await request(base+'/complete',{method:'POST',cookie,body:{expectedVersion:5}})).status,409);
  const lastAudit=(await pool.query("SELECT details,actor_id FROM bowin_rebuild.audit_events WHERE action='patterns.completed' AND target_id=$1",[final.id])).rows[0];
  assert.deepEqual(new Set(lastAudit.details.winnerIds),new Set(ids.slice(0,2)));
  const publish=await request(tournamentPath+'/publication',{method:'POST',cookie,body:{published:true}});assert.equal(publish.status,200);
  const publicId=(await publish.json()).publicUrl.split('/').at(-1),publicPath='/api/public/tournaments/'+publicId;
  const result=await (await request(publicPath)).json();assert.deepEqual(result.divisions[0].patterns.map(row=>row.rank),[1,1,3]);
  assert.ok(result.divisions[0].patterns.every(row=>Object.keys(row).sort().join(',')==='competitor,rank,scoreHundredths'));
  for(const value of ['Private pattern','Private school',...ids,final.id,divisionId,organizationId,lastAudit.actor_id])assert.ok(!JSON.stringify(result).includes(value),'Public patterns must hide private metadata');
  assert.equal((await request(tournamentPath+'/publication',{method:'POST',cookie,body:{published:false}})).status,200);assert.equal((await request(publicPath)).status,404);
  const added=(await pool.query('SELECT count(*)::integer AS count FROM bowin_rebuild.audit_events')).rows[0].count-before;
  assert.equal(added,18,'Only successful patterns changes may add audits');return added;
}
