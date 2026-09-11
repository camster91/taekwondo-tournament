# Decision 0131: Reconcile product claims and README roadmap release scope

> GitHub: camster91/taekwondo-tournament#131
> Status: Accepted.
> Date: 2026-09-10

## Context

The README and earlier marketing copy listed features and timeline. Some are not yet shipped, some shipped under different names, and some are aspirational. Trust requires the docs to match reality.

## Decision

**The README lists only shipped features. The roadmap is a separate doc with timeline per feature.** Marketing copy that mentions "coming soon" is allowed only for features that are scoped and scheduled, not for aspirational ideas.

## Trade-offs

- Less "aspirational" marketing — fewer features mentioned on the homepage.
- Clearer product truth — the user sees what the product does, not what we hope it does.
- Easier to maintain — the README is the source of truth for what's shipped.

## Rationale

Trust requires accurate docs. The ship plan (`docs/END_TO_END_SHIP_PLAN.md`) is the source of truth for what's done. The README is the user-facing summary of that.

## Implications

- README is rewritten to list only shipped features.
- `docs/ROADMAP.md` is the new home for upcoming features with target dates.
- Marketing copy references the roadmap where appropriate.
- Each PR that ships a feature updates the README in the same commit.

## Action items

- [ ] Rewrite `README.md` to list only shipped features.
- [ ] Create `docs/ROADMAP.md` with current target dates per feature.
- [ ] Add "Update README" to the PR template checklist.
- [ ] Marketing copy review (Cameron, after pilot).

## Related

- #124 (narrow to TKD)
- #15 (release-records)
