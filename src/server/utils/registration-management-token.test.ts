import { describe, expect, it } from 'vitest';
import { generateManagementToken, hashManagementToken, isValidManagementToken } from './registration-management-token.js';

describe('registration management tokens', () => {
  it('generates high-entropy URL-safe tokens and stores only a deterministic hash', () => {
    const first = generateManagementToken();
    const second = generateManagementToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(hashManagementToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashManagementToken(first)).toBe(hashManagementToken(first));
    expect(hashManagementToken(first)).not.toContain(first);
  });

  it('rejects short confirmation codes as management credentials', () => {
    expect(isValidManagementToken('deadbeef')).toBe(false);
    expect(isValidManagementToken(generateManagementToken())).toBe(true);
  });
});
