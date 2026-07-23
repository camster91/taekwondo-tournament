import { describe, expect, it } from 'vitest';
import { createIncidentSchema, updateIncidentSchema } from './incidents-validation.js';

const validCreate = {
  tournamentId: '8f22f06a-f87d-45e3-a769-a2a5fb60616c',
  type: 'injury',
  severity: 'minor',
  description: 'Twisted ankle',
};

describe('createIncidentSchema', () => {
  it('accepts a valid incident and trims its description', () => {
    const result = createIncidentSchema.safeParse({
      ...validCreate,
      description: '  Twisted ankle  ',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBe('Twisted ankle');
  });

  it('rejects a whitespace-only description', () => {
    expect(createIncidentSchema.safeParse({ ...validCreate, description: '   ' }).success).toBe(false);
  });

  it('rejects descriptions longer than 5000 characters', () => {
    expect(createIncidentSchema.safeParse({
      ...validCreate,
      description: 'x'.repeat(5001),
    }).success).toBe(false);
  });
});

describe('updateIncidentSchema', () => {
  it('rejects an empty update', () => {
    expect(updateIncidentSchema.safeParse({}).success).toBe(false);
  });

  it('regression: applies the same 5000-character description cap as create', () => {
    expect(updateIncidentSchema.safeParse({ description: 'x'.repeat(5001) }).success).toBe(false);
  });

  it('accepts and trims a valid partial update', () => {
    const result = updateIncidentSchema.safeParse({ description: '  Cleared by medic  ' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBe('Cleared by medic');
  });

  it('rejects unknown fields instead of treating them as an update', () => {
    expect(updateIncidentSchema.safeParse({ tournamentId: validCreate.tournamentId }).success).toBe(false);
  });
});
