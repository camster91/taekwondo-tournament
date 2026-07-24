import { describe, it, expect } from 'vitest';
import { hashSecret, secretLookupValues } from './token-hash.js';

describe('token-hash', () => {
  it('hashes to a stable 64-char hex digest', () => {
    const a = hashSecret('abc123');
    const b = hashSecret('abc123');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe('abc123');
  });

  it('returns hash then plaintext for dual-read lookup', () => {
    const values = secretLookupValues('raw-token');
    expect(values).toEqual([hashSecret('raw-token'), 'raw-token']);
  });

  it('differs across distinct inputs', () => {
    expect(hashSecret('a')).not.toBe(hashSecret('b'));
  });
});
