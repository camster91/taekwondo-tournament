import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { authenticate, optionalAuthenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { sendEmail } from '../services/email.js';
import {
  supportChatSchema,
  supportTicketQuerySchema,
  supportTicketUpdateSchema,
  supportConfigSchema,
} from './support-validation.js';
import { answerOperationalQuery, parseOperationalQuery } from '../services/operational-query.js';

interface SupportChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

interface SupportTicketPayload {
  id: string;
  status: string;
  priority: string;
  subject: string;
}

const router = Router();
const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many support requests, please slow down.' },
});

const SUPPORT_SETTINGS_KEY = 'supportIntegration';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

const escalationKeywords = [
  'urgent',
  'down',
  'error',
  'broken',
  'not working',
  'issue',
  'billing',
  'payment',
  'refund',
  'inaccessible',
  'can\'t',
  'cannot',
  'failed',
  'critical',
  'outage',
  'support',
  'human',
];

function classifyPriority(message: string, priority?: 'low' | 'normal' | 'high'): 'low' | 'normal' | 'high' {
  if (priority) return priority;
  const lowered = message.toLowerCase();
  if (['urgent', 'critical', 'outage', 'down', 'critical'].some((keyword) => lowered.includes(keyword))) {
    return 'high';
  }
  if (['billing', 'payment', 'refund'].some((keyword) => lowered.includes(keyword))) {
    return 'normal';
  }
  return 'normal';
}

function shouldEscalate(message: string, explicit?: boolean): boolean {
  if (explicit) return true;
  const lowered = message.toLowerCase();
  return escalationKeywords.some((keyword) => lowered.includes(keyword));
}

function buildSubject(message: string): string {
  return message.length > 80 ? `${message.slice(0, 77).trim()}...` : message;
}

function buildFallbackReply(message: string): string {
  const lowered = message.toLowerCase();
  if (lowered.includes('register')) {
    return 'For registration issues, open the Registration Portal and verify your tournament slug and email. If it still fails, I can log a support ticket for you.';
  }
  if (lowered.includes('scoreboard') || lowered.includes('live')) {
    return 'If the live scoreboard is not refreshing, check public display status and confirm the tournament is published. I can escalate this as a support ticket if the issue persists.';
  }
  if (lowered.includes('sign in') || lowered.includes('login') || lowered.includes('magic')) {
    return 'If sign-in is failing, clear browser cache and try again from the login screen. If you still cannot access your account, we can raise this directly with support.';
  }
  return 'I logged your question and can pass it to the support team. Share a preferred contact name/email if you want me to create a ticket now.';
}

interface SupportAssistOutput {
  executed: boolean;
  request: string;
  intent?: string;
  details: string;
  recommendations: string[];
}

interface SupportDiagnosticsSnapshot {
  openSupportTickets: number;
  inProgressSupportTickets: number;
  highPrioritySupportTickets: number;
  staleDraftTournaments: number;
  openScoreboards: number;
}

const HIGH_PRIORITY_SUPPORT_AGE_HOURS = 48;

function formatSupportRecommendation(lines: string[]): string {
  if (lines.length === 0) return '';
  return `\n\nRecommended next steps:\n${lines.map((line) => `• ${line}`).join('\n')}`;
}

function buildDiagnosticRecommendations(intent: string): string[] {
  switch (intent) {
    case 'ring_delay':
      return [
        'Reassign available competitors to the ring where delay is detected.',
        'Check match statuses and swap any stalled match into the queue.',
        'Confirm judges/timer devices are signed in on the ring scoreboard page.',
      ];
    case 'blocked_divisions':
      return [
        'Open Tournament Settings and review division setup for missing brackets.',
        'Run the category auto-generation again after confirming registrations are complete.',
      ];
    case 'next_competitors':
      return [
        'Refresh the schedule and open the director page to review queue order.',
      ];
    case 'schools_need_checkin':
      return [
        'Open Check-in and complete registration confirmations by school.',
        'Ask remaining parents to confirm their confirmation code in Register flow.',
      ];
    default:
      return [
        'If the same condition repeats, use the Support Tickets page and include a screenshot.',
      ];
  }
}

async function buildSupportDiagnosticsSnapshot(prisma: PrismaClient): Promise<SupportDiagnosticsSnapshot> {
  const staleCutoff = new Date(Date.now() - HIGH_PRIORITY_SUPPORT_AGE_HOURS * 60 * 60_000);
  const [
    openSupportTickets,
    inProgressSupportTickets,
    highPrioritySupportTickets,
    staleDraftTournaments,
    openScoreboards,
  ] = await Promise.all([
    prisma.supportTicket.count({ where: { status: 'open' } }),
    prisma.supportTicket.count({ where: { status: 'in_progress' } }),
    prisma.supportTicket.count({
      where: {
        status: { in: ['open', 'in_progress'] },
        priority: 'high',
      },
    }),
    prisma.tournament.count({ where: { status: 'draft', deletedAt: null, createdAt: { lte: staleCutoff } } }),
    prisma.tournament.count({ where: { status: 'registration', publicSlug: { not: null }, deletedAt: null } }),
  ]);

  return {
    openSupportTickets,
    inProgressSupportTickets,
    highPrioritySupportTickets,
    staleDraftTournaments,
    openScoreboards,
  };
}

async function runSupportAssist(
  prisma: PrismaClient,
  message: string,
  requestedTournamentId?: string,
  requestedExplicitly = false,
): Promise<SupportAssistOutput | null> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) return null;

  const lower = trimmedMessage.toLowerCase();
  if (requestedTournamentId) {
    const parsedIntent = parseOperationalQuery(trimmedMessage);
    if (parsedIntent.kind !== 'unsupported') {
      const operationalAnswer = await answerOperationalQuery(prisma, requestedTournamentId, trimmedMessage);
      if (operationalAnswer) {
        return {
          executed: true,
          request: trimmedMessage,
          intent: parsedIntent.kind,
          details: `${operationalAnswer.answer}\nEvidence: ${operationalAnswer.evidence
            .slice(0, 4)
            .map((e) => e.label || e.href)
            .join(', ') || 'none recorded'}`,
          recommendations: buildDiagnosticRecommendations(parsedIntent.kind),
        };
      }
      return {
        executed: false,
        request: trimmedMessage,
        details: 'That tournament could not be located, so I could not safely run tournament diagnostics.',
        recommendations: ['Verify the tournament ID and try again.'],
      };
    }
  }

  if (!requestedExplicitly && !/diagnostic|health|support status|support snapshot|support dashboard/i.test(lower)) {
    return null;
  }

  const snapshot = await buildSupportDiagnosticsSnapshot(prisma);
  return {
    executed: true,
    request: trimmedMessage,
    intent: 'platform_diagnostics',
    details: `Current support health snapshot: ${snapshot.openSupportTickets} open tickets, ${snapshot.inProgressSupportTickets} in progress, ${snapshot.highPrioritySupportTickets} high-priority, ${snapshot.staleDraftTournaments} stale draft tournament(s), ${snapshot.openScoreboards} public scoreboards.`,
    recommendations: [
      'Prioritize high-priority and older open tickets first.',
      'Refresh stale draft tournaments before publishing if they are blocked from launch.',
      'If API responses look inconsistent, open a new support ticket with timestamps and browser console output.',
    ],
  };
}

interface SupportRuntimeConfig {
  openAiApiKey: string;
  openAiModel: string;
  openAiBaseUrl: string;
  supportAlertEmail: string;
}

interface SupportConfigForOrg {
  openAiApiKey?: string;
  openAiModel?: string;
  openAiBaseUrl?: string;
  supportAlertEmail?: string;
}

function readOrganizationSettings(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore corrupt settings
  }
  return {};
}

function readSupportSection(settings: Record<string, unknown>): SupportConfigForOrg {
  const section = settings[SUPPORT_SETTINGS_KEY];
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    return {};
  }
  const record = section as Record<string, unknown>;
  return {
    openAiApiKey: typeof record.openAiApiKey === 'string' ? record.openAiApiKey.trim() : undefined,
    openAiModel: typeof record.openAiModel === 'string' ? record.openAiModel.trim() : undefined,
    openAiBaseUrl: typeof record.openAiBaseUrl === 'string' ? record.openAiBaseUrl.trim() : undefined,
    supportAlertEmail: typeof record.supportAlertEmail === 'string' ? record.supportAlertEmail.trim() : undefined,
  };
}

function sanitizeSupportConfig(config: SupportRuntimeConfig) {
  return {
    hasOpenAiApiKey: Boolean(config.openAiApiKey),
    openAiModel: config.openAiModel,
    openAiBaseUrl: config.openAiBaseUrl,
    supportAlertEmail: config.supportAlertEmail,
  };
}

async function getSupportOrganizationId(prisma: PrismaClient, userId: string): Promise<string | null> {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    select: { organizationId: true },
    orderBy: { createdAt: 'asc' },
    take: 1,
  });
  return memberships[0]?.organizationId ?? null;
}

async function resolveSupportConfig(
  prisma: PrismaClient,
  userId?: string
): Promise<SupportRuntimeConfig> {
  const envConfig = {
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() || '',
    openAiModel: DEFAULT_OPENAI_MODEL,
    openAiBaseUrl: DEFAULT_OPENAI_BASE_URL,
    supportAlertEmail: process.env.SUPPORT_ALERT_EMAIL?.trim() || '',
  };
  if (!userId) return envConfig;

  const organizationId = await getSupportOrganizationId(prisma, userId);
  if (!organizationId) return envConfig;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  if (!organization) return envConfig;

  const orgConfig = readSupportSection(readOrganizationSettings(organization.settings));
  return {
    openAiApiKey: orgConfig.openAiApiKey?.trim() || envConfig.openAiApiKey,
    openAiModel: orgConfig.openAiModel || envConfig.openAiModel,
    openAiBaseUrl: orgConfig.openAiBaseUrl || envConfig.openAiBaseUrl,
    supportAlertEmail: orgConfig.supportAlertEmail || envConfig.supportAlertEmail,
  };
}

async function generateAssistantReply(
  message: string,
  config: SupportRuntimeConfig,
  page?: string | null
): Promise<string> {
  if (!config.openAiApiKey) {
    return buildFallbackReply(message);
  }

  try {
    const response = await fetch(`${config.openAiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: config.openAiModel,
        temperature: 0.15,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: 'You are the Bowin support assistant for a taekwondo tournament operations app. Keep responses concise, practical, and friendly. Include next actions and ask for one ticket if the issue cannot be safely resolved in one step.',
          },
          {
            role: 'user',
            content: `Page: ${page || 'unknown'}\nMessage: ${message}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn('[support-chat] OpenAI API error:', response.status, text.slice(0, 200));
      return buildFallbackReply(message);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>; 
    };
    const answer = payload.choices?.[0]?.message?.content;
    if (!answer || !answer.trim()) {
      return buildFallbackReply(message);
    }
    return answer.trim();
  } catch (error) {
    console.warn('[support-chat] OpenAI call failed:', error);
    return buildFallbackReply(message);
  }
}

function appendConversation(
  existing: SupportChatMessage[] | null,
  message: string,
  reply: string
): SupportChatMessage[] {
  const now = new Date().toISOString();
  const base = existing ?? [];
  base.push(
    { role: 'user', content: message, at: now },
    { role: 'assistant', content: reply, at: now }
  );
  return base;
}

async function notifySupportTeam(
  ticketId: string,
  subject: string,
  message: string,
  supportEmail: string,
): Promise<void> {
  if (!supportEmail) return;
  try {
    await sendEmail(
      supportEmail,
      `Support ticket queued: ${subject}`,
      `<p>New support ticket <strong>${ticketId}</strong> has been created.</p><p>${message}</p>`
    );
  } catch (error) {
    console.warn('[support] failed to notify support email:', error);
  }
}

async function handleSupportChat(req: AuthenticatedRequest, res: Response) {
  const prisma: PrismaClient = req.app.locals.prisma;
  const body = req.body;
  const normalizedMessage = body.message.trim();
  const requestedTournamentId = body.tournamentId?.trim() || undefined;
  const requestAssist = body.requestAssist === true;
  const config = await resolveSupportConfig(prisma, req.user?.id);
  const supportAssist = await runSupportAssist(prisma, normalizedMessage, requestedTournamentId, requestAssist);

  const assistantMessage = await generateAssistantReply(normalizedMessage, config, body.page);
  const conversationId = body.conversationId?.trim() || null;
  const escalate = shouldEscalate(normalizedMessage, body.createTicket === true);

  let existingTicket: SupportTicketPayload | null = null;
  const subject = buildSubject(normalizedMessage);
  const priority = classifyPriority(normalizedMessage, body.priority);
  const finalMessage = supportAssist
    ? `${assistantMessage}\n\n${supportAssist.details}${supportAssist.recommendations.length ? formatSupportRecommendation(supportAssist.recommendations) : ''}`
    : assistantMessage;

  if (escalate) {
    const conversation: SupportChatMessage[] = appendConversation(
      conversationId ? [] : null,
      normalizedMessage,
      finalMessage,
    );
    const ticket = await prisma.supportTicket.create({
      data: {
      source: req.user ? 'app' : 'marketing',
        status: 'open',
        priority,
        subject,
        requestedByEmail: body.contactEmail ?? req.user?.email ?? null,
        requestedByName: body.contactName ?? (req.user ? `${req.user.firstName} ${req.user.lastName}` : null),
        page: body.page,
        lastUserMessage: normalizedMessage,
        lastAssistantMessage: finalMessage,
        conversation: JSON.stringify(conversation),
        userId: req.user?.id ?? null,
      },
    });

    void notifySupportTeam(ticket.id, subject, normalizedMessage, config.supportAlertEmail);

    existingTicket = {
      id: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      subject: ticket.subject,
    };
  }

  return res.json({
    answer: finalMessage,
    ticket: existingTicket,
    escalated: Boolean(existingTicket),
    conversationId,
    supportAssistant: supportAssist
      ? {
          request: supportAssist.request,
          intent: supportAssist.intent ?? 'general',
          executed: supportAssist.executed,
          recommendations: supportAssist.recommendations,
        }
      : null,
  });
}

const supportChatHandler = [
  optionalAuthenticate,
  chatLimiter,
  validateRequest(supportChatSchema),
  handleSupportChat,
] as const;

router.post('/', ...supportChatHandler);
router.post('/chat', ...supportChatHandler);

router.get(
  '/config',
  authenticate,
  requireRole('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const config = await resolveSupportConfig(prisma, req.user?.id);
    res.json(sanitizeSupportConfig(config));
  }
);

router.patch(
  '/config',
  authenticate,
  requireRole('admin'),
  validateRequest(supportConfigSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const update = req.body;
    const organizationId = req.user?.id ? await getSupportOrganizationId(prisma, req.user.id) : null;
    if (!organizationId) {
      return res.status(404).json({ error: 'No organization found for this account.' });
    }

    if (update.clearOpenAiApiKey === true && update.openAiApiKey !== undefined) {
      return res.status(400).json({ error: 'Use either clearOpenAiApiKey or openAiApiKey, not both.' });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found.' });
    }

    const settings = readOrganizationSettings(organization.settings);
    const currentSection = readSupportSection(settings);
    const nextSection: {
      openAiApiKey?: string | null;
      openAiModel?: string;
      openAiBaseUrl?: string;
      supportAlertEmail?: string;
    } = { ...currentSection };

    if (update.openAiModel !== undefined) nextSection.openAiModel = update.openAiModel;
    if (update.openAiBaseUrl !== undefined) nextSection.openAiBaseUrl = update.openAiBaseUrl;
    if (update.supportAlertEmail !== undefined) nextSection.supportAlertEmail = update.supportAlertEmail;

    if (update.clearOpenAiApiKey === true) {
      nextSection.openAiApiKey = null;
    } else if (update.openAiApiKey !== undefined) {
      nextSection.openAiApiKey = update.openAiApiKey;
    }

    const hasAnyChanges =
      update.openAiApiKey !== undefined ||
      update.openAiModel !== undefined ||
      update.openAiBaseUrl !== undefined ||
      update.supportAlertEmail !== undefined ||
      update.clearOpenAiApiKey === true;
    if (!hasAnyChanges) {
      return res.status(400).json({ error: 'No supported support settings were provided.' });
    }

    const storedSection = nextSection as Record<string, unknown>;
    const mergedSettings: Record<string, unknown> = {
      ...settings,
      [SUPPORT_SETTINGS_KEY]: {
        ...(settings[SUPPORT_SETTINGS_KEY] && typeof settings[SUPPORT_SETTINGS_KEY] === 'object' && !Array.isArray(settings[SUPPORT_SETTINGS_KEY])
          ? settings[SUPPORT_SETTINGS_KEY]
          : {}),
        ...storedSection,
      },
    };

    await prisma.organization.update({
      where: { id: organizationId },
      data: { settings: JSON.stringify(mergedSettings) },
    });

    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const resolved = await resolveSupportConfig(prisma, req.user.id);
    res.json(sanitizeSupportConfig(resolved));
  }
);

router.get(
  '/',
  authenticate,
  requireRole('admin', 'director'),
  validateRequest(supportTicketQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const parsed = req.query as { status?: 'open' | 'in_progress' | 'resolved' | 'closed'; limit?: number };

    const tickets = await prisma.supportTicket.findMany({
      where: parsed.status ? { status: parsed.status } : {},
      orderBy: { createdAt: 'desc' },
      take: parsed.limit ?? 60,
    });

    res.json(tickets);
  }
);

router.patch(
  '/:id',
  authenticate,
  requireRole('admin', 'director'),
  validateRequest(supportTicketUpdateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const ticketId = req.params.id;
    const update = req.body;

    const existing = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Support ticket not found' });
    }

    const next: {
      status?: string;
      priority?: string;
      notes?: string | null;
      resolvedAt?: Date | null;
    } = {
      status: existing.status,
      priority: existing.priority,
      notes: existing.notes,
      resolvedAt: existing.resolvedAt,
    };

    if (update.status) {
      next.status = update.status;
      if (['resolved', 'closed'].includes(update.status)) {
        next.resolvedAt = new Date();
      } else {
        next.resolvedAt = null;
      }
    }

    if (update.priority) {
      next.priority = update.priority;
    }

    if (Object.prototype.hasOwnProperty.call(update, 'notes')) {
      next.notes = update.notes ?? null;
    }

    const ticket = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: next.status,
        priority: next.priority,
        notes: next.notes,
        resolvedAt: next.resolvedAt,
      },
    });

    res.json(ticket);
  }
);

export default router;

