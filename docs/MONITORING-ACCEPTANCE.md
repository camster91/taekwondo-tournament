# Bowin monitoring and alert acceptance

**Current state (2026-08-07):** the live Uptime Kuma v2 database contains zero monitors and zero notification routes. Configuration and test delivery require approval and a named recipient.

## Required monitors

| Signal | Check / threshold | Routing expectation | Test evidence |
|---|---|---|---|
| Public HTTPS | `https://tkd.ashbi.ca/api/health`, trusted certificate, 200 | SEV-1 after two consecutive failures | |
| Database readiness | `/api/health/ready` returns 200 and `db=ok` | SEV-1 after two consecutive failures | |
| TLS expiry | Valid chain and more than 21 days remaining | Warning at 30 days, SEV-2 at 14 days | |
| 5xx rate | `bowin_http_requests_total` 5xx ratio above 2% for 5 minutes | SEV-2; SEV-1 above 10% | |
| Authentication anomaly | OTP failures or rate-limit events exceed approved baseline | Security/on-call warning | |
| Stripe webhook failures | Any sustained signature/processing failure; dead-letter count nonzero | Billing/on-call SEV-2 | |
| Email failure | Mailgun rejected/failed events or suppression spike | Support/on-call SEV-2 | |
| Backup freshness | Latest encrypted verified artifact exceeds 26 hours | Infrastructure SEV-1 | |
| Restore drill age | No successful restore evidence in 90 days | Infrastructure warning | |
| Host/database capacity | Disk above 80%, memory pressure, PostgreSQL unavailable | Infrastructure SEV-2/1 | |

The public monitors must not include credentials. Private metrics access must use the secret store and must not expose tokens in URLs, screenshots, or exported monitor configuration.

## Alert acceptance drill

For every route, record recipient, timestamp, provider event ID, delivery channel, acknowledgement time, and recovery notification. Test failures must be induced only in isolated staging unless a separately approved production maintenance window exists.

- [ ] Readiness down and recovery received
- [ ] Database readiness down and recovery received
- [ ] TLS-expiry warning received
- [ ] Synthetic 5xx threshold received
- [ ] Email failure received
- [ ] Stripe webhook failure received
- [ ] Backup-stale alert received
- [ ] Named primary and backup recipients acknowledged

On-call owner: ____________________  Verified contact: ____________________

Accepted by: ____________________  Date: __________
