import { z } from 'zod';

const incidentTypeSchema = z.enum([
  'injury',
  'disqualification',
  'medical',
  'equipment',
  'conduct',
]);

const incidentSeveritySchema = z.enum(['minor', 'moderate', 'serious']);
const incidentActionSchema = z.enum(['first_aid', 'withdrawn', 'continued', 'ambulance']);

const descriptionSchema = z.string().trim().min(1).max(5000);

export const createIncidentSchema = z.object({
  tournamentId: z.string().uuid(),
  matchId: z.string().uuid().optional().nullable(),
  registrationId: z.string().uuid().optional().nullable(),
  type: incidentTypeSchema,
  severity: incidentSeveritySchema,
  description: descriptionSchema,
  actionTaken: incidentActionSchema.optional().nullable(),
});

export const updateIncidentSchema = z
  .object({
    type: incidentTypeSchema.optional(),
    severity: incidentSeveritySchema.optional(),
    description: descriptionSchema.optional(),
    actionTaken: incidentActionSchema.optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one incident field is required',
  });
