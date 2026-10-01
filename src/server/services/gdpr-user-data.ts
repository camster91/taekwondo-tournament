import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Records outside the User row that carry a person's PII: the email on
 * match audit entries they wrote, invitations addressed to them, and the
 * support tickets they opened (contact details + conversation text).
 * Used by the GDPR export and by account deletion, which must not leave
 * these behind.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export interface DataSubject {
  id: string;
  email: string;
}

const emailMatch = (email: string) => ({ equals: email, mode: 'insensitive' as const });

const matchAuditWhere = (user: DataSubject): Prisma.MatchAuditLogWhereInput => ({
  OR: [{ userId: user.id }, { userEmail: emailMatch(user.email) }],
});
const invitationWhere = (user: DataSubject): Prisma.InvitationWhereInput => ({ email: emailMatch(user.email) });
const supportTicketWhere = (user: DataSubject): Prisma.SupportTicketWhereInput => ({
  OR: [{ userId: user.id }, { requestedByEmail: emailMatch(user.email) }],
});

function parseConversation(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** The user's PII held in match audit logs, invitations and support tickets. */
export async function exportUserLinkedRecords(db: Db, user: DataSubject) {
  const [matchAuditLogs, invitations, supportTickets] = await Promise.all([
    db.matchAuditLog.findMany({
      where: matchAuditWhere(user),
      select: { matchId: true, action: true, userEmail: true, reason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
    db.invitation.findMany({
      where: invitationWhere(user),
      select: { email: true, firstName: true, lastName: true, role: true, status: true, createdAt: true, cancelledAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.supportTicket.findMany({
      where: supportTicketWhere(user),
      select: {
        subject: true, status: true, requestedByEmail: true, requestedByName: true, page: true,
        lastUserMessage: true, lastAssistantMessage: true, conversation: true, createdAt: true, resolvedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return {
    matchAuditLogs,
    invitations,
    supportTickets: supportTickets.map((t) => ({ ...t, conversation: parseConversation(t.conversation) })),
  };
}

const REDACTED = '[deleted]';

/**
 * Anonymise the user's PII in records that outlive the account. Run inside
 * the account-deletion transaction. Operational facts are kept (which match
 * changed, an invitation existed, a ticket was handled); who it was and
 * what they wrote are removed. Pending invitations to the address are
 * cancelled so the link cannot recreate the account.
 */
export async function anonymiseUserLinkedRecords(tx: Prisma.TransactionClient, user: DataSubject) {
  const placeholderEmail = `deleted-user-${user.id}@deleted.invalid`;
  const now = new Date();

  const matchAuditLogs = await tx.matchAuditLog.updateMany({
    where: matchAuditWhere(user),
    data: { userEmail: null },
  });
  const cancelledInvitations = await tx.invitation.updateMany({
    where: { ...invitationWhere(user), status: 'pending' },
    data: { status: 'cancelled', cancelledAt: now },
  });
  const invitations = await tx.invitation.updateMany({
    where: invitationWhere(user),
    data: { email: placeholderEmail, firstName: null, lastName: null, lastDeliveryError: null },
  });
  const supportTickets = await tx.supportTicket.updateMany({
    where: supportTicketWhere(user),
    data: {
      userId: null,
      requestedByEmail: null,
      requestedByName: null,
      subject: REDACTED,
      lastUserMessage: REDACTED,
      lastAssistantMessage: null,
      conversation: '[]',
    },
  });

  return {
    matchAuditLogs: matchAuditLogs.count,
    invitations: invitations.count,
    cancelledInvitations: cancelledInvitations.count,
    supportTickets: supportTickets.count,
  };
}
