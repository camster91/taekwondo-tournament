import { createHash, randomBytes } from 'node:crypto';

const MANAGEMENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateManagementToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashManagementToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isValidManagementToken(token: string): boolean {
  return MANAGEMENT_TOKEN_PATTERN.test(token);
}
