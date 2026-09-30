# Staff Invitation Recovery Guide

Operational guide for the staff invitation lifecycle (issue #46): what each
state means, how failures show up, and how to recover.

Code: `src/server/routes/invites.ts`, `POST /api/auth/accept-invite` in
`src/server/routes/auth.ts`, rules in `src/server/services/invitation-lifecycle.ts`.

## States

`Invitation.status`:

| Status | Meaning |
|--------|---------|
| `pending` | Sent (or at least created), waiting for acceptance |
| `accepted` | An account was created from it; the link is spent |
| `expired` | 72 hours passed since the last send/resend |
| `cancelled` | An admin cancelled it; `cancelledAt` records when |

```
pending → accepted    (invitee accepts; exactly once)
pending → expired     (72 h TTL; marked when the list is loaded)
pending → cancelled   (admin cancels; the row is kept)
expired → pending     (admin resends; new token, new 72 h)
```

Accepted and cancelled invitations cannot be resent (409). Send a new
invitation instead.

`Invitation.deliveryStatus` records the outcome of the **last** send or
resend, with `lastSentAt` and `lastDeliveryError`:

| deliveryStatus | Meaning |
|----------------|---------|
| `sent` | Mailgun accepted the message |
| `failed` | Mailgun rejected it or was unreachable; see `lastDeliveryError` |
| `not_configured` | No Mailgun credentials; nothing was emailed |
| (null) | Created before this column existed |

User Management shows this under **Sent** for every pending invitation.

## What the invitee sees

`GET /api/invites/verify/:token` and `POST /api/auth/accept-invite` answer
a dead link with **410 Gone**, a `code`, and a plain explanation that the
accept page shows:

| code | Message |
|------|---------|
| `accepted` | This invitation has already been used. Sign in instead. |
| `cancelled` | This invitation was cancelled. Ask an administrator for a new one. |
| `expired` | This invitation has expired. Ask an administrator to resend it. |

An unknown token is 404 (verify) / 400 (accept). Resend rotates the token,
so a link from an earlier email becomes unknown.

Acceptance claims the invitation with a conditional update inside the
account-creation transaction. Two simultaneous submits or a replayed request
create one account; the loser gets 409 (or 410 once the first commit is
visible).

## Duplicate emails

Checks are case-insensitive and deterministic:

- `POST /api/invites/send` → 409 when any account exists for the email
  (active **or deactivated**) or a pending invitation exists.
- `POST /api/invites/resend/:id` → 409 when an account now exists for it.
- `POST /api/auth/accept-invite` → 409 when an account exists; a race on
  the unique email constraint is also answered 409.

A deactivated user is reactivated from User Management, never re-invited.

## Recovery

### Delivery failed or email not configured

Symptom: the invite row shows "Delivery failed: …" or "Not emailed: email
is not configured".

1. Fix the cause. `lastDeliveryError` carries the Mailgun response (for
   example `Mailgun error: 401` → wrong `MAILGUN_API_KEY`; a 4xx naming the
   domain → `MAILGUN_DOMAIN` not verified).
2. Click **Resend** on the row (or `POST /api/invites/resend/{id}`). The row
   switches to "Email sent" when Mailgun accepts it.

After a Mailgun key rotation, filter the invitation list for rows whose
delivery failed and resend each.

### Expired link

Resend it. The expired row returns to `pending` with a new 72-hour token;
the old link stays dead.

### Wrong email or role

Cancel the pending invitation and send a new one. Cancelled, expired and
accepted rows can be removed from the list with the bin icon (hard delete).

### Accepted but cannot sign in

- `isActive = false`: reactivate from User Management.
- After a role change or deactivation the old session is revoked by design
  (`tokenVersion` bump); the user signs in again with a magic link.

## Access revocation

Role change, deactivation and logout bump `User.tokenVersion`. The next
authenticated request with an older session is refused with 401 (the auth
cache is invalidated in the same process; other containers catch up within
the ~15 s cache TTL).

## Tests

- `src/server/routes/invites-lifecycle.test.ts`: route matrix with mocks
  (send, delivery status, duplicates, resend, cancel, verify, accept, replay race).
- `src/server/services/invitation-lifecycle.test.ts`: token-state and
  delivery-status rules.
- `tests/e2e/invitation-lifecycle.spec.ts`: the full lifecycle against a
  real server and database. It covers create, duplicate, accept with the
  invited role, replay, cancel, expiry, resend and role-change revocation,
  plus the accept page's cancelled message.

## Still needs an operator (issue #46)

Code cannot verify these:

1. Real delivery to a test inbox from the production Mailgun domain,
   including SPF/DKIM alignment.
2. Running the lifecycle matrix above against staging with Mailgun
   configured, and recording the evidence on the issue.
