import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { anonymiseUserLinkedRecords, exportUserLinkedRecords } from './gdpr-user-data.js';

const databaseUrl = process.env.GDPR_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
let prisma: PrismaClient;

integration('GDPR export + anonymisation of user-linked records against disposable Postgres', () => {
  const user = { id: randomUUID(), email: `gdpr-${randomUUID()}@example.com` };
  const other = { id: randomUUID(), email: `other-${randomUUID()}@example.com` };
  const matchId = randomUUID();
  const ids = { audit: [] as string[], invites: [] as string[], tickets: [] as string[] };

  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('GDPR_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    for (const who of [user, other]) {
      const audit = await prisma.matchAuditLog.create({ data: {
        matchId, action: 'update', previousState: '{}', newState: '{}', userId: who.id, userEmail: who.email,
      } });
      const invite = await prisma.invitation.create({ data: {
        email: who.email.toUpperCase(), firstName: 'Pat', lastName: 'Doe', token: randomUUID(), tokenExpiry: new Date('2031-01-01'),
        invitedBy: randomUUID(), status: 'pending', lastDeliveryError: `bounce for ${who.email}`,
      } });
      const ticket = await prisma.supportTicket.create({ data: {
        source: 'web-chat', subject: `Help for ${who.email}`, requestedByEmail: who.email, requestedByName: 'Pat Doe',
        lastUserMessage: 'my phone is 555-0100', conversation: JSON.stringify([{ role: 'user', content: 'my phone is 555-0100' }]),
        userId: who.id,
      } });
      ids.audit.push(audit.id);
      ids.invites.push(invite.id);
      ids.tickets.push(ticket.id);
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.matchAuditLog.deleteMany({ where: { id: { in: ids.audit } } });
    await prisma.invitation.deleteMany({ where: { id: { in: ids.invites } } });
    await prisma.supportTicket.deleteMany({ where: { id: { in: ids.tickets } } });
    await prisma.$disconnect();
  });

  it('exports the records that hold the user\'s PII (and nobody else\'s)', async () => {
    const data = await exportUserLinkedRecords(prisma, user);
    expect(data.matchAuditLogs).toEqual([expect.objectContaining({ matchId, userEmail: user.email })]);
    expect(data.invitations).toEqual([expect.objectContaining({ email: user.email.toUpperCase(), firstName: 'Pat' })]);
    expect(data.supportTickets).toEqual([expect.objectContaining({
      requestedByEmail: user.email, conversation: [{ role: 'user', content: 'my phone is 555-0100' }],
    })]);
  });

  it('anonymises them in a deletion transaction, leaving other users untouched', async () => {
    const counts = await prisma.$transaction((tx) => anonymiseUserLinkedRecords(tx, user));
    expect(counts).toEqual({ matchAuditLogs: 1, invitations: 1, cancelledInvitations: 1, supportTickets: 1 });

    const [audit, invite, ticket] = await Promise.all([
      prisma.matchAuditLog.findUniqueOrThrow({ where: { id: ids.audit[0] } }),
      prisma.invitation.findUniqueOrThrow({ where: { id: ids.invites[0] } }),
      prisma.supportTicket.findUniqueOrThrow({ where: { id: ids.tickets[0] } }),
    ]);
    const serialized = JSON.stringify([audit, invite, ticket]).toLowerCase();
    expect(serialized).not.toContain(user.email.toLowerCase());
    expect(serialized).not.toContain('555-0100');
    expect(serialized).not.toContain('pat');
    expect(invite).toMatchObject({ status: 'cancelled', firstName: null, lastName: null, lastDeliveryError: null });
    expect(ticket).toMatchObject({ userId: null, requestedByEmail: null, conversation: '[]' });

    // Audit entries keep the (now meaningless) user id, not the email.
    expect(await exportUserLinkedRecords(prisma, user)).toEqual({
      matchAuditLogs: [expect.objectContaining({ userEmail: null })], invitations: [], supportTickets: [],
    });
    const untouched = await exportUserLinkedRecords(prisma, other);
    expect(untouched.matchAuditLogs).toHaveLength(1);
    expect(untouched.invitations).toHaveLength(1);
    expect(untouched.supportTickets).toHaveLength(1);
  });
});
