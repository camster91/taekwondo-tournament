# Launch status

The one current status page for Bowin. It replaces the dated ship plans and
handoff notes now in [`docs/archive/`](archive/). GitHub issues hold the detail;
this page says what is finished and what is left before real events.

**Last updated:** 2026-10-01

## Product

### Requested discard and rebuild

The replacement under `replacement/` is new code with a separate migration history
and isolated `bowin_rebuild_` database. Its implemented API slices and remaining
browser/product work are described in [the replacement README](../replacement/README.md).
The replacement is incomplete and has not replaced production. Its checked-image
pipeline is separate from the root application's legacy CI/build/deploy path.

The feature table below describes the existing root application, retained as a
recovery reference; it does not establish that the requested replacement contains
all those features or has passed its launch checklist.

Everything needed to run a Taekwondo tournament is built and covered by
automated tests (unit, Postgres integration, and Playwright on Chromium,
Firefox, WebKit and mobile Chrome):

| Area | State |
|------|-------|
| Accounts | Magic-link sign-in, HttpOnly session cookie + CSRF, session revocation on logout/role change/deactivation, staff invitations with delivery status and recovery |
| Organizations | Multi-tenant isolation, per-tournament access grants, branded public pages, custom domains, templates |
| Registration | Staff entry, Excel/CSV import with auto-mapping, public self-registration with parental consent, capacity + waitlist, optional Stripe entry fees, confirmation emails, self-service registration management |
| Divisions & brackets | Auto-categorization, manual moves/splits/merges, DE/SE brackets with byes and seeding, correctable results with audit history |
| Event day | Check-in with weigh-in, offline-capable scorekeeper, director control room, ring schedule with delay propagation, ring staffing with coverage warnings and staff run sheets, public scoreboard, printable brackets/certificates/school reports |
| Compliance | Privacy/terms pages, consent versioning, GDPR export and account deletion, retention purge with dry run and legal hold |
| Operations | Health/readiness probes, Prometheus-style metrics, backup scripts with freshness check, fail-closed CI and deploy gates |

Experimental: non-Taekwondo sport profiles (see README).

## Deploying

One Docker image plus PostgreSQL. Coolify settings and the environment variable
list are in [DEPLOY.md](DEPLOY.md#coolify); the VPS script path is documented
there too. Deploy only commits on `main` with a green `Build` check.

## Operator checklist before the first real event

These cannot be done in code. Each links to the issue that tracks it.

**Accounts and services**
- [ ] Production environment variables set (see DEPLOY.md), including a fresh `JWT_SECRET`, `METRICS_TOKEN` and offline key pair.
- [ ] Mailgun domain verified (SPF/DKIM); send one real staff invitation and one registration confirmation to a test inbox (#46).
- [ ] Billing: either configure Stripe products, prices and the webhook, or run the pilot on manual plans (admin sets the plan).
- [ ] Legal sign-off on the privacy notice, terms and consent version (#167).

**Safety drills**
- [ ] Backups scheduled with an off-host copy; one restore rehearsed and timed (#165).
- [ ] One rollback rehearsed: redeploy the previous image and confirm health (#119, #292).
- [ ] Alerts wired: `/api/health/ready` uptime check, metrics scrape, backup freshness (#165).

**Rehearsal**
- [ ] Fabricated venue rehearsal on the production build: sign in → import competitors → generate divisions and brackets → check in → score on two rings (one offline for 5 minutes) → publish results (#166).
- [ ] Manual screen-reader and keyboard pass on the event-day screens (#128).
- [ ] Printed brackets and paper score sheets packed as a fallback; on-call window agreed.

**Optional**
- [ ] Isolated public demo environment (#164): separate database and hostname, `ENABLE_DEMO_LOGIN=1` and `DEMO_ISOLATED_DATA=1` there only.
- [ ] Retention purge: approve the retention period, review a dry run (`RETENTION_PURGE_DRY_RUN=true`), then enable (#121).

## Not in scope for the pilot

SSO, SMS/push notifications, native mobile apps, and federation certification.
