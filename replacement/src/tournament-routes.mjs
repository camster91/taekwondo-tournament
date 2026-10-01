import express from 'express';
import {randomUUID} from 'node:crypto';
import {text,uuid} from './security.mjs';
import {bracketChampion,createBracket,scoreBracket} from './brackets.mjs';

export class Problem extends Error {
  constructor(status,code){super(code);this.status=status;this.code=code;}
}

// Every URL lookup binds tournament AND organization AND authenticated user.
// Every mutation repeats the lookup under a transaction lock, preventing role
// revocation or lifecycle changes from racing a previously authorized write.
export function mountTournamentRoutes({app,pool,requireAuth,route}){
  const router=express.Router({mergeParams:true});
  async function access(client,req,lock=false){
    const {organizationId,tournamentId}=req.params;
    if(!uuid(organizationId)||!uuid(tournamentId))throw new Problem(404,'NOT_FOUND');
    const result=await client.query(`SELECT t.id,t.status,m.role FROM bowin_rebuild.tournaments t JOIN bowin_rebuild.memberships m ON m.organization_id=t.organization_id WHERE t.id=$1 AND t.organization_id=$2 AND m.user_id=$3 ${lock?'FOR UPDATE OF t,m':''}`,[tournamentId,organizationId,req.user.id]);
    if(!result.rowCount)throw new Problem(404,'NOT_FOUND');
    return result.rows[0];
  }
  async function mutate(req,action,fn,roles=['owner','organizer']){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const tournament=await access(client,req,true);
      if(!roles.includes(tournament.role))throw new Problem(403,'ROLE_REJECTED');
      const result=await fn(client,tournament);
      await client.query('INSERT INTO bowin_rebuild.audit_events(organization_id,actor_id,action,target_id,details) VALUES($1,$2,$3,$4,$5)',[req.params.organizationId,req.user.id,action,result.id,JSON.stringify(result.auditDetails||{})]);
      await client.query('COMMIT');
      const {auditDetails,...response}=result;
      return response;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  function editable(tournament){if(!['draft','registration'].includes(tournament.status))throw new Problem(409,'REGISTRATION_CLOSED');}
  router.get('/divisions',route(async(req,res)=>{
    await access(pool,req);
    const result=await pool.query('SELECT id,name,discipline,format,status FROM bowin_rebuild.divisions WHERE organization_id=$1 AND tournament_id=$2 ORDER BY name,id',[req.params.organizationId,req.params.tournamentId]);
    res.json({divisions:result.rows});
  }));
  router.post('/divisions',route(async(req,res)=>{
    const name=text(req.body?.name,1,100),discipline=req.body?.discipline,format=req.body?.format;
    if(!['sparring','patterns'].includes(discipline)||!['single_elimination','scored_final'].includes(format))throw new Error('Invalid division rule');
    if((discipline==='sparring'&&format!=='single_elimination')||(discipline==='patterns'&&format!=='scored_final'))throw new Error('Invalid discipline/format combination');
    const result=await mutate(req,'division.created',async(client,tournament)=>{
      editable(tournament);const id=randomUUID();
      await client.query('INSERT INTO bowin_rebuild.divisions(id,organization_id,tournament_id,name,discipline,format) VALUES($1,$2,$3,$4,$5,$6)',[id,req.params.organizationId,req.params.tournamentId,name,discipline,format]);
      return{id};
    });res.status(201).json(result);
  }));
  router.get('/competitors',route(async(req,res)=>{
    await access(pool,req);
    const result=await pool.query('SELECT id,name,club,public_display_name FROM bowin_rebuild.competitors WHERE organization_id=$1 AND tournament_id=$2 ORDER BY name,id',[req.params.organizationId,req.params.tournamentId]);
    res.json({competitors:result.rows});
  }));
  router.post('/competitors',route(async(req,res)=>{
    const name=text(req.body?.name,1,100),club=text(req.body?.club,1,100),display=text(req.body?.publicDisplayName,1,100);
    const result=await mutate(req,'competitor.created',async(client,tournament)=>{
      editable(tournament);const id=randomUUID();
      await client.query('INSERT INTO bowin_rebuild.competitors(id,organization_id,tournament_id,name,club,public_display_name) VALUES($1,$2,$3,$4,$5,$6)',[id,req.params.organizationId,req.params.tournamentId,name,club,display]);
      return{id};
    });res.status(201).json(result);
  }));
  router.get('/registrations',route(async(req,res)=>{
    await access(pool,req);
    const result=await pool.query('SELECT r.id,r.competitor_id,r.division_id,r.checked_in_at,c.name AS competitor_name,d.name AS division_name FROM bowin_rebuild.registrations r JOIN bowin_rebuild.competitors c ON c.id=r.competitor_id JOIN bowin_rebuild.divisions d ON d.id=r.division_id WHERE r.organization_id=$1 AND r.tournament_id=$2 ORDER BY c.name,d.name',[req.params.organizationId,req.params.tournamentId]);
    res.json({registrations:result.rows});
  }));
  router.post('/registrations',route(async(req,res)=>{
    const competitorId=req.body?.competitorId,divisionId=req.body?.divisionId;
    if(!uuid(competitorId)||!uuid(divisionId))throw new Error('Invalid registration');
    const result=await mutate(req,'registration.created',async(client,tournament)=>{
      editable(tournament);
      const division=await client.query('SELECT id,status FROM bowin_rebuild.divisions WHERE id=$1 AND organization_id=$2 AND tournament_id=$3 FOR UPDATE',[divisionId,req.params.organizationId,req.params.tournamentId]);
      const competitor=await client.query('SELECT id FROM bowin_rebuild.competitors WHERE id=$1 AND organization_id=$2 AND tournament_id=$3',[competitorId,req.params.organizationId,req.params.tournamentId]);
      if(!division.rowCount||!competitor.rowCount)throw new Problem(404,'NOT_FOUND');
      if(division.rows[0].status!=='draft')throw new Problem(409,'DIVISION_LOCKED');
      const id=randomUUID();
      await client.query('INSERT INTO bowin_rebuild.registrations(id,organization_id,tournament_id,competitor_id,division_id) VALUES($1,$2,$3,$4,$5)',[id,req.params.organizationId,req.params.tournamentId,competitorId,divisionId]);
      return{id};
    });res.status(201).json(result);
  }));
  router.post('/registrations/:registrationId/check-in',route(async(req,res)=>{
    if(!uuid(req.params.registrationId))throw new Problem(404,'NOT_FOUND');
    const result=await mutate(req,'registration.checked_in',async(client,tournament)=>{
      if(tournament.status==='completed')throw new Problem(409,'TOURNAMENT_COMPLETED');
      const updated=await client.query('UPDATE bowin_rebuild.registrations SET checked_in_at=COALESCE(checked_in_at,now()),checked_in_by=COALESCE(checked_in_by,$1) WHERE id=$2 AND organization_id=$3 AND tournament_id=$4 RETURNING id,checked_in_at',[req.user.id,req.params.registrationId,req.params.organizationId,req.params.tournamentId]);
      if(!updated.rowCount)throw new Problem(404,'NOT_FOUND');
      return updated.rows[0];
    });res.json(result);
  }));
  router.get('/divisions/:divisionId/bracket',route(async(req,res)=>{
    await access(pool,req);
    if(!uuid(req.params.divisionId))throw new Problem(404,'NOT_FOUND');
    const result=await pool.query('SELECT id,matches,champion_id FROM bowin_rebuild.brackets WHERE organization_id=$1 AND tournament_id=$2 AND division_id=$3',[req.params.organizationId,req.params.tournamentId,req.params.divisionId]);
    if(!result.rowCount)throw new Problem(404,'NOT_FOUND');
    res.json(result.rows[0]);
  }));
  router.post('/divisions/:divisionId/bracket',route(async(req,res)=>{
    if(!uuid(req.params.divisionId))throw new Problem(404,'NOT_FOUND');
    const entrants=req.body?.competitorIds;
    if(!Array.isArray(entrants)||entrants.length<2||entrants.length>256||entrants.some(id=>!uuid(id))||new Set(entrants).size!==entrants.length)throw new Error('Invalid bracket entrants');
    const result=await mutate(req,'bracket.created',async(client,tournament)=>{
      editable(tournament);
      const division=(await client.query('SELECT status,discipline,format FROM bowin_rebuild.divisions WHERE id=$1 AND organization_id=$2 AND tournament_id=$3 FOR UPDATE',[req.params.divisionId,req.params.organizationId,req.params.tournamentId])).rows[0];
      if(!division)throw new Problem(404,'NOT_FOUND');
      if(division.status!=='draft')throw new Problem(409,'DIVISION_LOCKED');
      if(division.format!=='single_elimination'||division.discipline!=='sparring')throw new Problem(409,'FORMAT_NOT_SUPPORTED');
      const registrations=(await client.query('SELECT competitor_id,checked_in_at FROM bowin_rebuild.registrations WHERE organization_id=$1 AND tournament_id=$2 AND division_id=$3 FOR UPDATE',[req.params.organizationId,req.params.tournamentId,req.params.divisionId])).rows;
      if(registrations.length!==entrants.length||registrations.some(row=>!row.checked_in_at||!entrants.includes(row.competitor_id)))throw new Problem(409,'CHECKED_IN_ROSTER_REQUIRED');
      const id=randomUUID(),matches=createBracket(entrants);
      await client.query('INSERT INTO bowin_rebuild.brackets(id,organization_id,tournament_id,division_id,matches) VALUES($1,$2,$3,$4,$5)',[id,req.params.organizationId,req.params.tournamentId,req.params.divisionId,JSON.stringify(matches)]);
      await client.query("UPDATE bowin_rebuild.divisions SET status='locked' WHERE id=$1",[req.params.divisionId]);
      return{id,matches};
    });res.status(201).json(result);
  }));
  router.post('/divisions/:divisionId/bracket/score',route(async(req,res)=>{
    if(!uuid(req.params.divisionId))throw new Problem(404,'NOT_FOUND');
    const key=req.body?.matchKey,left=req.body?.scoreLeft,right=req.body?.scoreRight;
    if(typeof key!=='string'||!/^\d{1,2}:\d{1,3}$/.test(key)||![left,right].every(value=>Number.isInteger(value)&&value>=0&&value<=999)||left===right)throw new Error('Invalid score');
    const result=await mutate(req,'match.scored',async(client,tournament)=>{
      if(tournament.status==='completed')throw new Problem(409,'TOURNAMENT_COMPLETED');
      const division=(await client.query('SELECT id,status FROM bowin_rebuild.divisions WHERE id=$1 AND organization_id=$2 AND tournament_id=$3 FOR UPDATE',[req.params.divisionId,req.params.organizationId,req.params.tournamentId])).rows[0];
      if(!division)throw new Problem(404,'NOT_FOUND');
      const bracket=(await client.query('SELECT id,matches FROM bowin_rebuild.brackets WHERE organization_id=$1 AND tournament_id=$2 AND division_id=$3 FOR UPDATE',[req.params.organizationId,req.params.tournamentId,req.params.divisionId])).rows[0];
      if(!bracket)throw new Problem(404,'NOT_FOUND');
      if(!bracket.matches.some(match=>match.key===key&&match.status==='ready'))throw new Problem(409,'MATCH_NOT_READY');
      const matches=scoreBracket(bracket.matches,key,left,right),champion=bracketChampion(matches);
      await client.query('UPDATE bowin_rebuild.brackets SET matches=$1,champion_id=$2,updated_at=now() WHERE id=$3',[JSON.stringify(matches),champion,bracket.id]);
      await client.query('UPDATE bowin_rebuild.divisions SET status=$1 WHERE id=$2',[champion?'completed':'running',division.id]);
      await client.query("UPDATE bowin_rebuild.tournaments SET status='running' WHERE id=$1 AND status IN ('draft','registration')",[tournament.id]);
      return{id:bracket.id,matches,champion_id:champion,auditDetails:{matchKey:key,scoreLeft:left,scoreRight:right,winnerId:matches.find(match=>match.key===key).winner}};
    },['owner','organizer','scorekeeper']);res.json(result);
  }));
  app.use('/api/organizations/:organizationId/tournaments/:tournamentId',requireAuth,router);
}
