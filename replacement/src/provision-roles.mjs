import pg from 'pg';

// Only the new production database in a dedicated PostgreSQL cluster is eligible.
// Existing credentials must authenticate; this procedure never rotates passwords.
const database=process.env.REBUILD_DATABASE_NAME;
const passwords={postgres:process.env.POSTGRES_PASSWORD,bowin_owner:process.env.OWNER_DATABASE_PASSWORD,bowin_runtime:process.env.RUNTIME_DATABASE_PASSWORD};
if(database!=='bowin_rebuild_production'||Object.values(passwords).some(value=>! /^[a-f0-9]{64}$/.test(value||''))||new Set(Object.values(passwords)).size!==3)throw new Error('Dedicated production database and separate credentials required');
const connection=user=>({host:'postgres',port:5432,user,password:passwords[user],database,connectionTimeoutMillis:5000});
const client=new pg.Client(connection('postgres'));
try{
 await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(819405)');
 const unexpected=await client.query("SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema','bowin_rebuild') UNION ALL SELECT 1 FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema' AND NOT (schemaname='bowin_rebuild' AND tableowner='bowin_owner') AND NOT (schemaname='public' AND tablename='bowin_rebuild_migrations' AND tableowner='bowin_owner')");
 if(unexpected.rowCount)throw new Error('Unexpected database contents');
 for(const role of ['bowin_owner','bowin_runtime']){
  const existing=(await client.query('SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[role])).rows[0];
  if(existing){
   if(!existing.rolcanlogin||Object.entries(existing).some(([key,value])=>key!=='rolcanlogin'&&value))throw new Error('Unexpected existing role privileges');
   const login=new pg.Client(connection(role));try{await login.connect();await login.query('SELECT 1');}finally{await login.end();}
  }else{
   const sql=(await client.query("SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',$1::text,$2::text)",[role,passwords[role]])).rows[0].format;
   await client.query(sql);
  }
  if((await client.query('SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=$1',[role])).rowCount)throw new Error('Unexpected role membership');
 }
 await client.query('REVOKE ALL ON DATABASE bowin_rebuild_production FROM PUBLIC');
 await client.query('GRANT CONNECT,CREATE ON DATABASE bowin_rebuild_production TO bowin_owner');
 await client.query('GRANT CONNECT ON DATABASE bowin_rebuild_production TO bowin_runtime');
 await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
 await client.query('GRANT USAGE,CREATE ON SCHEMA public TO bowin_owner');
 await client.query('GRANT USAGE ON SCHEMA public TO bowin_runtime');
 await client.query('COMMIT');console.log('Dedicated production database roles verified; existing passwords preserved');
}catch{
 await client.query('ROLLBACK').catch(()=>{});console.error('Production role provisioning rejected');process.exitCode=1;
}finally{await client.end();}
