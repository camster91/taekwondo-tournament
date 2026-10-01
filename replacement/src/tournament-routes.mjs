import express from 'express';
import {randomUUID} from 'node:crypto';
import {text,uuid} from './security.mjs';

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
  async function mutate(req,action,fn){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const tournament=await access(client,req,true);
      if(!['owner','organizer'].includes(tournament.role))throw new Problem(403,'ROLE_REJECTED');
      const result=await fn(client,tournament);
      await client.query('INSERT INTO bowin_rebuild.audit_events(organization_id,actor_id,action,target_id) VALUES($1,$2,$3,$4)',[req.params.organizationId,req.user.id,action,result.id]);
      await client.query('COMMIT');return result;
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
  app.use('/api/organizations/:organizationId/tournaments/:tournamentId',requireAuth,router);
}
