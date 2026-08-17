# Bowin app completion roadmap — 2026-08-17

This roadmap records the remaining work between the verified production hotfix and a fully rehearsed, supportable pilot. It complements the existing GitHub shipping plan rather than replacing it.

## Verified release baseline

- Production revision: `07f23477db1da3ba528640dcd038acb274623f9f`
- Production readiness: application and database healthy.
- Production demo policy: the server reports `demoLoginEnabled: false`; the client now hides the demo action instead of calling a disabled endpoint and displaying an HTML-as-JSON error.
- Staging policy: isolated synthetic data with demo login enabled.
- Staging browser smoke: Chromium, Firefox, and WebKit passed the demo journey against the exact production revision.
- Automated verification: 770 tests passed, 24 skipped; typecheck, lint, production build, and whitespace checks passed.
- Release recovery artifacts:
  - Production rollback container: `taekwondo-tournament-rollback`
  - Production pre-release backup: `/var/backups/taekwondo/pre-20260817T224621Z-07f23477db1d.dump`
  - Staging rollback container: `bowin-staging-rollback`

The production fix is complete. The product is not yet an unattended general-availability service: the remaining gates below include infrastructure provisioning, human approvals, and physical rehearsal evidence.

## Phase 1 — isolated public demo

### Outcome

Give prospects a safe, useful demonstration without connecting public demo identities to a customer or mixed production database.

### Work

- Provision a dedicated hostname and synthetic database for the public demo.
- Enable demo login only with both `ENABLE_DEMO_LOGIN=1` and `DEMO_ISOLATED_DATA=1`.
- Provision a unique offline-capability signing key pair for that environment.
- Run the marker-protected fixture reset and publish the canonical public registration and scoreboard fixtures.
- Prove public visitors cannot enumerate or modify data outside the showcase scope.
- Establish an operator-owned reset cadence and disclose shared fabricated-state behavior truthfully.

### Exit criteria

- Ten simultaneous fresh visitors can complete the intended demo paths without seeing customer data.
- Public registration and a valid published scoreboard are testable with fabricated records.
- Reset, isolation, expiry, rate limiting, logout, and external-side-effect denial pass in the deployed environment.
- Exact-image health, fixture, and rollback evidence is recorded.

## Phase 2 — production operations and recovery

### Outcome

Turn the healthy deployment into an operated service with detectable failures and a staffed response path.

### Work

- Configure external monitoring for public HTTPS, readiness, database connectivity, error rate, email delivery, Stripe webhook health, certificate expiry, and backup freshness.
- Configure actionable alert delivery with a named primary and backup responder.
- Move encrypted backups off-host and execute a timestamped restore drill against a disposable target.
- Record recovery time, recovery point, checksum, row-count, migration, and application-readiness evidence.
- Exercise rollback and write the result into the release record.

### Exit criteria

- A deliberately failed staging check pages the expected responder and is acknowledged.
- A selected off-host backup restores successfully and the restored app passes readiness and representative workflow checks.
- Monitoring, on-call, escalation, and status-communication ownership are documented.

Existing dependencies: #120, #148, and #19.

## Phase 3 — venue, device, and accessibility rehearsal

### Outcome

Prove the tournament-day workflows on the hardware, networks, displays, and assistive technologies that staff and visitors will actually use.

### Work

- Complete the physical device and assistive-technology matrix in `docs/DEVICE-ACCESSIBILITY-ACCEPTANCE.md`.
- Rehearse director, scorekeeper, check-in, parent finder, public display, offline reload/recovery, corrections, printed fallback, and restore procedures.
- Run the venue display long enough to verify currentness, stale-state behavior, reconnect recovery, and screen legibility.
- Close or explicitly waive every critical or important defect with an owner and expiry date.

### Exit criteria

- WCAG 2.2 AA acceptance evidence is signed for critical journeys.
- Phone, tablet, laptop, venue display, zoom, reduced-motion, high-contrast, keyboard, and required screen-reader checks are recorded.
- `docs/VENUE-REHEARSAL-RECORD.md` is complete and signed.
- Printed fallback and restoration procedures are usable without developer intervention.

Existing dependency: #128.

## Phase 4 — policy, rules, and support approval

### Outcome

Make every public and operator-facing promise supportable and approved for a real pilot.

### Work

- Approve minor-data consent, privacy notice, retention, deletion, and incident-response language.
- Approve tournament rules, division logic, weight classes, scoring, tie-breaking, and correction procedures with a named domain owner.
- Approve support hours, escalation, notification channels, and customer-facing service-status language.
- Verify email/domain identities and all public legal links in the target environment.

### Exit criteria

- Legal/privacy, rules, venue, operations, and product owners are named.
- Approved documents include version, date, owner, and review cadence.
- The deployed application links to the approved versions and preserves consent/audit evidence.

Existing dependencies: #123 and #148.

## Phase 5 — product and experience completion

### Outcome

Finish the remaining prioritized product and UX work without weakening the verified trust boundaries.

### Work

- Work through the reconciled product/UX roadmap in #151 and tracker #152.
- Complete shared component adoption and visual consistency on the remaining critical journeys.
- Close remaining command-centre, correction-preview, live-finder, offline, and operational-status acceptance gaps using server-backed evidence.
- Keep optional AI recommendation work deterministic, reviewable, tenant-scoped, stale-safe, and auditable.

### Exit criteria

- Every retained launch requirement is either shipped and verified or explicitly deferred by the product owner.
- Critical workflows have no silent failure, contradictory success, unsafe retry, or inaccessible recovery state.
- Visual, responsive, accessibility, and browser regressions pass on the supported matrix.

## Phase 6 — CI, dependency, and release maintenance

### Outcome

Keep the released baseline reproducible and prevent known maintenance debt from becoming a production incident.

### Work

- Finish the required CI/security gates tracked in #19.
- Track the current `deepmerge-ts` advisory inherited through Prisma tooling; do not force a breaking Prisma downgrade as an automated audit fix.
- Upgrade when an upstream-compatible fixed dependency is available, then run migrations, generation, build, unit, integration, and deployment rehearsals.
- Keep deployment scripts, supported runtime documentation, rollback tests, and release evidence current.

### Exit criteria

- Required checks block merges and produce reproducible evidence.
- No unresolved high-severity dependency finding has an exposed production request path or lacks an owner, mitigation, and review date.
- A clean checkout can build, migrate, test, and deploy the documented exact artifact.

## Release decision

The current production revision is suitable for controlled testing of the repaired login and existing authenticated workflows. A public demo should remain disabled on production until Phase 1 is complete. A staffed pilot should not be declared complete until Phases 2–4 have signed evidence. General availability additionally requires the retained launch scope in Phases 5–6 to pass its release gates.

