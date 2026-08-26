import { isAuthUser, type AuthUser } from './auth-session.js';

const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function decodeBase64(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

export async function verifyOfflineCapability(
  capability: string,
  publicKeyBase64: string,
  now = Date.now(),
): Promise<AuthUser | undefined> {
  try {
    const [encodedPayload, encodedSignature, extra] = capability.split('.');
    if (!encodedPayload || !encodedSignature || extra || !publicKeyBase64) return undefined;
    const payload: unknown = JSON.parse(new TextDecoder().decode(decodeBase64(encodedPayload)));
    if (!payload || typeof payload !== 'object') return undefined;
    const value = payload as Record<string, unknown>;
    if (value.version !== 1 || value.audience !== 'bowin-offline' || !isAuthUser(value.user)
      || typeof value.issuedAt !== 'number' || typeof value.expiresAt !== 'number'
      || value.issuedAt > now || value.expiresAt <= now
      || value.expiresAt - value.issuedAt > MAX_AGE_MS) return undefined;
    const key = await crypto.subtle.importKey(
      'spki', decodeBase64(publicKeyBase64), { name: 'Ed25519' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' }, key, decodeBase64(encodedSignature), new TextEncoder().encode(encodedPayload),
    );
    return valid ? value.user : undefined;
  } catch {
    return undefined;
  }
}
