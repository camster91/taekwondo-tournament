# Fresh Bowin implementation

This is new code and a new migration history for the requested discard/rebuild.
The existing root implementation, Git history and old database are recovery references.
This package never imports existing application modules or runs old migrations.

Implemented slices include one-time owner setup, password/session authentication,
organization membership boundaries, organizer tournament creation/listing, audit writes,
divisions, competitor records, division registration/check-in and one-time invitations.
Owners invite organizer/scorekeeper accounts through a token returned once; no messages
are sent. Existing accounts must prove their current password to accept an invitation;
an invitation never replaces their password. Tokens expire after 24 hours and cannot
be reused. Public-display names are separate from private competitor names; no public
competitor endpoint has been added. Registration uses explicit organizer assignment
to a division, not automatic age/belt/weight categorization. Sparring divisions select
single-elimination, patterns select scored-final; bracket/scoring engines remain pending.
A dedicated database name beginning `bowin_rebuild_`
is required by both migration and server startup. The old database `taekwondo` is rejected.
Setup uses a runtime token of at least 32 characters and closes transactionally after
the first user. Session cookies are HttpOnly, Secure, SameSite Strict and expire after
12 hours; all mutations require the configured canonical Origin. Local QA alone can
disable Secure cookies with `LOCAL_QA=true`; candidate/production must leave it unset.

The complete rebuild still requires public/self-service registration where enabled,
registration edits/withdrawals, supported brackets, scheduling, scoring authorization, organizer-
branded public results, the browser interface, and end-to-end QA. This foundation is
not a completed rebuild or a live release. Existing API integration tests against
fresh isolated PostgreSQL prove invite/session/tenant/role and registration boundaries.
Browser acceptance, restart persistence and candidate backup/restore remain required.

Use `npm ci`, `npm test`, and `npm run migrate` with a dedicated disposable database.
Runtime configuration: DATABASE_URL, REBUILD_DATABASE_NAME, APP_ORIGIN, SETUP_TOKEN,
and a full RELEASE_SHA. Never use production/archive database connections for tests.
Coolify configuration and checked immutable-image releases follow candidate validation.
