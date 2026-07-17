-- BackupState table. Replaces the file-based BACKUP_DIR/<tournamentId>.json
-- store used by backup-recovery.ts. One row per tournament — the row is
-- overwritten on each saveBackup() call and deleted on clearBackup() (after
-- a successful restore or after the bracket regeneration that produced
-- it completes without rollback). Closes day-2 follow-up: move backupStore
-- to DB table.
--
-- Schema choice: the payload is a free-form JSON string (NOT normalized
-- into a BackupStateDivision / BackupStateAssignment sub-table) because
-- the structure mirrors the live Division + DivisionAssignment + Bracket
-- models and would need to track every schema change. The cost is a
-- ~10 KB JSON parse on every getBackup() — acceptable for the rollback
-- path which only runs when a bracket regeneration fails.
CREATE TABLE IF NOT EXISTS "BackupState" (
    "tournamentId" TEXT NOT NULL,
    "payload"      TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BackupState_pkey" PRIMARY KEY ("tournamentId")
);
