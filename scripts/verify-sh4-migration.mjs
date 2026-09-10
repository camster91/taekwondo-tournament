// SH-4 migration self-check. Without a live Postgres instance we
// can't run `prisma migrate dev` end-to-end, so this script does the
// next best thing: confirms the rewrites put the new column names
// in the right places and left the old names only where they belong
// (out of SH-4 scope, e.g. roundNumber/bracketType).
//
// Exit code 0 = pass, non-zero = fail. Wire into CI by running:
//   node scripts/verify-sh4-migration.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const initPath = path.join(root, 'prisma', 'migrations', '20260710_init', 'migration.sql');
const reconcilePath = path.join(root, 'prisma', 'migrations', '20260910_sh4_match_reconcile', 'migration.sql');

let failures = 0;
function expect(cond, msg) {
  if (cond) {
    console.log(`  ok   - ${msg}`);
  } else {
    console.log(`  FAIL - ${msg}`);
    failures += 1;
  }
}

console.log('SH-4 init migration (`20260710_init/migration.sql`)');
const initSql = readFileSync(initPath, 'utf8');

// Extract the Match CREATE TABLE block (naive: between CREATE TABLE "Match"
// and the matching CONSTRAINT ... PRIMARY KEY).
//
// Using indexOf-based extraction because the non-greedy regex with
// `[\s\S]+?` over the full 19kB init file ran into a matcher quirk
// where the engine's shortest-first search took a path that needed
// to backtrack through the whole document. indexOf + slice is faster
// and just as correct for our purpose.
const startIdx = initSql.indexOf('CREATE TABLE "Match" (');
let block = null;
if (startIdx !== -1) {
  // The init migration always uses
  //   CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
  // as the closing line of the Match CREATE TABLE block, so we
  // anchor on that.
  const endIdx = initSql.indexOf('PRIMARY KEY ("id")', startIdx);
  if (endIdx !== -1) {
    const semiEnd = initSql.indexOf(';', endIdx);
    if (semiEnd !== -1) {
      block = initSql.slice(startIdx, semiEnd + 1);
    }
  }
}
if (!block) {
  expect(false, 'init migration has a CREATE TABLE "Match" (...) block');
} else {

  // The SH-4 columns must be present in the init CREATE TABLE so a
  // greenfield deploy creates the schema-aligned shape directly.
  expect(block.includes('"scores"'), 'init migration declares Match.scores');
  expect(block.includes('"scheduledAt"'), 'init migration declares Match.scheduledAt');
  expect(block.includes('"ring"'), 'init migration declares Match.ring (String)');

  // The legacy SH-4 columns must be GONE from the init migration so a
  // greenfield deploy does not create the drifted shape.
  expect(!block.includes('"score1"'), 'init migration no longer declares Match.score1');
  expect(!block.includes('"score2"'), 'init migration no longer declares Match.score2');
  expect(!block.includes('"notes"'), 'init migration no longer declares Match.notes');
  expect(!block.includes('"scheduledTime"'), 'init migration no longer declares Match.scheduledTime');
  expect(!block.includes('"ringNumber"'), 'init migration no longer declares Match.ringNumber');
}

console.log('\nSH-4 reconcile migration (`20260910_sh4_match_reconcile/migration.sql`)');
const reconcileSql = readFileSync(reconcilePath, 'utf8');

expect(reconcileSql.includes('DROP COLUMN IF EXISTS "score1"'), 'reconcile drops score1 idempotently');
expect(reconcileSql.includes('DROP COLUMN IF EXISTS "score2"'), 'reconcile drops score2 idempotently');
expect(reconcileSql.includes('DROP COLUMN IF EXISTS "notes"'), 'reconcile drops notes idempotently');
expect(reconcileSql.includes('DROP COLUMN IF EXISTS "scheduledTime"'), 'reconcile drops scheduledTime idempotently');
expect(reconcileSql.includes('DROP COLUMN IF EXISTS "ringNumber"'), 'reconcile drops ringNumber idempotently');

expect(reconcileSql.includes('ADD COLUMN IF NOT EXISTS "scores"'), 'reconcile adds scores idempotently');
expect(reconcileSql.includes('ADD COLUMN IF NOT EXISTS "scheduledAt"'), 'reconcile adds scheduledAt idempotently');
expect(reconcileSql.includes('ADD COLUMN IF NOT EXISTS "ring"'), 'reconcile adds ring idempotently');

if (failures > 0) {
  console.error(`\n${failures} SH-4 migration check(s) failed.`);
  process.exit(1);
}

console.log('\nAll SH-4 migration checks passed.');
