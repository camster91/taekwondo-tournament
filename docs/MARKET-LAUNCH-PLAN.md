# Bowin market-launch plan

**Status:** controlled-pilot candidate; not cleared for public self-service launch

**Initial customer:** an independent Taekwondo school running a supervised local event

**Initial event envelope:** 50–300 competitors, 1–6 rings, sparring and patterns, one named event director, and Bowin-assisted setup/support

This document is the authoritative launch gate. A checkbox is not evidence: every gate needs the artifact or observation named in the Evidence column. Unknown external facts remain open until verified in the target environment.

## Product promise

Bowin replaces the spreadsheet-and-paper workflow for small Taekwondo tournaments with one operational system for registration, roster import, categorization, brackets, schedules, check-in, scoring, public displays, and results.

Other martial-art profiles are experimental. Do not advertise federation certification, complete offline operation, payment collection, athlete rankings, native mobile applications, livestreaming, or unattended self-service SaaS until those capabilities exist and are verified.

## Launch gates

| Gate | Pass condition | Evidence | Current state |
|---|---|---|---|
| Release candidate | Type checks, lint, unit/integration tests, browser workflows, production build, Prisma validation, clean migrations, and production-container readiness pass on the release commit | Immutable commit SHA and retained command/check output | Current worktree: 473 unit/integration tests and all 120 browser workflows pass across Chromium, Firefox, and WebKit. Type checks, lint, build, schema validation, and all 9 migrations passed from a clean PostgreSQL 16 database. A pinned Node 22 image also applied migrations and passed database readiness as non-root with a read-only filesystem and dropped capabilities. Remote CI remains unavailable while repository Actions are disabled |
| Tenant and child-data security | Cross-tenant authorization, public-link revocation, parent management tokens, authentication invalidation, rate limits, and production secret checks pass | Automated regressions plus staging security smoke test | Automated coverage passes; staging test open |
| Rules acceptance | Named tournament director approves the exact age, belt, weight, gender, event, bracket, bye, seeding, and placement behavior | Signed rules acceptance record tied to a configuration export | Open |
| Trusted HTTPS | Public certificate validates without bypass from desktop and mobile networks; HTTP redirects to HTTPS | TLS report and browser screenshots | Fail: current `tkd.ashbi.ca` serves a self-signed certificate |
| Production database | Private PostgreSQL 16 with least-privilege credentials, encrypted automated backups, retention, access logging, and successful restore drill | Provider configuration plus timestamped restore record | Open |
| Email | Verified sending domain; SPF, DKIM, and DMARC configured; sign-in and registration-management messages deliver; bounce/complaint/suppression handling tested | DNS report, message IDs, and delivery-event screenshots | Open |
| Observability | External readiness monitor, error tracking, log retention, and alerts for 5xx, database, email, migration, and abnormal auth/registration traffic | Test alerts received by named on-call contact | Request correlation and an authenticated Prometheus-compatible HTTP metrics endpoint are implemented and tested. External collection, centralized error tracking/log retention, alert rules, and test notifications to a named on-call contact remain open |
| Legal and consent | Legal operator, support contact, terms, privacy notice, organizer agreement, guardian consent/waiver, retention schedule, subprocessors, and incident process approved for the launch jurisdiction | Published versioned documents approved by qualified counsel/operator | Product now records versioned privacy/rules acceptance and guardian authority; operator/counsel drafts exist, but approval/publication remains open |
| Software licensing | Legal operator selects the distribution license and reconciles `LICENSE`, `package.json`, and the README with the correct owner and year | Operator decision plus matching repository metadata | Pass: proprietary copyright 2026 Cameron Ashley; package metadata is `UNLICENSED`; third-party inventory retained |
| Venue recovery | Operators complete network-loss, duplicate-submit, result-correction, public-link revocation, device replacement, and printed fallback exercises | Rehearsal log with pass/fail and remediation | Open |
| Cross-device UX | Current Chrome, Edge, Firefox, iOS Safari, Android Chrome, and venue TV pass the critical workflow matrix | Device/browser matrix with screenshots and issue links | Chromium, Firefox, and WebKit automation plus 375/768/1024/1440/1920 px responsive checks pass; physical iOS/Android, venue-TV, NVDA, and VoiceOver checks remain open |
| Capacity | Production-like environment sustains the accepted event envelope with measured latency/error thresholds | Repeatable load-test report | Local production image baseline: 50 concurrent readiness clients for 20 seconds, about 1,317 requests/second, 37.45 ms average, 67 ms p99, and 207 ms max across 26,000 requests. Production-shaped staging workflow load remains open |
| Support | Named on-call owner, escalation channel, response targets, maintenance window, incident template, and customer handoff are accepted | Pilot support plan and contact verification | Open |
| Pilot | Fabricated-data rehearsal passes, followed by one expressly consented supervised customer event with no unrecoverable tournament-state incident | Pilot sign-off and retrospective | Open |
| Billing | Managed pilot has an accepted quote/invoice/refund process; self-service launch additionally requires checkout, webhooks, entitlements, taxes, dunning, cancellation, and billing portal | Transaction sandbox tests and server-side entitlement tests | Responsive organization onboarding, usage/plan UI, server-side limits, owner checkout/portal endpoints, signed idempotent Stripe subscription webhooks, and audit history are implemented; real Stripe sandbox, tax, dunning, cancellation, and managed invoicing verification remain open |

## Release sequence

1. Freeze the candidate commit and enable required repository checks.
2. Provision an isolated staging application and PostgreSQL database.
3. Configure trusted TLS, production-shaped secrets, email, monitoring, logs, and backups.
4. Restore representative non-sensitive data into staging and run migrations.
5. Execute security, workflow, accessibility, cross-browser, mobile, TV, recovery, and capacity checks.
6. Run a complete fabricated tournament rehearsal and close every severity-one or severity-two issue.
7. Obtain legal/operator approval and written consent for a limited customer pilot.
8. Back up production, deploy the exact tested image, require readiness before traffic, and retain the prior image and database snapshot.
9. Staff the pilot, record operational evidence, and complete a retrospective before expanding availability.

## Rollback decision

Rollback immediately if readiness fails, migrations fail, authentication or tenant boundaries malfunction, scoring cannot advance consistently, queued offline operations cannot reconcile safely, public links cannot be revoked, or error rates threaten tournament continuity. Application rollback redeploys the prior immutable image. Database rollback is restore-based and must preserve a snapshot of the failed state before restoration.

## General-availability decision

General availability remains **NO-GO** until all launch gates above pass and at least three supervised events complete without an unrecoverable scoring, bracket, privacy, or availability incident. Account self-deletion and owner-controlled organization export/deletion are now implemented and browser-verified for eligible free accounts. Paid self-service additionally remains NO-GO until Stripe provider operations, cancellation, tax/refund/dunning policy, and paid-customer deletion behavior are verified end to end.
