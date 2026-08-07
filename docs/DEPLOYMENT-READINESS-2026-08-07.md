# Deployment readiness report: Bowin

**Date:** 2026-08-07

**Stack:** React/Vite SPA, Express/Node API, Prisma, PostgreSQL 16, Docker/Coolify

**Decision:** **Do not deploy publicly yet.** The repository is a controlled-pilot release candidate; external production evidence is incomplete.

## Verified pass

- Security regressions, tenant boundaries, signed management links, consent capture, atomic scoring, offline queues, accessibility workflows, and plan enforcement have automated coverage.
- 468 unit/integration tests and 30 Chromium browser workflows pass, including responsive organization onboarding and billing-plan presentation.
- Type checks, lint, production build, Prisma validation, `npm audit`, and nine migrations from an empty PostgreSQL 16 database pass.
- The image runs as a non-root user and now includes database-aware health, read-only filesystem, temporary filesystem, dropped capabilities, no-new-privileges, graceful shutdown, and bounded Docker logs.
- Production startup fails closed for core database, authentication, URL, CORS, email, and legal-consent configuration.
- Production deployment is manual and targets a named GitHub environment; required reviewers must still be configured in repository settings. The workflow polls readiness after Coolify accepts a deployment.
- A release/rollback runbook and evidence record are checked in.

## Launch blockers requiring external evidence

1. Replace the current self-signed certificate and verify trusted HTTPS plus renewal from desktop and mobile networks.
2. Provision isolated staging and production PostgreSQL services; enable encrypted backups and complete a timestamped restore drill.
3. Verify Mailgun domain ownership, SPF, DKIM, DMARC, delivery, bounce, complaint, and suppression handling.
4. Configure an external readiness monitor, centralized error tracking/log retention, alert thresholds, and a named on-call recipient; fire test alerts.
5. Reconcile the repository license/owner/year and obtain operator/counsel approval for privacy, terms, organizer agreement, guardian consent/waiver, retention, subprocessors, and incident process.
6. Complete current Chrome, Edge, Firefox, iOS Safari, Android Chrome, venue-TV, NVDA/VoiceOver, responsive, and throttled performance checks with screenshots.
7. Run a production-shaped capacity test for the accepted 50–300 competitor and 1–6 ring pilot envelope.
8. Verify Stripe in test mode end-to-end, or formally choose managed invoicing and hide self-service billing for the pilot. Tax, refund, dunning, and cancellation policy must be approved.
9. Conduct network-loss, duplicate-submit, result-correction, link-revocation, device-replacement, backup/restore, and printed-fallback rehearsals.
10. Obtain rules acceptance, run one fabricated-data rehearsal, then obtain written consent for a supervised customer pilot.

## Intentionally skipped or deferred

- Public marketing SEO, analytics, ad pixels, and heatmaps are not pilot blockers for the authenticated operations product; add them only after privacy approval and a defined acquisition funnel.
- Federation certification, native apps, athlete rankings, livestreaming, and fully unattended/offline operation are outside the verified product promise.
- No live deployment, DNS, account, payment, email, or secret changes were made by this report.

## Market judgment

Bowin is technically credible for a tightly supervised Taekwondo pilot and meaningfully differentiated by tournament-day workflows, corrections, public displays, and connection-loss-safe queues. It is not yet credible as an unattended general-availability SaaS because operational proof, legal approval, billing operations, production infrastructure, and real-event evidence remain open. Expansion should follow three successful supervised events with no unrecoverable scoring, bracket, privacy, or availability incident.
