import {randomUUID} from 'node:crypto';
import {uuid} from './security.mjs';

// Manual aggregate scores: integer hundredths from 0 to 1000 (0.00 to 10.00).
// Equal scores share their competition rank; ordering never breaks a tie.
export function rankPatterns(participants,scores){
  if(!Array.isArray(participants)||participants.length<1||participants.length>256||new Set(participants).size!==participants.length||participants.some(id=>!uuid(id))||!scores||Array.isArray(scores)||Object.keys(scores).length!==participants.length||participants.some(id=>!Object.hasOwn(scores,id)||!Number.isInteger(scores[id])||scores[id]<0||scores[id]>1000))throw new Error('Invalid complete patterns scores');
  const ordered=participants.map(competitorId=>({competitorId,scoreHundredths:scores[competitorId]})).sort((a,b)=>b.scoreHundredths-a.scoreHundredths||a.competitorId.localeCompare(b.competitorId));
  let rank=0,previous=null;
  return ordered.map((row,index)=>{if(row.scoreHundredths!==previous)rank=index+1;previous=row.scoreHundredths;return{...row,rank};});
}

export function publicPatterns(results,aliases){
  return results.map(row=>({competitor:aliases.get(row.competitorId)||null,rank:row.rank,scoreHundredths:row.scoreHundredths}));
}

export function mountPatternRoutes({router,pool,access,mutate,route,Problem}){
  const path='/divisions/:divisionId/patterns';
  function id(req){if(!uuid(req.params.divisionId))throw new Problem(404,'NOT_FOUND');}
  async function final(client,req,tournament){
    if(tournament.status==='completed')throw new Problem(409,'TOURNAMENT_COMPLETED');
    const row=(await client.query('SELECT * FROM bowin_rebuild.pattern_finals WHERE organization_id=$1 AND tournament_id=$2 AND division_id=$3 FOR UPDATE',[req.params.organizationId,req.params.tournamentId,req.params.divisionId])).rows[0];
    if(!row)throw new Problem(404,'NOT_FOUND');
    if(row.completed_at)throw new Problem(409,'PATTERNS_COMPLETED');
    if(!Number.isInteger(req.body?.expectedVersion)||req.body.expectedVersion<1)throw new Error('Invalid expected version');
    if(row.version!==req.body.expectedVersion)throw new Problem(409,'STALE_VERSION');
    return row;
  }
  router.get(path,route(async(req,res)=>{
    id(req);await access(pool,req);
    const row=(await pool.query('SELECT id,participant_ids,scores,results,version,completed_at FROM bowin_rebuild.pattern_finals WHERE organization_id=$1 AND tournament_id=$2 AND division_id=$3',[req.params.organizationId,req.params.tournamentId,req.params.divisionId])).rows[0];
    if(!row)throw new Problem(404,'NOT_FOUND');res.json(row);
  }));
  router.post(path,route(async(req,res)=>{
    id(req);
    const result=await mutate(req,'patterns.started',async(client,tournament)=>{
      if(tournament.status==='completed')throw new Problem(409,'TOURNAMENT_COMPLETED');
      const division=(await client.query('SELECT status,discipline,format FROM bowin_rebuild.divisions WHERE organization_id=$1 AND tournament_id=$2 AND id=$3 FOR UPDATE',[req.params.organizationId,req.params.tournamentId,req.params.divisionId])).rows[0];
      if(!division)throw new Problem(404,'NOT_FOUND');
      if(division.discipline!=='patterns'||division.format!=='scored_final')throw new Problem(409,'WRONG_DIVISION_FORMAT');
      if(division.status!=='draft')throw new Problem(409,'DIVISION_LOCKED');
      const registrations=(await client.query('SELECT competitor_id,checked_in_at FROM bowin_rebuild.registrations WHERE organization_id=$1 AND tournament_id=$2 AND division_id=$3 ORDER BY competitor_id',[req.params.organizationId,req.params.tournamentId,req.params.divisionId])).rows;
      if(registrations.length<1||registrations.length>256)throw new Problem(409,'INVALID_ENTRANT_COUNT');
      if(registrations.some(row=>!row.checked_in_at))throw new Problem(409,'CHECK_IN_REQUIRED');
      const participants=registrations.map(row=>row.competitor_id),key=randomUUID();
      await client.query('INSERT INTO bowin_rebuild.pattern_finals(id,organization_id,tournament_id,division_id,participant_ids) VALUES($1,$2,$3,$4,$5)',[key,req.params.organizationId,req.params.tournamentId,req.params.divisionId,JSON.stringify(participants)]);
      await client.query("UPDATE bowin_rebuild.divisions SET status='running' WHERE id=$1",[req.params.divisionId]);
      await client.query("UPDATE bowin_rebuild.tournaments SET status='running' WHERE id=$1 AND status IN ('draft','registration')",[tournament.id]);
      return{id:key,participant_ids:participants,scores:{},results:[],version:1,completed_at:null,auditDetails:{divisionId:req.params.divisionId,entrantCount:participants.length,scale:'hundredths_out_of_10'}};
    });res.status(201).json(result);
  }));
  router.post(path+'/scores',route(async(req,res)=>{
    id(req);const competitorId=req.body?.competitorId,score=req.body?.scoreHundredths;
    if(!uuid(competitorId)||!Number.isInteger(score)||score<0||score>1000)throw new Error('Invalid patterns score');
    const result=await mutate(req,'patterns.scored',async(client,tournament)=>{
      const row=await final(client,req,tournament);
      if(!row.participant_ids.includes(competitorId))throw new Problem(404,'NOT_FOUND');
      if(Object.hasOwn(row.scores,competitorId))throw new Problem(409,'SCORE_ALREADY_RECORDED');
      const scores={...row.scores,[competitorId]:score};
      await client.query('UPDATE bowin_rebuild.pattern_finals SET scores=$1,version=version+1,updated_at=now() WHERE id=$2',[JSON.stringify(scores),row.id]);
      return{id:row.id,scores,version:row.version+1,auditDetails:{divisionId:req.params.divisionId,competitorId,scoreHundredths:score}};
    },['owner','organizer','scorekeeper']);res.json(result);
  }));
  router.post(path+'/complete',route(async(req,res)=>{
    id(req);
    const result=await mutate(req,'patterns.completed',async(client,tournament)=>{
      const row=await final(client,req,tournament);
      if(row.participant_ids.some(key=>!Object.hasOwn(row.scores,key)))throw new Problem(409,'SCORES_INCOMPLETE');
      const results=rankPatterns(row.participant_ids,row.scores);
      const saved=(await client.query('UPDATE bowin_rebuild.pattern_finals SET results=$1,completed_at=now(),version=version+1,updated_at=now() WHERE id=$2 RETURNING completed_at',[JSON.stringify(results),row.id])).rows[0];
      await client.query("UPDATE bowin_rebuild.divisions SET status='completed' WHERE id=$1",[req.params.divisionId]);
      return{id:row.id,results,version:row.version+1,completed_at:saved.completed_at,auditDetails:{divisionId:req.params.divisionId,winnerIds:results.filter(item=>item.rank===1).map(item=>item.competitorId)}};
    });res.json(result);
  }));
}
