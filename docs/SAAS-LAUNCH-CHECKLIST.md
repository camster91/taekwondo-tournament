# SaaS launch checklist

This repository is technically suitable for a controlled pilot after the automated and external checks below pass. Checkout, signed/idempotent subscription webhooks, plan entitlements, billing portal access, account deletion, and customer-controlled organization export/deletion are implemented. Provider-side Stripe, tax, invoice, cancellation, dunning, refund, and paid-customer deletion behavior still require end-to-end verification before paid self-service launch.

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

## Paid self-service work still requiring provider or policy verification

- Stripe test and live product/price configuration
- Hosted Checkout, signed webhook, duplicate delivery, portal, plan-change, failed-payment, cancellation, and expiry drills
- Tax registration and calculation decision
- Invoice, refund, cancellation, and dunning policy approval
- Paid-customer export/deletion after provider cancellation and retention obligations
- Ownership transfer policy and workflow

Until those checks pass, sell and provision the product as an approval-based managed pilot, not an unattended paid subscription service.
