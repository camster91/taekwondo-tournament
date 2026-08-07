# Bowin remaining launch actions

**Evidence date:** 2026-08-07

**Candidate branch:** `fix/saas-release-readiness-clean`
**Production domain:** `tkd.ashbi.ca`

This record separates verified repository work from changes that need operator approval, provider credentials, legal judgment, or real-world participants. It is not deployment authorization.

## Repository-controlled progress

- Customer lifecycle now includes an owner-only organization export, permanent organization/tournament deletion, subscription-state safeguard, exact slug confirmation, and export acknowledgement.
- A separate recently authenticated account-deletion flow removes the user and outstanding magic links, refuses deletion while organization memberships remain, and protects the last active system administrator.
- The organization and profile screens expose accessible destructive-action dialogs. The organization dialog passed visual review at 390 px with no horizontal overflow.
- Chromium, Firefox, and WebKit projects are configured. A WebKit focus-restoration defect was found and corrected. The responsive matrix covers 375, 768, 1024, 1440, and 1920 px; default form controls now meet the 44 px mobile target-size floor.
- Local PostgreSQL custom-format backup/restore succeeded with checksum `D1A12154FE5B090905BDD53CDBC53664E7A57401BB9AB875A62387C7586EAE2F`; the restored database contained 1 tournament, 20 registrations, 3 brackets, 31 matches, and all 9 completed migrations. This proves the procedure, not production backup coverage.
- A production-image load baseline against the database-backed readiness route completed 26,000 requests in 20 seconds at 50 concurrent connections: 37.45 ms average, 67 ms p99, 207 ms maximum.
- Production-image Lighthouse results for `/login`: performance 99, accessibility 100, best practices 96, LCP 2.12 s, CLS 0, total blocking time 6 ms.

## Current external state

### GitHub

- Repository Actions permission: disabled.
- `main`: no branch protection rule.
- PR #156 remains the merge candidate; no merge is authorized by this document.

### Live application and TLS

- `tkd.ashbi.ca` resolves to `187.77.26.99` and redirects HTTP to HTTPS.
- HTTPS presents a self-signed certificate (`CN=tkd.ashbi.ca`, self-issued), so ordinary clients reject it.
- Traefik's `tkd` router already declares the `letsencrypt` resolver, but `/opt/traefik/dynamic/tls.yml` explicitly assigns `/opt/traefik/certs/tkd.ashbi.ca.crt` and `.key`. That explicit certificate is the likely override preventing the ACME certificate from being served.
- The running `taekwondo-tournament` container was created 2026-07-17 from `camster91/taekwondo-tournament:build-latest`; it is not this candidate. It runs as `node`, but its root filesystem is writable and it has no attached storage.

### Staging and database

- `staging-tkd.ashbi.ca` and `tkd-staging.ashbi.ca` both resolve to the VPS, but Traefik returns 404 and an untrusted default certificate. No staging application/router is provisioned.
- The live application connects to database `taekwondo` on the shared `markup-postgres` container as database user `markup`. The database is logically separate but the service/container and credential identity are not isolated for Bowin.
- No Bowin/Taekwondo backup timer, cron entry, or named backup artifact was found. The database volume is a host bind mount, not a verified backup.

### Email and monitoring

- Mailgun reports `ashbi.ca` active and not disabled; its two sending TXT records and sending CNAME are valid. Public DNS has Google plus Mailgun SPF and a quarantine DMARC policy.
- Mailgun receiving MX records report `unknown`, which is acceptable only if Bowin is send-only. A real sign-in delivery, bounce, complaint, and suppression drill has not been run. Mailgun's domain setting does not currently require TLS.
- Uptime Kuma is present on the VPS, but a Bowin readiness monitor, notification route, and received test alert have not been verified.

### Licensing and approvals

- The private repository is detected as MIT because `LICENSE` is an unfinished MIT template, while `package.json` declares ISC. The commercial operator must choose proprietary distribution or intentionally open-source the code, then provide the legal owner name and year.
- Privacy, terms, organizer agreement, guardian waiver/consent, retention, subprocessors, incident process, and rules configuration remain drafts until approved by the operator and qualified counsel/rules authority.

## Approval-gated execution batches

### Batch A — repository controls

1. Enable GitHub Actions for this repository.
2. Run the candidate CI matrix and require its successful build check on `main`.
3. Protect `main`: pull requests required, one approval, stale approvals dismissed, conversation resolution required, force-push/deletion blocked, administrators included.

### Batch B — trusted TLS repair

1. Back up the current Traefik router, TLS configuration, certificate files, and ACME state with timestamped filenames.
2. Remove only the two `tkd.ashbi.ca` explicit certificate references from the active TLS file.
3. Validate Traefik configuration and reload the proxy without restarting application containers.
4. Confirm Let's Encrypt issuance, trusted chain, HTTP redirect, external readiness, and renewal configuration. Restore the timestamped files immediately if routing or issuance fails.

### Batch C — isolated staging

1. Choose one staging hostname and remove the unused duplicate DNS name after approval.
2. Provision a dedicated PostgreSQL 16 service, least-privilege Bowin user/database, encrypted backup destination, and staging app using the candidate image digest.
3. Use fabricated data only. Configure a Mailgun test domain, Stripe test mode, private metrics collector, external readiness monitor, and centralized logs.
4. Apply migrations, run the full smoke/recovery/cross-browser suite, restore a staging backup into a second isolated database, and retain evidence.

### Batch D — provider and operational drills

1. Send approved test sign-in/management messages and verify delivery events, bounce, complaint, and suppression behavior.
2. Complete Stripe test checkout, signed webhook, duplicate webhook, portal, plan change, cancel-at-period-end, expiry, failed-payment, refund, and deletion-after-cancellation scenarios.
3. Fire readiness, 5xx, database, email, and auth-anomaly alerts to the named on-call contact.
4. Run network loss, duplicate submission, result correction, public-link revocation, device replacement, print fallback, and rollback rehearsals.

### Batch E — human approvals and pilot

1. Record the software-license choice and legal owner/year.
2. Obtain counsel/operator approval for every versioned legal document.
3. Obtain a named Taekwondo rules authority's acceptance of categorization, seeding, bracket, bye, scoring, and placement behavior.
4. Complete NVDA or VoiceOver and physical iOS/Android/venue-TV checks.
5. Run a fabricated tournament rehearsal, then obtain written customer consent for the supervised pilot.
6. After three successful supervised events and a retrospective, reconsider general availability.

## Production boundary

Do not merge PR #156, change live TLS, create provider resources, send email, enable payments, alter DNS, back up or restore the production database, or deploy until the corresponding execution batch receives explicit action-time approval.
