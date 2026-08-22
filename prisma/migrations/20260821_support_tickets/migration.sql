CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "subject" TEXT NOT NULL,
    "requestedByEmail" TEXT,
    "requestedByName" TEXT,
    "page" TEXT,
    "lastUserMessage" TEXT NOT NULL,
    "lastAssistantMessage" TEXT,
    "conversation" TEXT NOT NULL,
    "notes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");
