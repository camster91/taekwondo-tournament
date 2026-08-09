import { createPrivateKey, sign } from 'node:crypto';

const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface OfflineCapabilityUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  createdAt?: string;
  isDemo?: boolean;
  demoExpiresAt?: string | null;
}

export function issueOfflineCapability({
  user,
  privateKeyBase64,
  now = Date.now(),
}: {
  user: OfflineCapabilityUser;
  privateKeyBase64: string;
  now?: number;
}): string {
  const demoExpiry = user.demoExpiresAt ? Date.parse(user.demoExpiresAt) : Number.POSITIVE_INFINITY;
  const expiresAt = Math.min(now + MAX_AGE_MS, demoExpiry);
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    audience: 'bowin-offline',
    user,
    issuedAt: now,
    expiresAt,
  })).toString('base64url');
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'), format: 'der', type: 'pkcs8',
  });
  return `${payload}.${sign(null, Buffer.from(payload), privateKey).toString('base64url')}`;
}

export function maybeIssueOfflineCapability(user: OfflineCapabilityUser): string | undefined {
  const privateKeyBase64 = process.env.OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64;
  if (!privateKeyBase64) return undefined;
  try {
    return issueOfflineCapability({ user, privateKeyBase64 });
  } catch {
    console.warn('Offline capability signing failed; offline authentication disabled.');
    return undefined;
  }
}
