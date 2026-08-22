import { z } from 'zod';

const messageSchema = z
  .string()
  .trim()
  .min(1, 'Please include a message')
  .max(2000, 'Message is too long');

export const supportChatSchema = z.object({
  message: messageSchema,
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

export const supportTicketQuerySchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    limit: z
      .string()
      .optional()
      .transform((value) => (value ? Number(value) : undefined))
      .pipe(z.number().int().min(1).max(200).optional()),
  })
  .transform((value) => ({
    status: value.status,
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
      .string()
      .trim()
      .max(300)
      .url('Invalid base URL')
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
