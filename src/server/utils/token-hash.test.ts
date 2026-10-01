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

  it('matches only the hash, never the raw value', () => {
    expect(secretLookupValues('raw-token')).toEqual([hashSecret('raw-token')]);
    // Submitting a stored hash must not match that same stored row.
    const stored = hashSecret('raw-token');
    expect(secretLookupValues(stored)).not.toContain(stored);
  });

  it('differs across distinct inputs', () => {
    expect(hashSecret('a')).not.toBe(hashSecret('b'));
  });
});
