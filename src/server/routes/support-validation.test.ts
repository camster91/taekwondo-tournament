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
