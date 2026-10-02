// Root-admin "Email delivery" settings: save Mailgun credentials in the app,
// see which settings are in use, and send a test email that reports exactly
// what Mailgun answered. The API key is write-only: responses only say
// whether one is saved and its last four characters.
import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { activeEmailConfig, lastEmailOutcome, sendEmail } from '../services/email.js';
import {
  MAILGUN_BASE_URLS,
  clearEmailSettings,
  readEmailSettings,
  saveEmailSettings,
  type MailgunRegion,
} from '../services/email-settings.js';
import { createAuditLog, getClientIp, getUserAgent } from '../services/audit-log.js';
import { escapeHtml } from '../services/email-templates.js';

const router = Router();
router.use(authenticate, requireRole('admin'));

export const emailSettingsSchema = z.object({
  // Optional on update: leave blank to keep the saved key.
  apiKey: z.string().trim().min(10, 'That API key looks too short').max(200).optional().or(z.literal('')),
  domain: z.string().trim().toLowerCase()
    .regex(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, 'Enter the sending domain from Mailgun, e.g. mg.example.com'),
  region: z.enum(['us', 'eu']),
  fromName: z.string().trim().min(1).max(80),
  fromAddress: z.string().trim().toLowerCase().email('Enter a valid sender address'),
});

const last4 = (key: string) => key.slice(-4);

async function status(prisma: PrismaClient) {
  const { settings, unreadable } = await readEmailSettings(prisma);
  const active = activeEmailConfig();
  const region: MailgunRegion | null = active
    ? (active.baseUrl === MAILGUN_BASE_URLS.eu ? 'eu' : 'us')
    : null;
  return {
    inUse: active
      ? { source: active.source, domain: active.domain, region, fromName: active.fromName, fromAddress: active.fromAddress, apiKeyLast4: last4(active.apiKey) }
      : null,
    saved: settings
      ? { domain: settings.domain, region: settings.region, fromName: settings.fromName, fromAddress: settings.fromAddress, apiKeyLast4: last4(settings.apiKey) }
      : null,
    savedUnreadable: unreadable,
    lastSend: lastEmailOutcome(),
  };
}

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  res.json(await status(req.app.locals.prisma as PrismaClient));
});

router.put('/', validateRequest(emailSettingsSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const body = req.body as z.infer<typeof emailSettingsSchema>;
  const { settings: existing } = await readEmailSettings(prisma);
  const apiKey = body.apiKey || existing?.apiKey;
  if (!apiKey) return res.status(400).json({ error: 'Enter your Mailgun API key.' });
  // Mailgun only delivers reliably when the sender is on the sending domain
  // (or its parent, e.g. noreply@example.com via mg.example.com).
  const fromDomain = body.fromAddress.split('@')[1] ?? '';
  if (fromDomain !== body.domain && !body.domain.endsWith(`.${fromDomain}`)) {
    return res.status(400).json({ error: `The sender address should be on ${body.domain} (for example noreply@${body.domain}).` });
  }
  await saveEmailSettings(prisma, {
    apiKey,
    domain: body.domain,
    region: body.region,
    fromName: body.fromName,
    fromAddress: body.fromAddress,
  }, req.user!.id);
  await createAuditLog(prisma, {
    userId: req.user!.id,
    action: 'email_settings_saved',
    details: { domain: body.domain, region: body.region, fromAddress: body.fromAddress, apiKeyChanged: Boolean(body.apiKey) },
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
  });
  res.json(await status(prisma));
});

router.delete('/', async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  await clearEmailSettings(prisma);
  await createAuditLog(prisma, {
    userId: req.user!.id,
    action: 'email_settings_cleared',
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
  });
  res.json(await status(prisma));
});

// Sends to the signed-in admin and waits for Mailgun's answer.
router.post('/test', async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  if (!activeEmailConfig()) {
    return res.status(400).json({ ok: false, error: 'Email is not set up yet. Save your Mailgun settings first.' });
  }
  const to = req.user!.email;
  const result = await sendEmail(
    to,
    'Test email from your tournament app',
    `<p>Hello ${escapeHtml(req.user!.firstName || '')},</p><p>Email delivery is working. Sign-in links and registration emails will be sent from this address.</p>`,
  );
  res.status(result.success ? 200 : 502).json({ ok: result.success, to, error: result.error, status: await status(prisma) });
});

export default router;
