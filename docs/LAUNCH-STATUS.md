# Bowin launch status

Updated 2026-10-03. The active rebuild is [`replacement/`](../replacement/README.md),
live at https://tkd.ashbi.ca through Coolify **bowin-tkd**. Every `main` push deploys
production. The parked root application is recoverable at `old-app-final`.
This status reflects source review and owner-supplied deployment evidence, not a
new live verification. The rebuild is live but not ready to call finished for real events.

## Implemented

One-time owner/organization setup; password authentication and cookie sessions;
owner, organizer and scorekeeper access; one-use staff invitation links; tournament
creation; manual divisions, competitor entry, assignment and check-in; seeded
single-elimination sparring with byes and winner advancement; scored-final patterns
with shared ranks; ring bookings with overlap checks; explicit public result
publication/withdrawal using public aliases; transactional mutation audit records.
The UI is plain JavaScript and the database has six separate SQL migrations.

These are manual workflows. There is no automatic categorization, double elimination,
clock/penalty automation, paid registration or offline scoring. Public results include
the organization name but currently inherit Bowin header/footer branding.

## Remaining priorities

**P0 — before real events:**

- Recovery: nightly encrypted local backups now run at 03:25 ET with 14-day retention;
  off-host copies, decrypt/restore rehearsal, freshness alerts and agreed RPO/RTO remain.
- Deployment: enforce checked releases, rehearse rollback, separate runtime/migration
  privileges, and preserve live data when changing the staging-labelled deployment.
- Safe operations: registration edits/moves/withdrawals, late-entry and event lifecycle,
  audited result corrections, password recovery and staff access removal.
- Trust and usability: approved privacy/terms/minor-data procedures, organizer-only
  public branding, event-local schedule entry, mobile/accessibility acceptance.
- Event resilience: printable paper fallback, proven monitoring/alert delivery and a
  signed two-ring venue rehearsal covering expiry, outages, corrections and recovery.

**P1 — complete organizer workflows:** bulk import/division assistance, optional public
registration, email delivery, refreshing public displays, ring-scoped staff operations,
reviewed connectivity recovery, broader browser/security/load QA and clearer onboarding.

**P2 — after reliable supervised events:** billing/customer lifecycle, isolated demo,
broader competition rules/formats and advanced scheduling/localization.

## Owner and design decisions

Cameron must approve pilot scope/rules, deployment and database transition strategy,
recovery objectives/off-host destination, legal/privacy policy, support contacts and
rehearsal/release gates. Bianca must approve organizer-only identity and review mobile,
desktop and public-result states. Existing market/support plans remain proposals until
approved against rebuild behavior. See [deployment](DEPLOY.md),
[market launch plan](MARKET-LAUNCH-PLAN.md) and [pilot support plan](PILOT-SUPPORT-PLAN.md).
