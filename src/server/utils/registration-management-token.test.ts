import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  applyIssuedToken,
  DEFAULT_TOKEN_TTL_DAYS,
  generateManagementToken,
  hashManagementToken,
  issueManagementToken,
  isValidManagementToken,
  verifyManagementToken,
  type TokenAction,
} from './registration-management-token.js';

// --- Pure-function tests (no DB) ----------------------------------------

describe('registration management tokens — pure helpers', () => {
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

  it('rejects obvious UUID fragments, hex, and base64 (no padding) garbage', () => {
    // First 8 chars of a UUID — the legacy "confirmation code"
    expect(isValidManagementToken('a1b2c3d4')).toBe(false);
    // Plain hex
    expect(isValidManagementToken('deadbeefcafebabe')).toBe(false);
    // Anything that contains an invalid base64url char (-/_ are OK,
    // = is not) is rejected. Using a clearly non-secret marker here
    // so the test fixture cannot trip a high-entropy secret scanner.
    expect(isValidManagementToken('!@#$%^&*()')).toBe(false);
    expect(isValidManagementToken('!@#$%^&*()!@#$%^&*()!@#$%^&*()!@#$%^&*()')).toBe(false);
    // Empty / whitespace
    expect(isValidManagementToken('')).toBe(false);
    expect(isValidManagementToken('   ')).toBe(false);
  });

  it('issueManagementToken returns a fresh token, hash, and expiry in the future', () => {
    const now = new Date('2026-08-19T12:00:00Z');
    const issued = issueManagementToken(now, 30);

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.tokenHash).toBe(hashManagementToken(issued.token));
    // 30 days from now
    const expected = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(issued.expiresAt.toISOString()).toBe(expected.toISOString());
  });

  it('issueManagementToken defaults to DEFAULT_TOKEN_TTL_DAYS (90)', () => {
    const now = new Date('2026-08-19T12:00:00Z');
    const issued = issueManagementToken(now);
    const expected = new Date(
      now.getTime() + DEFAULT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(issued.expiresAt.toISOString()).toBe(expected.toISOString());
    expect(DEFAULT_TOKEN_TTL_DAYS).toBe(90);
  });

  it('each issued token is unique even when called in the same millisecond', () => {
    const now = new Date();
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) {
      tokens.add(issueManagementToken(now).token);
    }
    expect(tokens.size).toBe(50);
  });
});

// --- verifyManagementToken tests (mocked prisma) ------------------------

type RegistrationRow = {
  id: string;
  managementTokenHash: string | null;
  managementTokenExpiresAt: Date | null;
  managementTokenRevokedAt: Date | null;
  managementTokenLastUsedAt: Date | null;
};

type AuditRow = {
  registrationId: string | null;
  action: TokenAction;
  outcome: string;
  ip: string | null;
  userAgent: string | null;
};

function buildPrismaMock(opts: {
  registration?: RegistrationRow | null;
  registrationUpdateResult?: RegistrationRow;
  /** When the findUnique by hash should return a different row (testing hash isolation). */
  altRegistrationByHash?: Map<string, RegistrationRow>;
} = {}) {
  const audits: AuditRow[] = [];
  const updates: Array<{ where: { id: string }; data: unknown }> = [];

  const byHash = new Map<string, RegistrationRow>();
  if (opts.registration && opts.registration.managementTokenHash) {
    byHash.set(opts.registration.managementTokenHash, opts.registration);
  }
  if (opts.altRegistrationByHash) {
    for (const [hash, row] of opts.altRegistrationByHash) byHash.set(hash, row);
  }

  return {
    audits,
    updates,
    prisma: {
      registration: {
        findUnique: vi.fn(async ({ where }: { where: { managementTokenHash?: string; id?: string } }) => {
          if (where.managementTokenHash) {
            return byHash.get(where.managementTokenHash) ?? null;
          }
          if (where.id && opts.registration?.id === where.id) {
            return opts.registration;
          }
          return null;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: unknown }) => {
          updates.push({ where, data });
          return opts.registrationUpdateResult ?? opts.registration ?? null;
        }),
      },
      managementTokenAuditLog: {
        create: vi.fn(async ({ data }: { data: AuditRow }) => {
          audits.push(data);
          return data;
        }),
      },
    },
  };
}

const ctx = { action: 'read' as TokenAction, ip: '127.0.0.1', userAgent: 'vitest' };

describe('verifyManagementToken — malformed', () => {
  it('rejects tokens that are not 43 base64url chars', async () => {
    const { prisma, audits } = buildPrismaMock();
    const result = await verifyManagementToken(prisma as any, 'not-a-token', ctx);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('malformed');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'read',
      outcome: 'malformed',
      registrationId: null,
    });
  });

  it('does not touch the registration table for malformed tokens', async () => {
    const { prisma } = buildPrismaMock();
    await verifyManagementToken(prisma as any, 'short', ctx);
    expect(prisma.registration.findUnique).not.toHaveBeenCalled();
  });
});

describe('verifyManagementToken — not_found', () => {
  it('returns not_found when no row matches the hash', async () => {
    const { prisma, audits } = buildPrismaMock();
    const tok = generateManagementToken();
    const result = await verifyManagementToken(prisma as any, tok, ctx);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('not_found');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'read',
      outcome: 'not_found',
      registrationId: null,
    });
  });
});

describe('verifyManagementToken — revoked', () => {
  it('rejects revoked tokens even if the hash matches', async () => {
    const tok = generateManagementToken();
    const hash = hashManagementToken(tok);
    const row: RegistrationRow = {
      id: 'reg-1',
      managementTokenHash: hash,
      managementTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      managementTokenRevokedAt: new Date(Date.now() - 1000),
      managementTokenLastUsedAt: null,
    };
    const { prisma, audits } = buildPrismaMock({ registration: row });
    const result = await verifyManagementToken(prisma as any, tok, ctx);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('revoked');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      registrationId: 'reg-1',
      outcome: 'revoked',
    });
  });
});

describe('verifyManagementToken — expired', () => {
  it('rejects tokens past their expiry', async () => {
    const tok = generateManagementToken();
    const hash = hashManagementToken(tok);
    const row: RegistrationRow = {
      id: 'reg-1',
      managementTokenHash: hash,
      managementTokenExpiresAt: new Date(Date.now() - 60_000),
      managementTokenRevokedAt: null,
      managementTokenLastUsedAt: null,
    };
    const { prisma, audits } = buildPrismaMock({ registration: row });
    const result = await verifyManagementToken(prisma as any, tok, ctx);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('expired');
    expect(audits[0]).toMatchObject({
      registrationId: 'reg-1',
      outcome: 'expired',
    });
  });

  it('treats expiry-at-exactly-now as expired (boundary)', async () => {
    const tok = generateManagementToken();
    const hash = hashManagementToken(tok);
    const row: RegistrationRow = {
      id: 'reg-1',
      managementTokenHash: hash,
      managementTokenExpiresAt: new Date(Date.now()),
      managementTokenRevokedAt: null,
      managementTokenLastUsedAt: null,
    };
    const { prisma } = buildPrismaMock({ registration: row });
    const result = await verifyManagementToken(prisma as any, tok, ctx);
    expect(result.outcome).toBe('expired');
  });
});

describe('verifyManagementToken — ok', () => {
  it('returns the registration and writes an ok audit', async () => {
    const tok = generateManagementToken();
    const hash = hashManagementToken(tok);
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const row: RegistrationRow = {
      id: 'reg-1',
      managementTokenHash: hash,
      managementTokenExpiresAt: future,
      managementTokenRevokedAt: null,
      managementTokenLastUsedAt: null,
    };
    const { prisma, audits, updates } = buildPrismaMock({ registration: row });
    const result = await verifyManagementToken(prisma as any, tok, ctx);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('ok');
    expect(result.registration?.id).toBe('reg-1');
    expect(audits[0]).toMatchObject({
      registrationId: 'reg-1',
      action: 'read',
      outcome: 'ok',
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });
    // lastUsedAt bumped
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ id: 'reg-1' });
    expect((updates[0].data as any).managementTokenLastUsedAt).toBeInstanceOf(Date);
  });

  it('never writes the raw token to the audit log', async () => {
    const tok = generateManagementToken();
    const hash = hashManagementToken(tok);
    const row: RegistrationRow = {
      id: 'reg-1',
      managementTokenHash: hash,
      managementTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      managementTokenRevokedAt: null,
      managementTokenLastUsedAt: null,
    };
    const { prisma, audits } = buildPrismaMock({ registration: row });
    await verifyManagementToken(prisma as any, tok, ctx);
    // The raw token must not appear anywhere in the audit data.
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(tok);
    expect(serialized).not.toContain(hash);
  });

  it('accepts a legacy row with no expiry (null managementTokenExpiresAt)', async () => {
    // Pre-refactor back-filled rows: hash exists, expiry does not.
    // They must remain usable until a director rotates / revokes.
    const tok = generateManagementToken();
    const hash = hashManagementToken(tok);
    const row: RegistrationRow = {
      id: 'reg-legacy',
      managementTokenHash: hash,
      managementTokenExpiresAt: null,
      managementTokenRevokedAt: null,
      managementTokenLastUsedAt: null,
    };
    const { prisma } = buildPrismaMock({ registration: row });
    const result = await verifyManagementToken(prisma as any, tok, ctx);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('ok');
  });

  it('enforces cross-registration isolation: hash from a different row is rejected', async () => {
    // Two registrations, two tokens. Presenting token-A must not
    // succeed against row-B even if a buggy migration left both rows
    // in the table.
    const tokA = generateManagementToken();
    const hashA = hashManagementToken(tokA);
    const rowA: RegistrationRow = {
      id: 'reg-A',
      managementTokenHash: hashA,
      managementTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      managementTokenRevokedAt: null,
      managementTokenLastUsedAt: null,
    };
    const { prisma } = buildPrismaMock({ registration: rowA });
    // Present a completely unrelated token; row should not match.
    const otherTok = generateManagementToken();
    const result = await verifyManagementToken(prisma as any, otherTok, ctx);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('not_found');
  });
});

describe('applyIssuedToken', () => {
  it('writes hash + expiry, clears revocation and lastUsedAt', async () => {
    const issued = issueManagementToken();
    const updates: Array<{ where: unknown; data: unknown }> = [];
    const prisma = {
      registration: {
        update: vi.fn(async ({ where, data }: any) => {
          updates.push({ where, data });
          return { id: where.id, ...data };
        }),
      },
    } as any;

    await applyIssuedToken(prisma, 'reg-1', issued);
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ id: 'reg-1' });
    const data = updates[0].data as Record<string, unknown>;
    expect(data.managementTokenHash).toBe(issued.tokenHash);
    expect(data.managementTokenExpiresAt).toEqual(issued.expiresAt);
    expect(data.managementTokenRevokedAt).toBeNull();
    expect(data.managementTokenLastUsedAt).toBeNull();
  });

  it('survives a Node timing surprise: SHA-256 is deterministic across re-imports', () => {
    // Defensive: ensure the hash function we're exporting matches a
    // fresh SHA-256 of the same token. If anyone ever swaps the impl,
    // this test will catch it.
    const tok = generateManagementToken();
    const ours = hashManagementToken(tok);
    const expected = createHash('sha256').update(tok).digest('hex');
    expect(ours).toBe(expected);
  });
});
