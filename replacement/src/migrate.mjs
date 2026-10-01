import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
// This runner is exclusively for the new dedicated database, never the old
// shared taekwondo database. No DROP/TRUNCATE or legacy migrations are used.
const expected = process.env.REBUILD_DATABASE_NAME;
const url = new URL(process.env.DATABASE_URL);
if (!expected || !/^bowin_rebuild_[a-z0-9_]+$/.test(expected) || decodeURIComponent(url.pathname.slice(1)) !== expected) throw new Error('Dedicated rebuild database required');
const client = new pg.Client({ connectionString: url.href });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(819403)");
  await client.query('CREATE TABLE IF NOT EXISTS public.bowin_rebuild_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory=new URL('../migrations/',import.meta.url);
  const files=(await readdir(directory)).filter(name=>/^\d{3}_[a-z_]+\.sql$/.test(name)).sort();
  const applied=(await client.query('SELECT version FROM public.bowin_rebuild_migrations ORDER BY version')).rows.map(row=>row.version);
  const versions=files.map(name=>Number(name.slice(0,3)));
  if(versions.some((version,index)=>version!==index+1)||applied.some((version,index)=>version!==index+1||!versions.includes(version)))throw new Error('Migration history differs from candidate');
  for (const file of files) {
    const version=Number(file.slice(0,3));
    if(applied.includes(version))continue;
    await client.query(await readFile(new URL(file,directory),'utf8'));
    await client.query('INSERT INTO public.bowin_rebuild_migrations(version) VALUES($1)',[version]);
  }
  await client.query('COMMIT');
  console.log('Dedicated rebuild foundation migration verified');
} catch {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Rebuild migration failed');
  process.exitCode = 1;
} finally { await client.end(); }
