import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../src/app.mjs';
const connection=process.env.DATABASE_URL;
test('Fresh setup, session lifecycle and tenant/role boundaries',{skip:!connection},async()=>{
  assert.match(new URL(connection).pathname,/^\/bowin_rebuild_qa_[a-z0-9_]+$/);
  const pool=new pg.Pool({connectionString:connection});
  const origin='https://qa.example.invalid',setupToken='QaSetupOnly-'.repeat(4);
  const app=createApp({pool,origin,setupToken,revision:'a'.repeat(40)});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.on('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const fixture={email:'owner@example.invalid',name:'QA owner',organization:'QA tournament club',password:'QaFixtureOnly-123456',setupToken};
  async function request(path,{method='GET',body,cookie,requestOrigin=origin}={}){
    return fetch(base+path,{method,headers:{origin:requestOrigin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  }
  try {
    assert.equal((await pool.query('SELECT 1 FROM bowin_rebuild.users')).rowCount,0,'Test database must start empty');
    assert.equal((await request('/api/auth/bootstrap',{method:'POST',body:fixture,requestOrigin:'https://foreign.example.invalid'})).status,403);
    assert.equal((await request('/api/auth/bootstrap',{method:'POST',body:{...fixture,setupToken:'wrong'}})).status,403);
    const setup=await request('/api/auth/bootstrap',{method:'POST',body:fixture});
    assert.equal(setup.status,201);
    const organizationId=(await setup.json()).organizationId;
    const session=setup.headers.get('set-cookie');
    assert.match(session,/HttpOnly/);assert.match(session,/Secure/);assert.match(session,/SameSite=Strict/);
    const cookie=session.split(';')[0];
    assert.equal((await request('/api/auth/bootstrap',{method:'POST',body:fixture})).status,409);
    assert.equal((await request('/api/me')).status,401);
    const me=await request('/api/me',{cookie});assert.equal(me.status,200);
    const userId=(await me.json()).user.id;
    const path=`/api/organizations/${organizationId}/tournaments`;
    const payload={name:'QA Championship',venue:'QA Gym',eventDate:'2027-02-28'};
    assert.equal((await request(path,{method:'POST',cookie,body:{...payload,eventDate:'2027-02-29'}})).status,400);
    assert.equal((await request(path,{method:'POST',cookie,body:payload})).status,201);
    const listed=await request(path,{cookie});assert.equal((await listed.json()).tournaments.length,1);
    const foreign=randomUUID();
    await pool.query('INSERT INTO bowin_rebuild.organizations(id,name) VALUES($1,$2)',[foreign,'Other QA club']);
    const foreignPath=`/api/organizations/${foreign}/tournaments`;
    assert.equal((await request(foreignPath,{cookie})).status,404);
    assert.equal((await request(foreignPath,{method:'POST',cookie,body:payload})).status,404);
    await pool.query("UPDATE bowin_rebuild.memberships SET role='scorekeeper' WHERE user_id=$1 AND organization_id=$2",[userId,organizationId]);
    assert.equal((await request(path,{method:'POST',cookie,body:payload})).status,403);
    assert.equal((await request('/api/auth/logout',{method:'POST',cookie})).status,200);
    assert.equal((await request('/api/me',{cookie})).status,401);
    const login=await request('/api/auth/login',{method:'POST',body:{email:fixture.email,password:fixture.password}});
    assert.equal(login.status,200);
    const loggedIn=login.headers.get('set-cookie').split(';')[0];
    await pool.query("UPDATE bowin_rebuild.sessions SET expires_at=now()-interval '1 second'");
    assert.equal((await request('/api/me',{cookie:loggedIn})).status,401);
    assert.equal((await pool.query('SELECT 1 FROM bowin_rebuild.audit_events')).rowCount,2);
  } finally {
    await new Promise(resolve=>server.close(resolve));await pool.end();
  }
});
