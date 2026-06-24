const { Pool } = require('/Users/biancabienaime/taekwondo-tournament/node_modules/pg');
require('dotenv').config({ path: '/Users/biancabienaime/taekwondo-tournament/.env' });
(async () => {
  const c = await new Pool({ connectionString: process.env.DATABASE_URL }).connect();
  // Use a fresh UUID
  const cid = '22222222-2222-2222-2222-222222222222';
  // Insert
  await c.query(`INSERT INTO "Competitor" (id, "firstName", "lastName", gender, "dateOfBirth", belt, "schoolDojang", "createdAt", "updatedAt") VALUES ($1, 'X', 'X', 'M', '2014-01-01', 'Yellow', 'X', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`, [cid]);
  console.log('Inserted');
  // Get demo token
  const tokRes = await fetch('https://tkd.ashbi.ca/api/auth/demo', { method: 'POST' });
  const tok = (await tokRes.json()).token;
  // DELETE
  const r = await fetch('https://tkd.ashbi.ca/api/competitors/' + cid, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
  console.log('API DELETE status:', r.status);
  // Wait a tick
  await new Promise(res => setTimeout(res, 500));
  // Re-query
  const r2 = await c.query(`SELECT "deletedAt", "firstName" FROM "Competitor" WHERE id = $1`, [cid]);
  console.log('After DELETE: deletedAt=' + r2.rows[0]?.deletedAt);
  // Cleanup
  await c.query(`DELETE FROM "Competitor" WHERE id = $1`, [cid]);
  await c.release();
})();
