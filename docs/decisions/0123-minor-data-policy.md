# Decision 0123: Minor-data consent, display, retention, and deletion policy

> GitHub: camster91/taekwondo-tournament#123
> Status: Accepted (pending legal counsel sign-off per #167 before pilot).
> Date: 2026-09-10

## Context

TKD tournaments involve minors. The product must comply with COPPA (US), GDPR-K (EU), PIPEDA (CA), and equivalent regional regulations on children's data.

## Decision

**Collect only the data required for the tournament. Display public data only with explicit consent. Retain for 2 years post-event, then archive. Delete on request within 30 days.**

| Data class | Examples | Consent | Display | Retention | Deletion |
|---|---|---|---|---|---|
| Required for tournament | name, DOB, belt rank, weight, division | Implied by registration | Hidden (used internally for bracket generation) | 2 years post-event | 30 days on request |
| Optional for marketing | email | Explicit opt-in | Never public | Until unsubscribe + 30 days | Immediate on unsubscribe |
| Public for the event | first name, last name (as on entry), division, matches played | Explicit on entry | Visible on the public bracket during the event | 90 days post-event | 30 days on request |
| Operational | audit log of bracket changes, score events | n/a (operational) | Never public | 2 years | Aggregated only after 2 years |

## Trade-offs

- Less data for analytics. We cannot run cross-tenant analytics on minor data.
- Higher operational overhead: per-tenant deletion request handling, 30-day SLA, consent flow in the registration UI.
- A consent step in the public registration flow is required. Adds 1 step to the registration UX.

## Rationale

COPPA and GDPR-K are the binding regulations. The 2-year retention matches the typical statute-of-limitations window for sports disputes. The 30-day deletion SLA is the GDPR standard.

## Implications

- The public registration flow (`src/server/routes/public.ts:320-585`, `public-portal.ts:441-600`) needs an explicit consent step before submit.
- A "delete my data" endpoint is required (admin- or self-service, depending on the legal review).
- A privacy policy must be published and linked from the registration page, the login page, and the marketing site.
- The audit log must be retained per the table above, but entries containing minor PII must be redacted on deletion.

## Action items

- [ ] Legal counsel sign-off on the privacy policy and the terms of service (Cameron, #167).
- [ ] Public registration consent step (UI + server validation).
- [ ] `DELETE /api/me` endpoint (self-service) OR admin tool to delete by user id.
- [ ] Privacy policy published at `bowin.app/privacy` and linked from the relevant pages.
- [ ] Retention job: 2-year auto-archive, 30-day post-deletion SLA.

## Related

- #121 (privacy controls implementation)
- #167 (legal sign-off)
- Decision 0122 (tenancy model)
