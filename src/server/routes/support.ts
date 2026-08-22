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
} from './support-validation.js';

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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const SUPPORT_ALERT_EMAIL = process.env.SUPPORT_ALERT_EMAIL?.trim() || '';

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

async function generateAssistantReply(message: string, page?: string | null): Promise<string> {
  if (!OPENAI_API_KEY) {
    return buildFallbackReply(message);
  }

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
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

async function notifySupportTeam(ticketId: string, subject: string, message: string): Promise<void> {
  if (!SUPPORT_ALERT_EMAIL) return;
  try {
    await sendEmail(
      SUPPORT_ALERT_EMAIL,
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

  const assistantMessage = await generateAssistantReply(normalizedMessage, body.page);
  const conversationId = body.conversationId?.trim() || null;
  const escalate = shouldEscalate(normalizedMessage, body.createTicket === true);

  let existingTicket: SupportTicketPayload | null = null;
  const subject = buildSubject(normalizedMessage);
  const priority = classifyPriority(normalizedMessage, body.priority);

  if (escalate) {
    const conversation: SupportChatMessage[] = appendConversation(
      conversationId ? [] : null,
      normalizedMessage,
      assistantMessage,
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
        lastAssistantMessage: assistantMessage,
        conversation: JSON.stringify(conversation),
        userId: req.user?.id ?? null,
      },
    });

    void notifySupportTeam(ticket.id, subject, normalizedMessage);

    existingTicket = {
      id: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      subject: ticket.subject,
    };
  }

  return res.json({
    answer: assistantMessage,
    ticket: existingTicket,
    escalated: Boolean(existingTicket),
    conversationId,
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
