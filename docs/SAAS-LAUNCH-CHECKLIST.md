# SaaS launch checklist

This repository is technically suitable for a controlled pilot after the automated and external checks below pass. It is not a self-serve paid SaaS yet: organization plans exist in the data model, but checkout, subscription lifecycle, entitlements, invoices, and webhook reconciliation are not implemented.

## Automated release gates

- Unit/integration tests, client/server type checks, lint, production build, and Prisma validation pass.
- Production migrations are tested from an empty database and a production-like snapshot.
- Tenant isolation, public scoreboard rotation, parent management tokens, concurrent scoring, and bracket invariants have regression coverage.
- Container readiness fails when PostgreSQL is unavailable.
- Dependency advisories are reviewed; see `SECURITY.md` for the current React Router exception.

## External launch prerequisites

- Choose the legal operator, product name, production domain, support address, and incident contact.
- Publish terms of service and a privacy notice covering competitor/child data, dates of birth, weights, accommodations, retention, deletion, subprocessors, and international transfers.
- Establish parental/guardian consent and tournament-organizer data-processing responsibilities with counsel.
- Configure a verified Mailgun domain and test delivery, bounce, complaint, and suppression handling.
- Provision isolated production PostgreSQL, automated encrypted backups, retention, restore drills, and access logging.
- Configure uptime/error monitoring and alerts for readiness failures, 5xx rates, email failures, migration failures, and abnormal registration/OTP traffic.
- Set strong secrets in Coolify, remove the bootstrap key after setup, and verify all development gates are off.
- Name an on-call operator and rehearse database restore, public-link revocation, account disablement, and tournament-day network failure procedures.
- Run a pilot tournament with non-sensitive test data, then one explicitly consented limited customer before broad availability.

## Paid self-service work not present

- Pricing and plan limits
- Stripe Checkout or equivalent
- Subscription and webhook state machine with idempotency
- Server-side entitlement enforcement
- Billing portal, invoices, taxes, refunds, cancellation, and dunning
- Organization self-signup, ownership transfer, and account/data deletion workflow

Until those are implemented, sell and provision the product as an approval-based managed pilot, not an automated subscription service.
