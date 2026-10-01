import {publicPatterns} from './pattern-routes.mjs';
import {randomUUID} from 'node:crypto';
import {text,uuid} from './security.mjs';

export function scheduleInput(body){
  const ring=text(body?.ring,1,40).toLowerCase().replace(/\s+/g,' ');
  const start=body?.startsAt,duration=body?.durationMinutes;
  if(typeof start!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(start)||!Number.isInteger(duration)||duration<1||duration>480)throw new Error('Invalid schedule');
  const date=new Date(start);
  if(Number.isNaN(date.valueOf())||date.toISOString()!==start)throw new Error('Invalid schedule');
  return {ring,startsAt:date.toISOString(),endsAt:new Date(date.valueOf()+duration*60000).toISOString()};
}

// This projection is an allowlist. Never spread database competitor, auth,
// membership, audit or registration records into a public response.
export function publicMatch(match,aliases){
  const alias=id=>id?aliases.get(id)||null:null;
  return {round:match.round,index:match.index,status:match.status,left:alias(match.left),right:alias(match.right),winner:alias(match.winner),scoreLeft:match.scoreLeft,scoreRight:match.scoreRight};
}

export function mountSchedulePublication({router,pool,access,mutate,Problem,origin}){
  router.get('/schedule',async(req,res,next)=>{
    try{
      await access(pool,req);
      const result=await pool.query('SELECT s.division_id,d.name,s.ring,s.starts_at,s.ends_at FROM bowin_rebuild.division_schedule s JOIN bowin_rebuild.divisions d ON d.id=s.division_id WHERE s.organization_id=$1 AND s.tournament_id=$2 ORDER BY s.starts_at,s.ring,d.name',[req.params.organizationId,req.params.tournamentId]);
      res.json({schedule:result.rows});
    }catch(error){next(error);}
  });
  router.post('/divisions/:divisionId/schedule',async(req,res,next)=>{
    try{
      if(!uuid(req.params.divisionId))throw new Problem(404,'NOT_FOUND');
      const value=scheduleInput(req.body);
      const result=await mutate(req,'division.scheduled',async(client,tournament)=>{
        if(tournament.status==='completed')throw new Problem(409,'TOURNAMENT_COMPLETED');
        const parts=new Intl.DateTimeFormat('en',{timeZone:tournament.time_zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value.startsAt));
        const part=name=>parts.find(item=>item.type===name).value;
        if(`${part('year')}-${part('month')}-${part('day')}`!==tournament.event_date)throw new Problem(409,'OUTSIDE_TOURNAMENT_DATE');
        const division=(await client.query('SELECT status FROM bowin_rebuild.divisions WHERE id=$1 AND organization_id=$2 AND tournament_id=$3 FOR UPDATE',[req.params.divisionId,req.params.organizationId,req.params.tournamentId])).rows[0];
        if(!division)throw new Problem(404,'NOT_FOUND');
        if(division.status==='completed')throw new Problem(409,'DIVISION_COMPLETED');
        // mutate holds the tournament lock: simultaneous bookings for two
        // divisions serialize before this overlap check (half-open ranges).
        const clash=await client.query('SELECT id FROM bowin_rebuild.division_schedule WHERE organization_id=$1 AND tournament_id=$2 AND ring=$3 AND division_id<>$4 AND starts_at<$6 AND ends_at>$5',[req.params.organizationId,req.params.tournamentId,value.ring,req.params.divisionId,value.startsAt,value.endsAt]);
        if(clash.rowCount)throw new Problem(409,'RING_CONFLICT');
        const id=randomUUID();
        const saved=await client.query('INSERT INTO bowin_rebuild.division_schedule(id,organization_id,tournament_id,division_id,ring,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id,tournament_id,division_id) DO UPDATE SET ring=excluded.ring,starts_at=excluded.starts_at,ends_at=excluded.ends_at RETURNING id',[id,req.params.organizationId,req.params.tournamentId,req.params.divisionId,value.ring,value.startsAt,value.endsAt]);
        return {id:saved.rows[0].id,...value,auditDetails:{divisionId:req.params.divisionId,...value}};
      });res.json(result);
    }catch(error){next(error);}
  });
  router.post('/publication',async(req,res,next)=>{
    try{
      const published=req.body?.published;
      if(typeof published!=='boolean')throw new Error('Invalid publication setting');
      const result=await mutate(req,published?'tournament.published':'tournament.unpublished',async(client,tournament)=>{
        const id=randomUUID();
        const result=await client.query('UPDATE bowin_rebuild.tournaments SET publication_enabled=$1,public_id=COALESCE(public_id,$2) WHERE id=$3 RETURNING public_id',[published,id,tournament.id]);
        return {id:tournament.id,published,publicUrl:published?origin+'/results/'+result.rows[0].public_id:null};
      });res.json(result);
    }catch(error){next(error);}
  });
}

export function mountPublicResults({app,pool,route,Problem}){
  app.get('/api/public/tournaments/:publicId',route(async(req,res)=>{
    if(!uuid(req.params.publicId))throw new Problem(404,'NOT_FOUND');
    const client=await pool.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const tournament=(await client.query('SELECT t.id,t.organization_id,t.name,t.event_date::text,t.venue,t.status,t.time_zone,o.name AS organizer FROM bowin_rebuild.tournaments t JOIN bowin_rebuild.organizations o ON o.id=t.organization_id WHERE t.public_id=$1 AND t.publication_enabled=true',[req.params.publicId])).rows[0];
      if(!tournament)throw new Problem(404,'NOT_FOUND');
      const params=[tournament.organization_id,tournament.id];
      const competitors=(await client.query('SELECT id,public_display_name FROM bowin_rebuild.competitors WHERE organization_id=$1 AND tournament_id=$2',params)).rows;
      const aliases=new Map(competitors.map(row=>[row.id,row.public_display_name]));
      const divisions=(await client.query('SELECT d.name,d.discipline,d.status,s.ring,s.starts_at,s.ends_at,b.matches,b.champion_id,p.results AS pattern_results,p.completed_at AS patterns_completed_at FROM bowin_rebuild.divisions d LEFT JOIN bowin_rebuild.division_schedule s ON s.division_id=d.id LEFT JOIN bowin_rebuild.brackets b ON b.division_id=d.id LEFT JOIN bowin_rebuild.pattern_finals p ON p.division_id=d.id WHERE d.organization_id=$1 AND d.tournament_id=$2 ORDER BY d.name',params)).rows;
      await client.query('COMMIT');
      res.json({organizer:{name:tournament.organizer},tournament:{name:tournament.name,eventDate:tournament.event_date,venue:tournament.venue,status:tournament.status,timeZone:tournament.time_zone},divisions:divisions.map(division=>({name:division.name,discipline:division.discipline,status:division.status,schedule:division.ring?{ring:division.ring,startsAt:division.starts_at,endsAt:division.ends_at}:null,champion:aliases.get(division.champion_id)||null,matches:(division.matches||[]).map(match=>publicMatch(match,aliases)),patterns:division.patterns_completed_at?publicPatterns(division.pattern_results,aliases):null}))});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
}
