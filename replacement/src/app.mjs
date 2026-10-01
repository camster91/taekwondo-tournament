import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { email, eventDate, hashPassword, password, secretMatches, text, tokenHash, uuid, verifyPassword } from './security.mjs';
import {mountTournamentRoutes,Problem} from './tournament-routes.mjs';
import {mountInviteRoutes} from './invite-routes.mjs';

export function createApp({ pool, origin, setupToken, revision, secureCookies = true }) {
  if (new URL(origin).origin !== origin || (secureCookies && !origin.startsWith('https://'))) throw new Error('Canonical origin required');
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== origin) return res.status(403).json({ error: 'ORIGIN_REJECTED' });
    next();
  });
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  function cookie(res, value, maxAge) {
    res.cookie('bowin_rebuild_session', value, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/', maxAge });
  }
  function sessionToken(req) {
    return (req.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith('bowin_rebuild_session='))?.slice(22) || '';
  }
  async function issueSession(client, res, userId) {
    const token = randomBytes(32).toString('hex');
    await client.query("INSERT INTO bowin_rebuild.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')", [tokenHash(token), userId]);
    cookie(res, token, 12 * 60 * 60 * 1000);
  }
  const requireAuth = (req, res, next) => {
    const token = sessionToken(req);
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    pool.query('SELECT u.id,u.email,u.display_name FROM bowin_rebuild.sessions s JOIN bowin_rebuild.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [tokenHash(token)])
      .then(result => { if (!result.rowCount) return res.status(401).json({ error: 'AUTH_REQUIRED' }); req.user=result.rows[0]; next(); }).catch(next);
  };
  app.get('/api/health/ready', route(async (_req, res) => {
    const result=await pool.query('SELECT version FROM public.bowin_rebuild_migrations ORDER BY version');
    if(result.rows.map(row=>row.version).join(',')!=='1,2,3')throw new Error('Required migration missing');
    res.json({ status: 'ok', database: 'ok', revision });
  }));
  app.post('/api/auth/bootstrap', route(async (req, res) => {
    if (!setupToken || setupToken.length < 32 || !secretMatches(req.body?.setupToken, setupToken)) return res.status(403).json({ error: 'SETUP_REJECTED' });
    const address=email(req.body.email), name=text(req.body.name,1,100), organization=text(req.body.organization,1,120);
    const hash=await hashPassword(password(req.body.password));
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(819404)');
      if ((await client.query('SELECT 1 FROM bowin_rebuild.users LIMIT 1')).rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'SETUP_COMPLETE' }); }
      const userId=randomUUID(), organizationId=randomUUID();
      await client.query('INSERT INTO bowin_rebuild.users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',[userId,address,name,hash]);
      await client.query('INSERT INTO bowin_rebuild.organizations(id,name) VALUES($1,$2)',[organizationId,organization]);
      await client.query("INSERT INTO bowin_rebuild.memberships VALUES($1,$2,'owner')",[organizationId,userId]);
      await client.query("INSERT INTO bowin_rebuild.audit_events(organization_id,actor_id,action,target_id) VALUES($1,$2,'organization.created',$1)",[organizationId,userId]);
      await issueSession(client,res,userId);
      await client.query('COMMIT');
      res.status(201).json({ organizationId });
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }));
  app.post('/api/auth/login', route(async (req,res) => {
    const address=email(req.body?.email), candidate=password(req.body?.password);
    const result=await pool.query('SELECT id,password_hash FROM bowin_rebuild.users WHERE email=$1',[address]);
    // A valid-cost dummy hash keeps unknown accounts on the same scrypt path.
    const stored=result.rows[0]?.password_hash || 'scrypt1:'+ '0'.repeat(32)+':'+ '0'.repeat(128);
    if (!await verifyPassword(candidate,stored) || !result.rowCount) return res.status(401).json({ error: 'LOGIN_REJECTED' });
    await issueSession(pool,res,result.rows[0].id);
    res.json({ status: 'ok' });
  }));
  app.post('/api/auth/logout', requireAuth, route(async(req,res) => {
    await pool.query('DELETE FROM bowin_rebuild.sessions WHERE token_hash=$1',[tokenHash(sessionToken(req))]);
    cookie(res,'',0);res.json({ status:'ok' });
  }));
  app.get('/api/me', requireAuth, route(async(req,res) => {
    const memberships=await pool.query('SELECT o.id,o.name,m.role FROM bowin_rebuild.memberships m JOIN bowin_rebuild.organizations o ON o.id=m.organization_id WHERE m.user_id=$1 ORDER BY o.name',[req.user.id]);
    res.json({ user:req.user, organizations:memberships.rows });
  }));
  async function membership(req,res) {
    if (!uuid(req.params.organizationId)) { res.status(404).json({error:'NOT_FOUND'});return null; }
    const result=await pool.query('SELECT role FROM bowin_rebuild.memberships WHERE organization_id=$1 AND user_id=$2',[req.params.organizationId,req.user.id]);
    if (!result.rowCount) { res.status(404).json({error:'NOT_FOUND'});return null; }
    return result.rows[0];
  }
  app.get('/api/organizations/:organizationId/tournaments',requireAuth,route(async(req,res) => {
    if (!await membership(req,res))return;
    const result=await pool.query('SELECT id,name,event_date::text,venue,status FROM bowin_rebuild.tournaments WHERE organization_id=$1 ORDER BY event_date,id',[req.params.organizationId]);
    res.json({tournaments:result.rows});
  }));
  app.post('/api/organizations/:organizationId/tournaments',requireAuth,route(async(req,res) => {
    const member=await membership(req,res);if(!member)return;
    if (!['owner','organizer'].includes(member.role))return res.status(403).json({error:'ROLE_REJECTED'});
    const name=text(req.body?.name,1,120), venue=text(req.body?.venue,1,200), date=eventDate(req.body?.eventDate), id=randomUUID();
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO bowin_rebuild.tournaments(id,organization_id,name,event_date,venue,created_by) VALUES($1,$2,$3,$4,$5,$6)',[id,req.params.organizationId,name,date,venue,req.user.id]);
      await client.query("INSERT INTO bowin_rebuild.audit_events(organization_id,actor_id,action,target_id) VALUES($1,$2,'tournament.created',$3)",[req.params.organizationId,req.user.id,id]);
      await client.query('COMMIT');res.status(201).json({id});
    } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  mountTournamentRoutes({app,pool,requireAuth,route});
  mountInviteRoutes({app,pool,origin,requireAuth,route,issueSession});
  app.use((_req,res)=>res.status(404).json({error:'NOT_FOUND'}));
  app.use((error,_req,res,_next)=>{
    if(error instanceof Problem)return res.status(error.status).json({error:error.code});
    if(error.code==='23505')return res.status(409).json({error:'CONFLICT'});
    const invalid=error.message.startsWith('Invalid')||error.message.startsWith('Password')||error.type==='entity.parse.failed';
    res.status(invalid?400:503).json({error:invalid?'INVALID_INPUT':'REQUEST_UNAVAILABLE'});
  });
  return app;
}
