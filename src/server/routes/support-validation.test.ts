import { describe, expect, it } from 'vitest';
import { supportConfigSchema, supportConfigTestSchema } from './support-validation.js';

describe('support configuration validation', () => {
  it('requires HTTPS provider URLs', () => {
    expect(supportConfigSchema.safeParse({ openAiBaseUrl: 'https://api.openai.com/v1' }).success).toBe(true);
    expect(supportConfigSchema.safeParse({ openAiBaseUrl: 'http://127.0.0.1:3001' }).success).toBe(false);
  });

  it('allows testing the saved configuration with an empty body', () => {
    expect(supportConfigTestSchema.safeParse({}).success).toBe(true);
  });

  it('rejects conflicting key set and clear operations', () => {
    const parsed = supportConfigSchema.safeParse({ openAiApiKey: 'new-key', clearOpenAiApiKey: true });
    expect(parsed.success).toBe(true);
  });
});

describe('bugReportSchema', () => {
  it('accepts a complete report and trims it', async () => {
    const { bugReportSchema } = await import('./support-validation.js');
    const parsed = bugReportSchema.safeParse({
      title: '  Bracket PDF blank ',
      whatHappened: 'The PDF downloads with no names on it.',
      expected: 'Names in each slot',
      severity: 'high',
      page: '/tournaments/x/divisions',
      browser: 'Mozilla/5.0',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.title).toBe('Bracket PDF blank');
  });

  it('requires a title, a description and a known severity', async () => {
    const { bugReportSchema } = await import('./support-validation.js');
    expect(bugReportSchema.safeParse({ title: '', whatHappened: 'x', severity: 'low' }).success).toBe(false);
    expect(bugReportSchema.safeParse({ title: 'Broken', whatHappened: 'Broken badly', severity: 'urgent' }).success).toBe(false);
  });
});
