# Bowin release evidence — 2026-08-13

This record captures the release work verified on 2026-08-13. It is not a
customer-pilot go/no-go approval and does not substitute for the physical
device, venue, legal, monitoring, or support evidence listed below.

## Production recovery and cached-client compatibility

- **Production URL:** `https://tkd.ashbi.ca`
- **Verified running image:** `bowin-release:b9aff04d5e134ff935ed96e3955d055fc04610f2`
- **Verified direct readiness:** `{"status":"ok","db":"ok"}` from the bound
  application listener.
- **Verified public readiness:** `https://tkd.ashbi.ca/api/health/ready`
  returned the same database-aware healthy response.
- **Cached-client compatibility:** the legacy `GET /api/setup-status` route now
  returns a 307 redirect to `/api/auth/setup-status`; following the redirect
  returns JSON `{"needsSetup":false}`. This prevents an older cached client
  from parsing the SPA HTML shell as setup-status JSON.

The database backup captured immediately before the verified production
cutover is retained at:

`/var/backups/taekwondo/pre-20260813T172241Z-b9aff04d5e13.dump`

The prior image is retained locally as
`taekwondo-tournament-rollback` for the release window. This is rollback
evidence, not proof of an encrypted off-host backup or a production restore
drill.

## Deployment safeguards rehearsed on staging

The checked-in staging deployment workflow was exercised against the isolated
staging service using its deliberate failure switches:

| Rehearsal | Expected result | Observed result |
|---|---|---|
| Failure after app cutover rename | Previous app resumes and passes direct/public readiness | Passed |
| Failure after migration/demo-reset stage | Database backup is restored, previous app resumes, and fixture/public readiness pass | Passed |
| Normal staging deployment | Candidate, direct readiness, public readiness, and fixture canary pass before release is declared healthy | Passed |

The production workflow now also uses an immutable source archive, remote
revision-labelled image build, exclusive deployment lock, candidate health
gate, verified stopped-write database backup, exact previous-image check, and
automatic application/database recovery while rollback remains armed.

## Current repository verification

Run on the release branch after the deployment-workflow contract correction:

| Check | Result |
|---|---|
| Unit/integration test suite | 768 passed; 24 intentionally skipped |
| Deployment contract tests | 4 passed |
| Type checks | Passed |
| Lint | Passed |
| Production build | Passed |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |

The latest repository-only verification commit is `da77c78`. It changes test
coverage only; it is not a production application release.

## Pilot gates still requiring external evidence

The following items remain open and must not be marked complete based on the
automated checks above:

1. Complete and sign the physical-device and assistive-technology matrix in
   [DEVICE-ACCESSIBILITY-ACCEPTANCE.md](DEVICE-ACCESSIBILITY-ACCEPTANCE.md),
   including iOS, Android, NVDA/VoiceOver, keyboard-only, 200% zoom/high
   contrast, and a 60-minute venue-display soak.
2. Complete the fabricated venue rehearsal in
   [VENUE-REHEARSAL-RECORD.md](VENUE-REHEARSAL-RECORD.md), including printed
   fallback, device replacement, network loss, result correction, application
   rollback, and an isolated encrypted-backup restore.
3. Configure monitors, notification routes, named primary/backup on-call
   contacts, and alert-delivery drills recorded in
   [MONITORING-ACCEPTANCE.md](MONITORING-ACCEPTANCE.md) and
   [PILOT-SUPPORT-PLAN.md](PILOT-SUPPORT-PLAN.md).
4. Obtain the required operator, counsel/privacy, and Taekwondo rules-authority
   approvals for the applicable versioned documents and tournament behaviour.
5. Decide whether public registration should be testable in production. At the
   time of verification, `/api/public/tournaments` returned an empty list, so
   no public registration event is currently available.

## Release decision

**Software deployment status:** recovered, guarded, and verified for the
current production release.

**Customer-pilot status:** not yet approved. The external evidence above is a
hard gate for a supervised pilot and remains intentionally open.
