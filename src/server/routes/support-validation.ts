import { z } from 'zod';

const providerBaseUrlSchema = z
  .string()
  .trim()
  .max(300)
  .url('Invalid base URL')
  .refine((value) => new URL(value).protocol === 'https:', 'Provider base URL must use HTTPS');

const messageSchema = z
  .string()
  .trim()
  .min(1, 'Please include a message')
  .max(2000, 'Message is too long');

export const supportChatSchema = z.object({
  message: messageSchema,
  tournamentId: z
    .string()
    .uuid({ message: 'Tournament ID must be a valid UUID' })
    .optional()
    .nullable(),
  requestAssist: z.boolean().optional(),
  page: z.string().trim().max(255).optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
  contactName: z.string().trim().min(1).max(120).optional().nullable(),
  contactEmail: z.string().trim().email().max(254).optional().nullable(),
  createTicket: z.boolean().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
});

export const supportTicketUpdateSchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
    notes: z.string().trim().max(5000).optional().nullable(),
  })
  .refine((value) => Object.values(value).some((value) => value !== undefined), {
    message: 'At least one support-ticket field is required',
  });

/** Ticket `source` written by the "Report a bug" form. */
export const BUG_REPORT_SOURCE = 'bug-report';

export const bugReportSchema = z.object({
  title: z.string().trim().min(3, 'Give the problem a short title').max(120, 'Keep the title under 120 characters'),
  whatHappened: z.string().trim().min(5, 'Describe what happened').max(2000, 'Description is too long'),
  expected: z.string().trim().max(1000, 'Too long').optional().nullable(),
  severity: z.enum(['low', 'normal', 'high']),
  page: z.string().trim().max(255).optional().nullable(),
  browser: z.string().trim().max(300).optional().nullable(),
});

/** POST /api/support/bug-reports/triage — no options yet; rejects stray fields. */
export const bugTriageSchema = z.object({}).strict();

export const supportTicketQuerySchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    source: z.string().trim().min(1).max(40).optional(),
    limit: z
      .string()
      .optional()
      .transform((value) => (value ? Number(value) : undefined))
      .pipe(z.number().int().min(1).max(200).optional()),
  })
  .transform((value) => ({
    status: value.status,
    source: value.source,
    limit: value.limit,
  }));

export const supportConfigSchema = z
  .object({
    openAiApiKey: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .nullable()
      .transform((value) => value?.trim() || null),
    openAiModel: z.string().trim().min(1).max(120).optional(),
    openAiBaseUrl: z
      .union([providerBaseUrlSchema, z.undefined()])
      .optional(),
    supportAlertEmail: z.string().trim().email().max(254).optional(),
    clearOpenAiApiKey: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.openAiApiKey !== undefined ||
      value.openAiModel !== undefined ||
      value.openAiBaseUrl !== undefined ||
      value.supportAlertEmail !== undefined ||
      value.clearOpenAiApiKey === true,
    { message: 'No support configuration values provided.' },
  );

export const supportConfigTestSchema = z.object({
  openAiApiKey: z.string().trim().min(1).max(500).optional(),
  openAiModel: z.string().trim().min(1).max(120).optional(),
  openAiBaseUrl: providerBaseUrlSchema.optional(),
});
