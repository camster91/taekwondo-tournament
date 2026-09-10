# Staff Invitation Recovery Guide

## Overview

This document provides operational guidance for recovering from staff invitation failures and managing the invitation lifecycle. Written for issue #46 (invitation lifecycle verification).

## Invitation States

### Valid States
- **pending** — Invitation sent, awaiting acceptance
- **accepted** — User created account via invitation
- **expired** — Token expired (72-hour TTL from creation/resend)

### State Transitions
```
pending → accepted    (user accepts invite)
pending → expired     (automatic after 72h or manual expiry check)
expired → pending     (admin resends invite, generates new token)
```

## Common Failure Scenarios

### 1. Email Delivery Failure (Mailgun Down)

**Symptom:** Admin sends invitation, user never receives email.

**Detection:**
- Check invitation response: `emailSent: false` indicates delivery failure
- Server logs: `[Email not configured] To: user@example.com` (dev mode) or Mailgun API error (production)

**Recovery:**
```bash
# Option A: Resend via UI
# Navigate to User Management → Invitations → click Resend button

# Option B: Direct API call (requires admin auth)
curl -X POST https://your-domain.com/api/invites/resend/{invitation-id} \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Prevention:**
- Monitor Mailgun dashboard for delivery failures
- Set up Mailgun webhook alerts for bounces
- Test email delivery after Mailgun configuration changes

### 2. Expired Invitation Token

**Symptom:** User clicks invite link, sees "Invitation has expired" error.

**Detection:**
- Token expiry check happens at both `/invites/verify/:token` and `/auth/accept-invite`
- The system automatically marks pending invitations as expired when listing

**Recovery:**
```bash
# Admin resends invitation (generates new 72h token)
POST /api/invites/resend/{invitation-id}
```

**Notes:**
- Resending an expired invitation resets the token and extends expiry by 72h
- Old token is invalidated immediately
- Email is sent with the new token

### 3. Duplicate Email Conflict

**Symptom:** Admin tries to invite `user@example.com`, receives 409 error.

**Cause:** Either a user account or a pending invitation already exists for that email.

**Detection:**
```bash
# Check for existing user
SELECT id, email, role, "isActive" FROM "User" WHERE LOWER(email) = 'user@example.com';

# Check for pending invitation
SELECT id, email, status, "tokenExpiry" FROM "Invitation" 
WHERE LOWER(email) = 'user@example.com' AND status = 'pending';
```

**Recovery:**

**Case A: User exists and is active**
```
→ No recovery needed. User can sign in with magic link.
→ Admin can change role via User Management page if needed.
```

**Case B: User exists but is deactivated**
```bash
# Reactivate user (requires admin access to database)
UPDATE "User" SET "isActive" = true, "tokenVersion" = "tokenVersion" + 1 
WHERE email = 'user@example.com';
```

**Case C: Pending invitation exists**
```
→ Admin can resend the existing invitation (refreshes token)
→ Or cancel the old invitation and send a new one
```

**Case D: Expired invitation exists**
```bash
# Option 1: Resend expired invitation
POST /api/invites/resend/{invitation-id}

# Option 2: Delete expired invitation and create new one
DELETE /api/invites/{invitation-id}
POST /api/invites/send
```

### 4. User Accepts Invitation but Cannot Login

**Symptom:** User accepts invitation successfully but receives 401 on subsequent login attempts.

**Possible Causes:**
1. Account was deactivated after invitation acceptance
2. JWT token expired (cookie/localStorage)
3. `tokenVersion` mismatch (admin changed role after acceptance)

**Detection:**
```bash
# Check user account status
SELECT id, email, role, "isActive", "tokenVersion", "lastLogin" 
FROM "User" 
WHERE email = 'user@example.com';
```

**Recovery:**

**If `isActive = false`:**
```bash
UPDATE "User" SET "isActive" = true WHERE email = 'user@example.com';
```

**If token expired:**
```
→ User should request a new magic link via /login page
→ No admin action required
```

**If tokenVersion mismatch:**
```
→ This is expected behavior after role change
→ User must sign in again (session cookie invalidated)
→ No recovery needed; by design
```

### 5. Mailgun API Key Rotation

**Symptom:** All invitation emails fail after Mailgun key rotation.

**Detection:**
- All `/api/invites/send` calls return `emailSent: false`
- Server logs: `Mailgun API error: 401 - Unauthorized`

**Recovery:**
```bash
# Update MAILGUN_API_KEY in environment
# Restart server to pick up new key

# For pending invitations sent with old key, resend each:
GET /api/invites  # List all pending invitations
POST /api/invites/resend/{id}  # Resend each one
```

### 6. Invitation Token Brute Force (Rate Limit Hit)

**Symptom:** Valid invitation token returns 429 Too Many Requests on `/invites/verify/:token`.

**Detection:**
- HTTP 429 response
- `x-ratelimit-remaining: 0` header

**Recovery:**
```
→ Wait 1 minute (rate limit window)
→ Or use different IP/browser if testing
→ Production: investigate suspicious activity (potential attack)
```

**Notes:**
- Rate limit: 30 requests per minute per IP (configurable via `inviteVerifyLimiter`)
- Token is 32-byte hex (256 bits) — brute force is computationally infeasible
- Rate limit exists to slow enumeration attacks

## Operational Commands

### List All Pending Invitations
```bash
GET /api/invites
```

Returns:
```json
[
  {
    "id": "inv-abc123",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "director",
    "status": "pending",
    "createdAt": "2026-09-10T10:00:00Z",
    "tokenExpiry": "2026-09-13T10:00:00Z"
  }
]
```

### Cancel Invitation
```bash
DELETE /api/invites/{invitation-id}
```

**Use cases:**
- User no longer needs access
- Wrong email/role was used
- Duplicate invitation sent by mistake

### Verify Invitation Token (Public)
```bash
GET /api/invites/verify/{token}
```

Returns:
```json
{
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "director"
}
```

**Note:** This endpoint is public (no auth) but rate-limited to 30/min per IP.

### Bulk Invitation Workflow

For inviting multiple staff members:

1. Create invitations via API (one per email)
2. Check `emailSent` in each response
3. For any failures (`emailSent: false`), resend after Mailgun issue resolved
4. Monitor invitation list for pending/expired states
5. After 24-48h, resend to users who haven't accepted (reminder)

## Database Schema Reference

### Invitation Table
```sql
CREATE TABLE "Invitation" (
  id UUID PRIMARY KEY,
  email VARCHAR NOT NULL,
  "firstName" VARCHAR NOT NULL,
  "lastName" VARCHAR NOT NULL,
  role VARCHAR NOT NULL,  -- director, scorekeeper, viewer, admin
  "organizationId" UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  token VARCHAR UNIQUE NOT NULL,  -- SHA-256 hashed
  status VARCHAR DEFAULT 'pending',  -- pending, accepted, expired
  "expiresAt" TIMESTAMP NOT NULL,  -- 72h from creation/resend
  "acceptedAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON "Invitation"(email);
CREATE INDEX ON "Invitation"(token);
CREATE INDEX ON "Invitation"(status);
CREATE INDEX ON "Invitation"("organizationId");
```

### User Table (relevant fields)
```sql
CREATE TABLE "User" (
  id UUID PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  "firstName" VARCHAR NOT NULL,
  "lastName" VARCHAR NOT NULL,
  role VARCHAR DEFAULT 'viewer',
  "tokenVersion" INT DEFAULT 0,  -- Bumped on role change / deactivation
  "isActive" BOOLEAN DEFAULT TRUE,
  "lastLogin" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);
```

## Security Notes

### Token Storage
- Invitation tokens are stored as SHA-256 hashes in the database
- Raw tokens are sent via email and never logged/stored server-side
- Token generation uses `crypto.randomBytes(32)` (256-bit entropy)

### Email Enumeration Protection
- Case-insensitive email matching on both User and Invitation tables
- 409 error for duplicate emails (does not reveal whether user or invitation exists)
- Public `/invites/verify/:token` endpoint rate-limited to slow enumeration

### Session Management
- After accepting invitation, user receives session cookie + JWT
- Token version embedded in JWT for invalidation
- Role changes and deactivation bump `tokenVersion` to invalidate old sessions

## Monitoring and Alerts

### Key Metrics to Track
1. **Invitation send rate** — spikes may indicate abuse or legitimate bulk invites
2. **Email delivery failure rate** — should be < 1% in normal operation
3. **Expired invitation count** — high count suggests user onboarding friction
4. **Accept-to-invite ratio** — low ratio may indicate email deliverability issues
5. **Rate limit hits** — repeated 429s on verify endpoint = potential attack

### Recommended Alerts
- Email delivery failure rate > 5% for 10+ minutes → Mailgun issue
- Pending invitations > 50 and growing → investigate bulk invite legitimacy
- Rate limit hits on `/invites/verify/:token` > 100/hour → potential brute force

## Testing Without Mailgun

The test suite (`invites-lifecycle.test.ts`) runs without Mailgun credentials:

```bash
npm test -- invites-lifecycle.test.ts
```

**Coverage:**
- Invitation creation with duplicate detection
- Token generation and hashing
- Expiry handling
- Resend with token refresh
- Acceptance with user creation
- Role-based access control
- Rate limiting (middleware presence)

**Not covered (leftover for Cameron):**
- Live Mailgun delivery
- Email template rendering in real Mailgun context
- Bounce/spam handling via Mailgun webhooks
- SPF/DKIM validation

## Leftover Tasks for Production

See issue #46 for full scope. The following are deferred:

1. **Live Mailgun Verification**
   - Send test invitation to real email
   - Verify email arrives within 30s
   - Check SPF/DKIM headers pass
   - Test bounce/spam handling

2. **Email Template Audit**
   - Render invitation email in multiple clients (Gmail, Outlook, Apple Mail)
   - Verify mobile responsiveness
   - Check links open correctly (iOS, Android)

3. **Monitoring Dashboard**
   - Add invitation metrics to admin dashboard
   - Alert on email delivery failures
   - Track accept-to-invite conversion rate

4. **SSO Integration** (future, not in #46 scope)
   - Google Workspace SSO
   - Microsoft Entra ID
   - SAML 2.0 generic

5. **Bulk Invitation UI** (future)
   - CSV upload for multiple invitations
   - Progress indicator
   - Retry failed deliveries

## References

- Issue: #46
- Code: `src/server/routes/invites.ts`, `src/server/routes/auth.ts`
- Tests: `src/server/routes/invites-lifecycle.test.ts`
- Email service: `src/server/services/email.ts`
- Templates: `src/server/services/email-templates.ts`
