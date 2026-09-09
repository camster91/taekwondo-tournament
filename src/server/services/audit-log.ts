import type { PrismaClient } from '@prisma/client';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'role_change'
  | 'org_invite_sent'
  | 'org_invite_accepted'
  | 'org_member_added'
  | 'org_member_removed'
  | 'tournament_created'
  | 'tournament_deleted'
  | 'tournament_restored'
  | 'tournament_settings_updated'
  | 'bracket_generated'
  | 'match_scored'
  | 'user_status_changed';

export interface AuditLogOptions {
  userId: string;
  action: AuditAction;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  organizationId?: string;
  tournamentId?: string;
}

/**
 * Create a user audit log entry for security/compliance tracking (P1-3).
 * 
 * @param prisma - Prisma client instance
 * @param options - Audit log options
 * @returns Created audit log entry
 */
export async function createAuditLog(
  prisma: PrismaClient,
  options: AuditLogOptions
): Promise<void> {
  const {
    userId,
    action,
    details,
    ipAddress,
    userAgent,
    organizationId,
    tournamentId,
  } = options;

  await prisma.userAuditLog.create({
    data: {
      userId,
      action,
      details: details ? JSON.stringify(details) : null,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      organizationId: organizationId || null,
      tournamentId: tournamentId || null,
    },
  });
}

/**
 * Extract IP address from Express request.
 * Handles X-Forwarded-For header for reverse proxies.
 */
export function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }
  return req.socket.remoteAddress;
}

/**
 * Extract user agent from Express request.
 */
export function getUserAgent(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const ua = req.headers['user-agent'];
  return Array.isArray(ua) ? ua[0] : ua;
}
