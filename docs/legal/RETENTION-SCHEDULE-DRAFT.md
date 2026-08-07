# Bowin data-retention schedule — operator/counsel draft

**DO NOT ENABLE AUTOMATIC PURGE OR PUBLISH THIS SCHEDULE UNTIL APPROVED.** Periods below are proposed operational defaults, not legal conclusions.

| Record | Proposed active period | Proposed post-event/deletion handling | Owner and approval needed |
|---|---|---|---|
| Magic links and verification codes | 10-minute functional lifetime | Purge used/expired rows on a short operational schedule | Security owner |
| Session validity | Up to 7 days, revocable by token version | Expire automatically; retain only minimized security logs under the log policy | Security owner |
| Soft-deleted competitors, tournaments and divisions | While active | Recoverable for 7 days, then permanently purge when `RETENTION_PURGE_ENABLED=true` | Legal operator/counsel |
| Registrations, brackets, scores and results | Through event and support window | [DEFINE: e.g. contract plus dispute/record period], then delete or anonymize | Organizer/operator/counsel |
| Parent/guardian contact details | Registration and necessary event communications | [DEFINE], preferably delete or detach earlier than results | Organizer/operator/counsel |
| Weights, DOB and accommodation notes | Minimum necessary event period | [DEFINE MINIMAL PERIOD]; do not retain merely for convenience | Organizer/operator/counsel |
| Incident reports | Event and legally required claim/insurance period | [DEFINE BY JURISDICTION/INSURER]; restrict access and purge separately | Counsel/insurer |
| Match audit logs | Event integrity, correction and dispute period | [DEFINE], then aggregate/anonymize or delete | Operator/organizer |
| Transactional email events | Delivery and abuse investigation | [DEFINE PROVIDER/LOCAL PERIOD] | Privacy/security owner |
| Application/security logs | Incident detection and troubleshooting | Proposed 30–90 days with sensitive-field redaction | Security/privacy owner |
| Database backups | Disaster recovery | Proposed rolling encrypted retention; document exact daily/weekly/monthly windows and deletion behavior | Infrastructure/privacy owner |
| Billing/tax records | Contract and statutory period | [DEFINE BY JURISDICTION] | Finance/counsel |
| Support communications | Resolution and reasonable follow-up | [DEFINE], then delete/redact | Support/privacy owner |

## Required controls

- Record the accepted notice/consent version and timestamp instead of relying on an undifferentiated checkbox.
- Prevent free-form sensitive fields from entering application logs, analytics, crash reports, or support screenshots.
- Keep automatic purge disabled until the production backup and restore procedure is tested and this schedule is approved.
- Document deletion propagation to primary storage, replicas, backups, email, monitoring, exports, and customer-held copies.
- After any database restore, re-run deletion/retention processing before reopening service where legally required.
- Test retention in staging with fabricated records on both sides of every cutoff and retain the report.
