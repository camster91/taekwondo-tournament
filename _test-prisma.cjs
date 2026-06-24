const { Pool } = require('/Users/biancabienaime/taekwondo-tournament/node_modules/pg');
const crypto = require('crypto');
const { PrismaClient } = require('/Users/biancabienaime/taekwondo-tournament/node_modules/@prisma/client');
require('dotenv').config({ path: '/Users/biancabienaime/taekwondo-tournament/.env' });

(async () => {
  const c = await new Pool({ connectionString: process.env.DATABASE_URL }).connect();
  const cid = crypto.randomUUID();
  await c.query(`INSERT INTO "Competitor" (id, "firstName", "lastName", gender, "dateOfBirth", belt, "schoolDojang", "createdAt", "updatedAt") VALUES ($1, 'SDVerify', 'Two', 'M', '2014-01-01', 'Yellow', 'SDT', NOW(), NOW())`, [cid]);
  console.log('Inserted:', cid);

  // Use Prisma directly (same as the route does)
  const prisma = new PrismaClient();
  const r = await prisma.competitor.updateMany({
    where: { id: cid },
    data: { deletedAt: new Date() },
  });
  console.log('Prisma updateMany count:', r.count);

  // Re-query via pg
  const after = await c.query(`SELECT "deletedAt" FROM "Competitor" WHERE id = $1`, [cid]);
  console.log('deletedAt from pg after Prisma update:', after.rows[0]?.deletedAt);

  // Cleanup
  await c.query(`DELETE FROM "Competitor" WHERE id = $1`, [cid]);
  await prisma.$disconnect();
  await c.release();
})();
