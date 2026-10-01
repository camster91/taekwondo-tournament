import pg from 'pg';
import { createApp } from './app.mjs';
const expected=process.env.REBUILD_DATABASE_NAME;
const url=new URL(process.env.DATABASE_URL);
if(!expected||!/^bowin_rebuild_[a-z0-9_]+$/.test(expected)||decodeURIComponent(url.pathname.slice(1))!==expected)throw new Error('Dedicated rebuild database required');
if(!/^[a-f0-9]{40}$/.test(process.env.RELEASE_SHA||''))throw new Error('Full source revision required');
if((process.env.SETUP_TOKEN||'').length<32)throw new Error('Runtime setup token required');
const pool=new pg.Pool({connectionString:url.href,max:10,connectionTimeoutMillis:5000});
// Idle PostgreSQL clients can disconnect during a database restart. The pool
// replaces them on subsequent requests; query failures still reject normally.
pool.on('error',()=>console.error('Database connection interrupted; awaiting reconnection'));
const app=createApp({pool,origin:process.env.APP_ORIGIN,setupToken:process.env.SETUP_TOKEN,revision:process.env.RELEASE_SHA,secureCookies:process.env.LOCAL_QA!=='true'});
const server=app.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>console.log('Bowin rebuild foundation listening'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>pool.end().then(()=>process.exit(0))));
