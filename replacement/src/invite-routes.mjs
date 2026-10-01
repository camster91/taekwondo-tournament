import {randomBytes,randomUUID} from 'node:crypto';
import {email,hashPassword,password,text,tokenHash,uuid,verifyPassword} from './security.mjs';
import {Problem} from './tournament-routes.mjs';

export function mountInviteRoutes({app,pool,origin,requireAuth,route,issueSession}){
  app.post('/api/organizations/:organizationId/invites',requireAuth,route(async(req,res)=>{
    if(!uuid(req.params.organizationId))throw new Problem(404,'NOT_FOUND');
    const address=email(req.body?.email),role=req.body?.role;
    if(!['organizer','scorekeeper'].includes(role))throw new Error('Invalid invited role');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const member=await client.query('SELECT role FROM bowin_rebuild.memberships WHERE user_id=$1 AND organization_id=$2 FOR UPDATE',[req.user.id,req.params.organizationId]);
      if(!member.rowCount)throw new Problem(404,'NOT_FOUND');
      if(member.rows[0].role!=='owner')throw new Problem(403,'ROLE_REJECTED');
      const id=randomUUID(),token=randomBytes(32).toString('hex');
      await client.query("INSERT INTO bowin_rebuild.invites(id,organization_id,email,role,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours')",[id,req.params.organizationId,address,role,tokenHash(token),req.user.id]);
      await client.query("INSERT INTO bowin_rebuild.audit_events(organization_id,actor_id,action,target_id) VALUES($1,$2,'invite.created',$3)",[req.params.organizationId,req.user.id,id]);
      await client.query('COMMIT');
      // Fragment keeps the token out of access logs/referrer query strings.
      // Return once to the owner; this endpoint does not send messages.
      res.status(201).json({id,inviteUrl:origin+'/accept-invite#'+token});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  app.post('/api/auth/accept-invite',route(async(req,res)=>{
    const token=req.body?.token;
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new Problem(404,'INVITE_UNAVAILABLE');
    const name=text(req.body?.name,1,100),candidate=password(req.body?.password),hash=await hashPassword(candidate);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const invite=(await client.query('SELECT id,organization_id,email,role FROM bowin_rebuild.invites WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE',[tokenHash(token)])).rows[0];
      if(!invite)throw new Problem(404,'INVITE_UNAVAILABLE');
      let user=(await client.query('SELECT id,password_hash FROM bowin_rebuild.users WHERE email=$1 FOR UPDATE',[invite.email])).rows[0];
      if(user){
        // Invitation authority does not permit replacing an existing password
        // or granting a session without proving that account's credentials.
        if(!await verifyPassword(candidate,user.password_hash))throw new Problem(401,'LOGIN_REJECTED');
      }else{
        user={id:randomUUID()};
        await client.query('INSERT INTO bowin_rebuild.users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',[user.id,invite.email,name,hash]);
      }
      await client.query('INSERT INTO bowin_rebuild.memberships(organization_id,user_id,role) VALUES($1,$2,$3)',[invite.organization_id,user.id,invite.role]);
      await client.query('UPDATE bowin_rebuild.invites SET accepted_at=now() WHERE id=$1',[invite.id]);
      await client.query("INSERT INTO bowin_rebuild.audit_events(organization_id,actor_id,action,target_id) VALUES($1,$2,'invite.accepted',$3)",[invite.organization_id,user.id,invite.id]);
      await issueSession(client,res,user.id);
      await client.query('COMMIT');res.status(201).json({organizationId:invite.organization_id});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
}
