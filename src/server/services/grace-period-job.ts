// TODO (Cameron): Wire this job to run daily via cron or scheduled task.
//
// The processExpiredGracePeriods function exists in ./grace-period.ts and is tested.
// It needs to be called once per day to downgrade organizations whose grace periods have expired.
//
// Options:
// 1. Add to system crontab on the VPS:
//    0 2 * * * cd /opt/bowin && node -e "import('./dist-server/server/services/grace-period-job.js')"
//
// 2. Use a process manager like PM2 with cron module
//
// 3. Create a simple admin endpoint (requires auth + ADMIN_GRACE_PERIOD_JOB_KEY) and use
//    external cron service (e.g. cron-job.org) to POST to it
//
// This file provides a standalone entry point for option 1 or 2.

import { PrismaClient } from '@prisma/client';
import { processExpiredGracePeriods } from './grace-period.js';

async function runGracePeriodJob() {
  const prisma = new PrismaClient();
  
  try {
    console.log('[grace-period-job] Starting expired grace period check...');
    const result = await processExpiredGracePeriods(prisma);
    
    if (result.downgraded > 0) {
      console.log(`[grace-period-job] Downgraded ${result.downgraded} organization(s)`);
    }
    
    if (result.errors.length > 0) {
      console.error('[grace-period-job] Errors occurred:');
      result.errors.forEach((err) => console.error(`  - ${err}`));
      process.exit(1);
    }
    
    console.log('[grace-period-job] Completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[grace-period-job] Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  runGracePeriodJob();
}

export { runGracePeriodJob };
