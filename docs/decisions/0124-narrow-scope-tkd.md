# Decision 0124: Narrow product claim to TKD for v1; defer multi-sport to v2

> GitHub: camster91/taekwondo-tournament#124
> Status: Accepted.
> Date: 2026-09-10

## Context

The product is named "Bowin Tournament OS" and currently serves Taekwondo (TKD). The June roadmap and earlier marketing copy suggested multi-sport support. Other martial arts (Karate, Judo, BJJ, etc.) have very different rule sets.

## Decision

**v1: TKD only. v2 (if demand exists): multi-sport.**

The product name stays "Bowin Tournament OS" for v1. Marketing copy and the README will say "tournament management for Taekwondo" — no implicit multi-sport claim. Multi-sport is a deliberate v2 scope, conditional on actual customer demand.

## Trade-offs

- Smaller addressable market for v1.
- Clearer product story and tighter feature focus.
- Faster time-to-pilot: we ship one sport well instead of one sport half-done.

## Rationale

TKD has specific rules (BB/CB belt ranks, age/weight/gender divisions, patterns and sparring tracks, point-based scoring for sparring) that the product already implements. Other arts would need their own rule sets (round timing, scoring criteria, weight classes, etc.). Building for one sport and validating the platform reduces risk.

## Implications

- Marketing copy is TKD-only.
- README says "tournament management for Taekwondo" (or similar).
- No multi-sport rule engine is in the codebase.
- v2 multi-sport would require: a sport abstraction, a per-sport rule set, a sport-agnostic data model. Estimated 3-6 months of work.

## Action items

- [ ] Update `README.md` to specify TKD in the first paragraph.
- [ ] Update marketing copy on the landing page and in the brand kit.
- [ ] Re-evaluate multi-sport at v2 (after 6 months in pilot).

## Related

- #131 (reconcile product claims and README roadmap)
