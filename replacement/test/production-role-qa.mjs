import pg from 'pg';
import assert from 'node:assert/strict';
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
try{
 await client.connect();
 const role=(await client.query("SELECT current_user AS name,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
 assert.equal(role.name,'bowin_runtime');for(const [key,value]of Object.entries(role))if(key!=='name')assert.equal(value,false);
 assert.equal((await client.query("SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user")).rowCount,0);
 assert.equal((await client.query("SELECT count(*)::int AS n FROM public.bowin_rebuild_migrations")).rows[0].n,6);
 assert.equal((await client.query("SELECT 1 FROM pg_tables WHERE schemaname='bowin_rebuild' AND tableowner<>'bowin_owner'")).rowCount,0);
 for(const sql of [
  'CREATE TABLE public.qa_denied(id integer)',
  'CREATE TABLE bowin_rebuild.qa_denied(id integer)',
  'ALTER TABLE bowin_rebuild.users ADD COLUMN qa_denied boolean',
  'UPDATE bowin_rebuild.audit_events SET action=action WHERE false',
  'DELETE FROM bowin_rebuild.audit_events WHERE false',
  'TRUNCATE bowin_rebuild.audit_events',
  'UPDATE public.bowin_rebuild_migrations SET version=version WHERE false',
  'SET ROLE bowin_owner'
 ]){
  await client.query('BEGIN');let code;try{await client.query(sql);}catch(error){code=error.code;}finally{await client.query('ROLLBACK');}assert.equal(code,'42501');
 }
 console.log(JSON.stringify({status:'passed',actualRuntimeRole:'bowin_runtime',migrationOwnerSeparate:true,ddlDenied:true,auditUpdateDeleteTruncateDenied:true,migrationHistoryWriteDenied:true,ownerAssumptionDenied:true}));
}finally{await client.end();}
