import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueOfflineCapability } from './offline-capability.js';

describe('offline capability issuer', () => {
  it('issues a bounded Ed25519-signed identity capability', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const now = Date.parse('2026-08-09T12:00:00.000Z');
    const token = issueOfflineCapability({
      user: { id: 'u1', email: 'u@example.com', firstName: 'A', lastName: 'B', role: 'scorekeeper' },
      privateKeyBase64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      now,
    });
    const [payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { audience: string; expiresAt: number };
    expect(decoded.audience).toBe('bowin-offline');
    expect(decoded.expiresAt - now).toBe(12 * 60 * 60 * 1000);
    expect(verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });
});
