# Fresh Bowin implementation

This is new code and a new migration history for the requested discard/rebuild.
The existing root implementation, Git history and old database are recovery references.
This package never imports existing application modules or runs old migrations.

The first implemented slice is one-time owner setup, password/session authentication,
organization membership boundaries, organizer tournament creation/listing, audit writes,
and database/revision readiness. A dedicated database name beginning `bowin_rebuild_`
is required by both migration and server startup. The old database `taekwondo` is rejected.
Setup uses a runtime token of at least 32 characters and closes transactionally after
the first user. Session cookies are HttpOnly, Secure, SameSite Strict and expire after
12 hours; all mutations require the configured canonical Origin. Local QA alone can
disable Secure cookies with `LOCAL_QA=true`; candidate/production must leave it unset.

The complete rebuild still requires organizer invitations, competitor registration,
divisions, supported brackets, scheduling, check-in, scoring authorization, organizer-
branded public results, the browser interface, and end-to-end QA. This foundation is
not a completed rebuild or a live release. Add meaningful tenant/authentication tests
against an isolated PostgreSQL database before a candidate is accepted.

Use `npm ci`, `npm test`, and `npm run migrate` with a dedicated disposable database.
Runtime configuration: DATABASE_URL, REBUILD_DATABASE_NAME, APP_ORIGIN, SETUP_TOKEN,
and a full RELEASE_SHA. Never use production/archive database connections for tests.
Coolify configuration and checked immutable-image releases follow candidate validation.
