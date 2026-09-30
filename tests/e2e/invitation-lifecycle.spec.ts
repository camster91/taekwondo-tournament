import crypto from 'crypto';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { loginRequestAsEmail, withE2EPrisma } from './helpers';

// Issue #46: the staff invitation lifecycle as one API + browser matrix.
// The dev server has no Mailgun, so an invite is created with
// deliveryStatus "not_configured" and its token never leaves the server.
// The test stands in for the inbox by pinning the stored token hash to a
// value it knows, which is exactly what the emailed link carries.

const sha256 = (raw: string) => crypto.createHash('sha256').update(raw, 'utf8').digest('hex');

async function pinToken(invitationId: string, raw: string, tokenExpiry?: Date) {
  await withE2EPrisma((prisma) => prisma.invitation.update({
    where: { id: invitationId },
    data: { token: sha256(raw), ...(tokenExpiry ? { tokenExpiry } : {}) },
  }));
}

test.describe.configure({ mode: 'serial' });

test('invitation lifecycle: delivery state, duplicates, accept, replay, cancel, expiry, resend, revocation', async ({ page, request }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminEmail = `e2e-invite-admin-${stamp}@example.com`;
  const inviteeEmail = `e2e-invitee-${stamp}@example.com`;
  const cancelledEmail = `e2e-invite-cancelled-${stamp}@example.com`;
  const expiredEmail = `e2e-invite-expired-${stamp}@example.com`;
  const emails = [adminEmail, inviteeEmail, cancelledEmail, expiredEmail];

  await withE2EPrisma((prisma) => prisma.user.create({
    data: { email: adminEmail, firstName: 'E2E', lastName: 'InviteAdmin', role: 'admin' },
  }));
  const invitee = await playwrightRequest.newContext({ baseURL: test.info().project.use.baseURL });

  try {
    const admin = await loginRequestAsEmail(request, adminEmail);
    const send = (email: string, role = 'scorekeeper') => request.post('/api/invites/send', {
      headers: admin,
      data: { email, firstName: 'E2E', lastName: 'Invitee', role },
    });

    // Create: delivery outcome is recorded, not just returned once.
    const created = await send(inviteeEmail);
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.emailSent).toBe(false);
    expect(createdBody.invitation.deliveryStatus).toBe('not_configured');
    const inviteId = createdBody.invitation.id as string;

    // Duplicate email (any case) is refused while the invite is pending.
    expect((await send(inviteeEmail.toUpperCase())).status()).toBe(409);

    // Accept through the emailed link with the invited role.
    await pinToken(inviteId, `accept-${stamp}`);
    const verified = await request.get(`/api/invites/verify/accept-${stamp}`);
    expect(verified.status()).toBe(200);
    expect((await verified.json()).role).toBe('scorekeeper');

    const accepted = await invitee.post('/api/auth/accept-invite', {
      data: { token: `accept-${stamp}`, firstName: 'E2E', lastName: 'Invitee' },
    });
    expect(accepted.status()).toBe(201);
    const acceptedUser = (await accepted.json()).user as { id: string; role: string };
    expect(acceptedUser.role).toBe('scorekeeper');
    expect((await invitee.get('/api/auth/me')).status()).toBe(200);

    // Replay of the same link is refused and creates nothing.
    const replay = await request.post('/api/auth/accept-invite', {
      data: { token: `accept-${stamp}`, firstName: 'E2E', lastName: 'Replay' },
    });
    expect(replay.status()).toBe(410);
    expect((await replay.json()).code).toBe('accepted');
    // The address now belongs to an account, so it can't be invited again.
    expect((await send(inviteeEmail)).status()).toBe(409);

    // Cancel keeps the row; the link then fails clearly.
    const toCancel = await (await send(cancelledEmail, 'viewer')).json();
    expect((await request.delete(`/api/invites/${toCancel.invitation.id}`, { headers: admin })).status()).toBe(204);
    await pinToken(toCancel.invitation.id, `cancelled-${stamp}`);
    const cancelledVerify = await request.get(`/api/invites/verify/cancelled-${stamp}`);
    expect(cancelledVerify.status()).toBe(410);
    expect((await cancelledVerify.json()).code).toBe('cancelled');
    const cancelledAccept = await request.post('/api/auth/accept-invite', {
      data: { token: `cancelled-${stamp}`, firstName: 'E2E', lastName: 'Cancelled' },
    });
    expect(cancelledAccept.status()).toBe(410);
    expect((await request.post(`/api/invites/resend/${toCancel.invitation.id}`, { headers: admin })).status()).toBe(409);

    await page.goto(`/accept-invite?token=cancelled-${stamp}`);
    await expect(page.getByText('This invitation was cancelled.')).toBeVisible();

    // Expiry fails clearly; resend renews it back to pending.
    const toExpire = await (await send(expiredEmail, 'viewer')).json();
    await pinToken(toExpire.invitation.id, `expired-${stamp}`, new Date(Date.now() - 60_000));
    const expiredVerify = await request.get(`/api/invites/verify/expired-${stamp}`);
    expect(expiredVerify.status()).toBe(410);
    expect((await expiredVerify.json()).code).toBe('expired');
    const resent = await request.post(`/api/invites/resend/${toExpire.invitation.id}`, { headers: admin });
    expect(resent.status()).toBe(200);
    expect((await resent.json()).deliveryStatus).toBe('not_configured');
    // Resend rotates the token, so the old link stays dead.
    expect((await request.get(`/api/invites/verify/expired-${stamp}`)).status()).toBe(404);
    const listed = await (await request.get('/api/invites', { headers: admin })).json() as Array<{
      id: string; status: string; deliveryStatus: string | null;
    }>;
    expect(listed.find((row) => row.id === toExpire.invitation.id)).toMatchObject({
      status: 'pending', deliveryStatus: 'not_configured',
    });
    expect(listed.find((row) => row.id === toCancel.invitation.id)?.status).toBe('cancelled');

    // A role change revokes the invitee's existing session on its next request.
    const demoted = await request.put(`/api/auth/users/${acceptedUser.id}/role`, {
      headers: admin,
      data: { role: 'viewer' },
    });
    expect(demoted.status()).toBe(200);
    expect((await invitee.get('/api/auth/me')).status()).toBe(401);
  } finally {
    await invitee.dispose();
    await withE2EPrisma(async (prisma) => {
      await prisma.invitation.deleteMany({ where: { email: { in: emails } } });
      await prisma.magicLink.deleteMany({ where: { email: { in: emails } } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    });
  }
});
