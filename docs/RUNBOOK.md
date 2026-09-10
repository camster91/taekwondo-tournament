# Post-Launch Monitor Runbook

> Single-operator on-call handbook for the first 30 days after the Bowin
> pilot goes live. Closes the LAUNCH_PLAN.md "Monitor logs and feedback
> post-launch" checkbox.
>
> All on-call actions live in the [Bowin VPS shell](#ssh-into-the-bowin-vps)
> or in the operator's personal triage inbox. There is no team rotation —
> Cameron is the only on-call engineer. If any of the steps below feel
> ambiguous, escalate by leaving a clear breadcrumb in the [TODO](#notes)
> section of this file and replying to the support thread with a
> short status.

---

## SSH into the Bowin VPS

```bash
ssh -i ~/.ssh/id_ed25519_hostinger root@187.77.26.99
```

The live container is `taekwondo-tournament`, the rollback container is
`taekwondo-tournament-rollback`, the database container is
`markup-postgres`, the public URL is `https://tkd.ashbi.ca`, and the
public health probe is `https://tkd.ashbi.ca/api/health/ready`.

Useful one-liners:

```bash
# Tail live container logs (Ctrl+C to exit)
docker logs -f --tail 200 taekwondo-tournament

# Last 50 lines of the database
docker logs --tail 50 markup-postgres

# Health check from inside the VPS
curl -fsS http://127.0.0.1:3001/api/health/ready

# Public health check (also the alert target)
curl -fsS https://tkd.ashbi.ca/api/health/ready

# Disk + memory snapshot
df -h / && free -h
```

---

## Daily checklist (5 items)

Run first thing every morning, or after a deploy. Takes about 10 minutes.

1. **Public health probe is green.**
   `curl -fsS https://tkd.ashbi.ca/api/health/ready` returns
   `{"status":"ok","db":"ok"}`. If it returns non-2xx, jump to
   [Sentry alert fires](#first-three-things-to-do-if-sentry-alert-fires).
2. **No new Sentry issues older than 1 hour unresolved.**
   GlitchTip or Sentry dashboard → Issues → filter to
   `environment:production` → confirm every `first_seen >= 24h` issue
   is either resolved, muted, or has a comment explaining the defer.
3. **No support email older than 24 hours is unanswered.**
   Check the shared `rotman-av-requests@ashbi.ca` mailbox (or the
   dedicated support alias). Any reply older than a business day
   gets a status reply, even if it is "looking into it".
4. **Public registration endpoint is responsive.**
   `curl -fsS -X POST https://tkd.ashbi.ca/api/public/tournaments/<id>/register -H 'content-type: application/json' -d '{}'`
   — confirm 4xx (validation) rather than 5xx. A 5xx here means the
   public flow is broken.
5. **Disk on the VPS is < 80% used.**
   `df -h /` on the VPS. The Postgres backup dir
   (`/var/backups/taekwondo`) is the usual culprit; prune anything
   older than the most recent 7 daily dumps if it tips 80%.

---

## Weekly checklist (5 items)

Run every Monday morning. Takes about 30 minutes.

1. **Sentry error budget review.**
   Open Issues → group by `error_type` → count occurrences this week
   vs last week. Any new `error_type` with > 5 events is a candidate
   for a P1 fix this week.
2. **Scorekeeper support load.**
   Filter Sentry by `transaction:/scorekeeper*` and review the
   user-reported "wrong score" or "stuck on undo" tickets. The
   Scorekeeper is the highest-stakes screen; treat any new failure
   mode here as a same-day issue.
3. **Capacity & waitlist review.**
   Hit `GET /api/internal/registrations?status=waitlist` (requires
   `METRICS_TOKEN` against the metrics endpoint). If the waitlist
   for any tournament > 20% of confirmed registrations, raise it
   in the next planning session.
4. **Backup freshness.**
   `ls -lah /var/backups/taekwondo/` — confirm a fresh
   `pre-<DATE>.dump` exists from within the last 24 hours. The
   deploy script always writes one before mutating the DB; if a
   backup is missing, the deploy may have been bypassed (audit!).
5. **Dependency & security advisory sweep.**
   `npm audit --omit=dev` in the repo. Any HIGH or CRITICAL
   finding → open a tracking issue the same day.

---

## Monthly checklist (5 items)

Run on the first Monday of each month. Takes about an hour.

1. **Cost review.**
   Check the VPS provider bill, Cloudflare analytics, and PostHog
   (or whatever analytics is in use) — the goal is to spot any line
   item that has doubled month-over-month before it becomes the
   bill.
2. **Disaster recovery rehearsal.**
   On a Friday evening, redeploy the most recent release from a
   clean archive in a throwaway staging environment and confirm
   the rollback container name + backup path line up with what
   `scripts/deploy-production.sh` expects. Document the result
   in `docs/RECOVERY-DRILL-LOG.md`. (Cameron-gated; do not run
   on production.)
3. **Customer feedback themes.**
   Read every support email, DM, and survey response from the
   past month. Group by theme (registration flow, scorekeeper,
   brackets, billing). Post a 1-paragraph summary in the team
   channel with the top 3 themes and the top 3 improvement
   candidates.
4. **Ratchet the SLO.**
   If the Sentry error rate has been below the SLO target for 4
   consecutive weeks, tighten the target by 10%. If it has been
   above the target for 2 consecutive weeks, stop tightening and
   invest in the underlying cause.
5. **Stakeholder report.**
   Send a 5-bullet update to the AV team list with: deployment
   count, support ticket count, error budget, waitlist status,
   and one thing going well + one thing to fix.

---

## First three things to do if a Sentry alert fires

A Sentry alert means a new error was captured, the error rate for
an existing issue crossed a threshold, or the public health probe
stopped responding. Time matters — venue TVs running
`tkd.ashbi.ca/display/*` are visible to parents in real time.

1. **Confirm the alert is real, not a fluke.**
   `curl -fsS https://tkd.ashbi.ca/api/health/ready`. If it is
   green, the alert was a transient — note the timestamp in the
   issue and move on. If it is red or timing out, the alert is
   real; go to step 2.
2. **Check the live container logs for the same error.**
   `docker logs --tail 200 taekwondo-tournament | grep -A 5 <error-message>`
   If the container is up and serving traffic, the alert is most
   likely a client-side error reaching Sentry at scale (e.g. a
   single user with a stale tab). Capture a representative event
   ID and move to step 3. If the container is crashed or the DB
   is unreachable, jump to [rollback](#rollback-procedure).
3. **Triage and respond.**
   Open the Sentry issue, set the assignee, and either:
   - mark `resolved` (it was a one-off), or
   - mute (with reason) if it is a known issue, or
   - ship a hotfix via the standard `git tag` + Coolify deploy
     flow. The deploy script is rollback-safe; see [DEPLOY.md](./DEPLOY.md).

### Rollback procedure

If the live container is wedged and the public health probe is red:

```bash
# On the VPS
docker rename taekwondo-tournament taekwondo-tournament-broken
docker rename taekwondo-tournament-rollback taekwondo-tournament
docker start taekwondo-tournament
curl -fsS http://127.0.0.1:3001/api/health/ready
```

If the database is the suspect (Postgres corruption, dropped column
from a botched migration), restore the most recent
`/var/backups/taekwondo/pre-<DATE>.dump` per the
[BACKUP-RECOVERY.md](./BACKUP-RECOVERY.md) procedure — but only
after confirming the backup validates with `pg_restore --list`.

---

## First three things to do if a support email is unanswered

> Applies to a "I emailed you two days ago and have not heard back"
> situation. The goal is to get an acknowledgement in front of the
> customer within 4 business hours of the gap being noticed, even if
> the actual fix takes longer.

1. **Reply with an acknowledgement, not a fix.**
   "Hi <name> — I saw your message from <day>. I'm looking into
   <one-sentence summary> and will follow up with a concrete
   answer by <day>." This unblocks the customer without making a
   promise that has to be kept. Do not skip this step.
2. **Reproduce locally.**
   If the report mentions a specific tournament id or scorekeeper
   screen, log in with `ENABLE_DEMO_LOGIN=1` (or magic-link to the
   staging DB) and reproduce. If the report is vague ("the site is
   slow today"), check the Sentry error rate and the
   `taekwondo-tournament` container's CPU/memory on the VPS first.
3. **Decide: fix, escalate, or document.**
   - **Fix:** ship it via the standard path. Reply with the
     release SHA + a 1-line description of the change.
   - **Escalate:** if the issue is a Cameron-gated item (Stripe
     live keys, legal, production cutover), add it to the next
     planning session and reply to the customer with the expected
     timeline.
   - **Document:** if the issue is by-design or already on the
     roadmap, link to the relevant issue or doc and offer a
     workaround.

---

## Notes

Update this section as you learn. Each entry should be one line: the
date, a short title, and a link to the artifact (issue, PR, or
support thread).

- (template) YYYY-MM-DD — title — link
