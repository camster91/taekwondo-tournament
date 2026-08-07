# Bowin fabricated venue rehearsal record

**Status:** execution required before a customer pilot

Use fabricated data representing the accepted pilot envelope: 300 competitors, six rings, at least two devices per operator role, a venue TV, a hotspot, and printed fallback material. Record timestamps, actors, observed state, recovery duration, screenshots/log IDs, and issue links.

| Scenario | Required acceptance evidence | Result / duration | Evidence / issue |
|---|---|---|---|
| Full setup | Import, consent versions, categorization, manual pin preservation, brackets, schedule, ring assignment | | |
| Duplicate result submit | One accepted result, one safe conflict/rejection, correct downstream bracket, audit trail | | |
| Result correction | Undo/correct result, downstream state reconciles, public display updates | | |
| Scorekeeper network loss | Result queued once, survives refresh, syncs after reconnect, conflict remains reviewable | | |
| Check-in network loss | Individual and bulk actions queue/sync without duplicate or silent loss | | |
| Public-link rotation | Old slug and old resolved UUID URL fail; new link succeeds | | |
| Operator device failure | Replacement device signs in, resumes correct ring/match, no local-only work is lost unknowingly | | |
| Database unavailable | Readiness fails, alert arrives, writes stop safely, recovery is verified | | |
| Backup restore | Encrypted artifact restored into a new isolated database; counts and representative bracket/result verified | | |
| Application rollback | Prior immutable digest restored without overwriting failure evidence | | |
| Email failure | Operator receives actionable failure; alternate approved access path is invoked | | |
| Venue internet failure | Hotspot/manual fallback invoked; officials continue with controlled reconciliation plan | | |
| Print fallback | Brackets, registration/check-in lists, ring schedule, contacts, and correction log are usable | | |
| 60-minute display soak | Six-ring cycle/director control remains accurate; no stale or frozen display | | |

## Exit decision

- [ ] Every scenario passed or has an accepted remediation with owner and due date.
- [ ] No severity-one or severity-two issue remains open.
- [ ] Rules authority verified representative divisions, byes, advancement, corrections, and placements.
- [ ] On-call, customer director, infrastructure, privacy, and venue contacts were reached through the documented channels.

Rehearsal lead: ____________________  Date: __________

Rules authority: ____________________  Date: __________

Pilot go/no-go approver: ____________________  Decision: __________
