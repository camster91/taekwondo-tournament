import pg from 'pg';
import { readFile } from 'node:fs/promises';
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
  const exists = await client.query('SELECT version FROM public.bowin_rebuild_migrations WHERE version=1');
  if (!exists.rowCount) {
    await client.query(await readFile(new URL('../migrations/001_foundation.sql', import.meta.url), 'utf8'));
    await client.query('INSERT INTO public.bowin_rebuild_migrations(version) VALUES(1)');
  }
  await client.query('COMMIT');
  console.log('Dedicated rebuild foundation migration verified');
} catch {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Rebuild migration failed');
  process.exitCode = 1;
} finally { await client.end(); }
