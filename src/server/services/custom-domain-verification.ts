/**
 * Custom domain verification service
 * 
 * Handles DNS-based domain verification for custom domain attachment.
 * Supports TXT and CNAME verification methods.
 */

import { randomBytes } from 'crypto';
import * as dns from 'dns/promises';

/**
 * Generate a random verification token for DNS challenges
 */
export function generateVerificationToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Get the expected TXT record name and value for domain verification
 */
export function getTxtVerificationRecord(hostname: string, token: string): {
  name: string;
  value: string;
} {
  return {
    name: `_bowin-verify.${hostname}`,
    value: `bowin-domain-verification=${token}`,
  };
}

/**
 * Get the expected CNAME record for domain verification
 */
export function getCnameVerificationRecord(hostname: string, token: string): {
  name: string;
  target: string;
} {
  return {
    name: hostname,
    target: `verify-${token}.bowin.app`,
  };
}

/**
 * Verify domain ownership via TXT record
 * 
 * Checks for _bowin-verify.<hostname> TXT record containing the verification token.
 */
export async function verifyTxtRecord(
  hostname: string,
  expectedToken: string,
): Promise<{ verified: boolean; error?: string }> {
  try {
    const recordName = `_bowin-verify.${hostname}`;
    const txtRecords = await dns.resolveTxt(recordName);

    // TXT records come back as string[][] — flatten and check for our token
    for (const record of txtRecords) {
      const value = Array.isArray(record) ? record.join('') : record;
      if (value === `bowin-domain-verification=${expectedToken}`) {
        return { verified: true };
      }
    }

    return {
      verified: false,
      error: `TXT record not found or does not match. Expected: bowin-domain-verification=${expectedToken} at ${recordName}`,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA') {
        return {
          verified: false,
          error: `DNS record not found. Please add TXT record: _bowin-verify.${hostname} = bowin-domain-verification=${expectedToken}`,
        };
      }
    }
    return {
      verified: false,
      error: `DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Verify domain ownership via CNAME record
 * 
 * Checks that <hostname> CNAME points to verify-<token>.bowin.app
 */
export async function verifyCnameRecord(
  hostname: string,
  expectedToken: string,
): Promise<{ verified: boolean; error?: string }> {
  try {
    const cnames = await dns.resolveCname(hostname);

    const expectedTarget = `verify-${expectedToken}.bowin.app`;
    for (const cname of cnames) {
      // Strip trailing dot if present
      const normalizedCname = cname.endsWith('.') ? cname.slice(0, -1) : cname;
      if (normalizedCname === expectedTarget) {
        return { verified: true };
      }
    }

    return {
      verified: false,
      error: `CNAME record not found or does not match. Expected: ${hostname} CNAME ${expectedTarget}`,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA') {
        return {
          verified: false,
          error: `DNS record not found. Please add CNAME record: ${hostname} -> verify-${expectedToken}.bowin.app`,
        };
      }
    }
    return {
      verified: false,
      error: `DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Verify domain ownership using the configured verification method
 */
export async function verifyDomain(
  hostname: string,
  verificationMethod: 'txt' | 'cname',
  verificationToken: string,
): Promise<{ verified: boolean; error?: string }> {
  if (verificationMethod === 'txt') {
    return verifyTxtRecord(hostname, verificationToken);
  } else {
    return verifyCnameRecord(hostname, verificationToken);
  }
}

/**
 * Normalize hostname for storage (lowercase, no protocol, no trailing slash)
 */
export function normalizeHostname(input: string): string {
  let hostname = input.trim().toLowerCase();

  // Strip protocol if present
  hostname = hostname.replace(/^https?:\/\//, '');

  // Strip trailing slash
  hostname = hostname.replace(/\/$/, '');

  // Strip port if present (we only support standard HTTPS)
  hostname = hostname.replace(/:\d+$/, '');

  return hostname;
}

/**
 * Validate hostname format
 */
export function isValidHostname(hostname: string): boolean {
  // Must be a valid domain name
  const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
  if (!domainRegex.test(hostname)) {
    return false;
  }

  // Must have at least one dot (subdomain or TLD)
  if (!hostname.includes('.')) {
    return false;
  }

  // Must not be longer than 253 characters
  if (hostname.length > 253) {
    return false;
  }

  return true;
}

/**
 * Check if a hostname is owned by Bowin (to prevent abuse)
 */
export function isBowinOwnedDomain(hostname: string): boolean {
  const bowinDomains = [
    'bowin.app',
    'bowin.io',
    'bowin.com',
    'ashbi.ca',
    'localhost',
  ];

  for (const domain of bowinDomains) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return true;
    }
  }

  return false;
}
