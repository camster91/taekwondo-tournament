# Deployment readiness report: Bowin

**Date:** 2026-08-07

**Stack:** React/Vite SPA, Express/Node API, Prisma, PostgreSQL 16, Docker/Coolify

**Decision:** **Do not deploy publicly yet.** The repository is a controlled-pilot release candidate; external production evidence is incomplete.

## Verified pass

- Security regressions, tenant boundaries, signed management links, consent capture, atomic scoring, offline queues, accessibility workflows, and plan enforcement have automated coverage.
- 473 unit/integration tests and all 120 browser workflows pass across Chromium, Firefox, and WebKit.
- Account self-deletion and owner-controlled organization export/permanent deletion are implemented with recent-authentication, membership, billing-state, and exact-confirmation safeguards and verified through API and browser workflows.
- Responsive automation covers 375, 768, 1024, 1440, and 1920 pixel widths and a 44-pixel mobile touch-target baseline. Physical-device and assistive-technology checks remain open.
- Type checks, lint, production build, Prisma validation, `npm audit`, and nine migrations from an empty PostgreSQL 16 database pass.
- The image runs as a non-root user and now includes database-aware health, read-only filesystem, temporary filesystem, dropped capabilities, no-new-privileges, graceful shutdown, and bounded Docker logs.
- Production startup fails closed for core database, authentication, URL, CORS, email, and legal-consent configuration.
- API responses carry correlation IDs, error logs include them, and a bearer-protected Prometheus-compatible HTTP metrics endpoint is available for an external collector.
- Production deployment is manual and targets a named GitHub environment; required reviewers must still be configured in repository settings. The workflow polls readiness after Coolify accepts a deployment.
- A release/rollback runbook and evidence record are checked in.

## Launch blockers requiring external evidence

1. Replace the current self-signed certificate and verify trusted HTTPS plus renewal from desktop and mobile networks.
2. Provision isolated staging and production PostgreSQL services; enable encrypted backups and complete a timestamped restore drill.
3. Verify Mailgun domain ownership, SPF, DKIM, DMARC, delivery, bounce, complaint, and suppression handling.
4. Connect the private metrics endpoint to an external collector, configure a readiness monitor, centralized error tracking/log retention, alert thresholds, and a named on-call recipient; fire test alerts.
5. Reconcile the repository license/owner/year and obtain operator/counsel approval for privacy, terms, organizer agreement, guardian consent/waiver, retention, subprocessors, and incident process.
6. Complete current Chrome, Edge, Firefox, iOS Safari, Android Chrome, venue-TV, NVDA/VoiceOver, responsive, and throttled performance checks with screenshots.
7. Repeat capacity and complete workflow-load testing on isolated staging. The local production image sustained 50 concurrent readiness clients for 20 seconds at about 1,317 requests/second, 37.45 ms average, 67 ms p99, and 207 ms maximum across 26,000 requests; this is a baseline, not venue-workflow proof.
8. Verify Stripe in test mode end-to-end, or formally choose managed invoicing and hide self-service billing for the pilot. Tax, refund, dunning, and cancellation policy must be approved.
9. Conduct network-loss, duplicate-submit, result-correction, link-revocation, device-replacement, backup/restore, and printed-fallback rehearsals.
10. Obtain rules acceptance, run one fabricated-data rehearsal, then obtain written consent for a supervised customer pilot.

## Intentionally skipped or deferred

- Public marketing SEO, analytics, ad pixels, and heatmaps are not pilot blockers for the authenticated operations product; add them only after privacy approval and a defined acquisition funnel.
- Federation certification, native apps, athlete rankings, livestreaming, and fully unattended/offline operation are outside the verified product promise.
- No live deployment, DNS, account, payment, email, or secret changes were made by this report.

## Market judgment

Bowin is technically credible for a tightly supervised Taekwondo pilot and meaningfully differentiated by tournament-day workflows, corrections, public displays, and connection-loss-safe queues. It is not yet credible as an unattended general-availability SaaS because operational proof, legal approval, billing operations, production infrastructure, and real-event evidence remain open. Expansion should follow three successful supervised events with no unrecoverable scoring, bracket, privacy, or availability incident.
