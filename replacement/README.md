# Fresh Bowin implementation

This is new code and a new migration history for the requested discard/rebuild.
The retired root implementation is recoverable at tag `old-app-final`; Git history
and the old database remain recovery references.
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
an explicit organizer seed order of 2â€“256 checked-in competitors, creates balanced
byes, advances winners and stores the final champion. Owner/organizer roles generate
brackets; owner/organizer/scorekeeper roles record integer point totals. Ties, premature
matches and overwriting completed results are rejected. Scoring records actor, match,
scores and winner in the audit transaction. This is manual single-elimination scoring;
double elimination, penalties/clock automation and result correction
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

Patterns divisions support a manual scored final: an owner/organizer freezes all
1-256 registered checked-in entrants, staff records one aggregate score per entrant,
and the owner/organizer completes the final only after every entrant has a score.
Scores are integer hundredths from 0 to 1000 (0.00 to 10.00), not an implied federation
rulebook or a judging-panel calculation. Equal scores share a competition rank
(e.g. 1, 1, 3); ties are not silently broken. Version checks reject stale submissions,
completed scores cannot be overwritten, and changes plus actor/winner audits commit
in one transaction. Published results expose aliases, ranks and scores only.
Correction workflows and configurable federation/judge criteria remain future work.
Integration QA proves competing score submissions and rollback when scoring or final
completion cannot write its audit, including rollback of the division status.

The complete rebuild still requires public/self-service registration where enabled,
registration edits/withdrawals, production HTTPS/browser acceptance, and complete replacement-host recovery. This foundation is
live at https://tkd.ashbi.ca, but is not a completed rebuild. Existing API integration tests against
fresh isolated PostgreSQL prove invite/session/tenant/role and registration boundaries,
the three-competitor final and concurrent score submission rejection. Domain tests
exercise all 2â€“256 bracket sizes, verifying every entrant appears exactly once and
exactly nâ€“1 actual matches decide the champion.
Full release handoff and complete replacement-host recovery remain required.

Use `npm ci`, `npm test`, and `npm run migrate` with a dedicated disposable database.
Runtime configuration: DATABASE_URL, REBUILD_DATABASE_NAME, APP_ORIGIN, SETUP_TOKEN,
and a full RELEASE_SHA. Never use production/archive database connections for tests.
Coolify app `bowin-tkd` already auto-deploys `main` using
`docker-compose.rebuild-staging.yml` (context `./replacement`). Its staging-labelled
database is the live database. Checked immutable-image deployment remains preparation.

## Checked replacement images

`Rebuild checks` first migrates a disposable PostgreSQL 16 database twice and runs
the replacement's source tests. It then saves the exact runtime image and a receipt
bound to the repository, full source revision, workflow run and build attempt.
The receipt includes the archive checksum and immutable image identity.

A separate runner imports that saved image without rebuilding. The existing API
integration journey runs against the imported runtime: setup, login/invitation,
organization isolation, roles, registration/check-in, scheduling, bracket scoring,
public-result privacy and session revocation. Both runtime and test-client databases
are disposable QA databases; provider credentials are absent. The job checks the
unprivileged runtime UID, readiness/source revision, repeated image migrations and
database content preservation across an image restart. These are API checks. A separate browser job imports the same saved image and
exercises the new browser tournament desk with fictional data and an explicit
HTTP-only local QA cookie exception; it does not prove production HTTPS or product completion.

Image publication is disabled unless `BOWIN_IMMUTABLE_RELEASE_ENABLED=true`, and
then only runs for a main push after source, imported API/recovery and imported browser jobs pass. It loads and
verifies the saved image again, publishes a source/run/attempt-specific tag to
`ghcr.io/camster91/bowin-rebuild`, and records its immutable registry digest.
It never rebuilds during publication. A separate draft GitHub release stores and
refetches the receipt without exposing runtime configuration or secrets.

Actions archives expire after seven days and may disappear on full reruns.
Distinct attempt names distinguish receipts but do not guarantee artifact retention.
Draft receipt records preserve publication metadata; they do not themselves preserve
backup data or guarantee registry retention. Publication and VPS registry access
remain unverified until exercised against the actual registry and account.

The retired root application's build/publication workflows have been removed.
These image checks do not change live routing or reset the database. Coolify already
auto-deploys main to production through the staging Compose; adopting a checked
immutable-image consumer and completing the recovery handoff remain required.

The browser tournament desk serves setup/sign-in, tournaments, divisions, competitor
entry and division assignment/check-in, explicit bracket seed ordering and sparring
scoring, patterns scoring/completion, ring bookings, staff invitation acceptance,
publication/withdrawal and anonymous alias-only results. The interface hides owner
and organizer controls from scorekeepers; server authorization remains authoritative.
Untrusted names render as text. Invite fragments are cleared on arrival, and no
session credentials are stored in browser storage. Forms use associated labels and
native keyboard controls, with responsive layouts for tournament-day phones.
Browser checks use a separate disposable database and fictional accounts only.

The imported-runtime HTTPS job repeats the browser journey behind a disposable TLS
proxy with LOCAL_QA unset. It asserts Secure/HttpOnly/Strict cookies, keeps session
cookies hidden from document.cookie, and explicitly restarts the fixture database
and runtime while checking the same session and final rankings. The fixture uses a
self-signed loopback certificate; it does not prove public certificate issuance,
DNS or production Coolify routing. Publication also requires this job to pass.


Production preparation uses `docker-compose.rebuild-production.json`: a separate
`bowin_rebuild_production` database and volume, provisioning, owner migrations,
and an app using `bowin_runtime`. All three Node steps use the same checked runtime
image; production inputs must supply its immutable registry digest. The app has no
administrator/owner credential inputs, schema creation or migration/audit rewrite
rights. Audit inserts and reads remain available. Readiness validates its restricted
role. Existing role credentials must authenticate; provisioning does not rotate them.

The HTTPS CI job now executes this tracked production Compose in a fresh isolated
project. Only a loopback self-signed TLS proxy and test networks are added. It verifies
actual denied SQL privileges, repeats provisioning/migrations, rejects a wrong owner
credential, and repeats the browser/session/restart journeys as the runtime role.
Fixture credentials are generated locally for that disposable project and removed
with the project after testing. This is preparation; no production resource, real
credentials, routing, automatic deploy flag or database has been changed.
