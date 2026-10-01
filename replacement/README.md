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
be reused. Public-display names are separate from private competitor names. Public
results expose aliases only when an owner or organizer publishes the event. Registration uses explicit organizer assignment
to a division, not automatic age/belt/weight categorization. Sparring divisions select
single-elimination, patterns select scored-final. The implemented sparring engine takes
an explicit organizer seed order of 2–256 checked-in competitors, creates balanced
byes, advances winners and stores the final champion. Owner/organizer roles generate
brackets; owner/organizer/scorekeeper roles record integer point totals. Ties, premature
matches and overwriting completed results are rejected. Scoring records actor, match,
scores and winner in the audit transaction. This is manual single-elimination scoring;
double elimination, penalties/clock automation, result correction and patterns scoring
remain pending rather than implied to follow any federation's complete rulebook.
A dedicated database name beginning `bowin_rebuild_`
is required by both migration and server startup. The old database `taekwondo` is rejected.
Setup uses a runtime token of at least 32 characters and closes transactionally after
the first user. Session cookies are HttpOnly, Secure, SameSite Strict and expire after
12 hours; all mutations require the configured canonical Origin. Local QA alone can
disable Secure cookies with `LOCAL_QA=true`; candidate/production must leave it unset.

Ring scheduling uses explicit UTC timestamps and the tournament's IANA time zone.
Bookings must fall on the local event date, last at most eight hours and cannot
overlap another division on the same normalized ring. Transaction locks serialize
concurrent bookings. Completed divisions cannot be rescheduled. Public results
are disabled by default and may be withdrawn; their field allowlist includes
organizer branding, event details, schedules, aliases and scores, excluding private
names, clubs, account details, internal identifiers and audit records.

The complete rebuild still requires public/self-service registration where enabled,
registration edits/withdrawals, patterns scoring, the browser interface, and end-to-end QA. This foundation is
not a completed rebuild or a live release. Existing API integration tests against
fresh isolated PostgreSQL prove invite/session/tenant/role and registration boundaries,
the three-competitor final and concurrent score submission rejection. Domain tests
exercise all 2–256 bracket sizes, verifying every entrant appears exactly once and
exactly n–1 actual matches decide the champion.
Browser acceptance, restart persistence and candidate backup/restore remain required.

Use `npm ci`, `npm test`, and `npm run migrate` with a dedicated disposable database.
Runtime configuration: DATABASE_URL, REBUILD_DATABASE_NAME, APP_ORIGIN, SETUP_TOKEN,
and a full RELEASE_SHA. Never use production/archive database connections for tests.
Coolify configuration and checked immutable-image releases follow candidate validation.
