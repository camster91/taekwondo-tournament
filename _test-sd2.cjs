const { Pool } = require('/Users/biancabienaime/taekwondo-tournament/node_modules/pg');
require('dotenv').config({ path: '/Users/biancabienaime/taekwondo-tournament/.env' });
(async () => {
  const c = await new Pool({ connectionString: process.env.DATABASE_URL }).connect();
  // Verify we are on the right DB
  const dbR = await c.query('SELECT current_database(), inet_server_addr()');
  console.log('DB:', dbR.rows[0]);
  // Use a unique firstName to track
  const uniq = 'AUDIT' + Date.now();
  const cid = '33333333-3333-3333-3333-333333333333';
  await c.query(`INSERT INTO "Competitor" (id, "firstName", "lastName", gender, "dateOfBirth", belt, "schoolDojang", "createdAt", "updatedAt") VALUES ($1, $2, 'X', 'M', '2014-01-01', 'Yellow', 'X', NOW(), NOW())`, [cid, uniq]);
  console.log('Inserted competitor:', uniq);
  // Verify before
  const before = await c.query(`SELECT "deletedAt" FROM "Competitor" WHERE id = $1`, [cid]);
  console.log('Before DELETE, deletedAt:', before.rows[0]?.deletedAt);
  // Get demo token, hit the API
  const tok = (await (await fetch('https://tkd.ashbi.ca/api/auth/demo', { method: 'POST' })).json()).token;
  const r = await fetch('https://tkd.ashbi.ca/api/competitors/' + cid, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
  console.log('API DELETE status:', r.status);
  // Wait then check
  await new Promise(res => setTimeout(res, 1000));
  const after = await c.query(`SELECT "deletedAt" FROM "Competitor" WHERE id = $1`, [cid]);
  console.log('After DELETE, deletedAt:', after.rows[0]?.deletedAt);
  // What does the trash listing show?
  const trash = await fetch('https://tkd.ashbi.ca/api/competitors?trash=true', { headers: { Authorization: 'Bearer ' + tok } });
  const tdata = await trash.json();
  console.log('Trash listing total:', tdata.total, 'includes mine:', tdata.competitors.some(c => c.id === cid));
  // Cleanup
  await c.query(`DELETE FROM "Competitor" WHERE id = $1`, [cid]);
  await c.release();
})();
