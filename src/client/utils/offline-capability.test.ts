import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from './auth-session.js';
import { verifyOfflineCapability } from './offline-capability.js';

const user: AuthUser = {
  id: 'operator-1', email: 'operator@example.com', firstName: 'Venue', lastName: 'Operator', role: 'scorekeeper',
};

function signedCapability(payload: object) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(null, Buffer.from(encoded), privateKey).toString('base64url');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return { capability: `${encoded}.${signature}`, publicDer };
}

describe('offline identity capability', () => {
  it('accepts a server-signed unexpired venue identity', async () => {
    const now = Date.parse('2026-08-09T12:00:00.000Z');
    const { capability, publicDer } = signedCapability({
      version: 1, audience: 'bowin-offline', user, issuedAt: now, expiresAt: now + 60_000,
    });
    await expect(verifyOfflineCapability(capability, publicDer, now)).resolves.toEqual(user);
  });

  it('rejects local payload tampering and expired capabilities', async () => {
    const now = Date.parse('2026-08-09T12:00:00.000Z');
    const signed = signedCapability({
      version: 1, audience: 'bowin-offline', user, issuedAt: now, expiresAt: now + 60_000,
    });
    const [, signature] = signed.capability.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({
      version: 1, audience: 'bowin-offline', user: { ...user, role: 'admin' }, issuedAt: now, expiresAt: now + 60_000,
    })).toString('base64url');
    await expect(verifyOfflineCapability(`${tamperedPayload}.${signature}`, signed.publicDer, now)).resolves.toBeUndefined();
    await expect(verifyOfflineCapability(signed.capability, signed.publicDer, now + 60_001)).resolves.toBeUndefined();
  });
});
