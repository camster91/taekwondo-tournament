# Decision 0122: Tenancy release boundary and tenant-isolation model

> GitHub: camster91/taekwondo-tournament#122
> Status: Accepted (in production for SH-3 fix `eb985d4` and earlier releases).
> Date: 2026-09-10

## Context

Bowin serves multiple organizations (tenants) on a single deployment. Tenant isolation is critical: a public demo on a multi-tenant install must not be able to read another tenant's data. The June 2026 audit and the 5-track code review found that the demo user had `role='admin'` and bypassed tenant scoping — a tenant-isolation break.

## Decision

**Single-deployment multi-tenant with row-level isolation.** Every business table carries an `organizationId` foreign key; every query that touches business data must filter by `organizationId` at the middleware or query layer. The demo user has a synthetic `organizationId` and a `role='demo'` (not `role='admin'`) so that admin short-circuits do not fire.

## Trade-offs

- **Cheaper to operate** than per-tenant databases (one DB, one connection pool, one migration pipeline).
- **More complex isolation testing** — every query must be exercised in a multi-tenant context. Tests in `auth-demo-tenant-isolation.test.ts` and the broader isolation suite.
- **Compliance posture** is weaker than per-tenant; acceptable for v1 because the data is operational tournament data, not regulated PII in a cross-tenant way (per-tenant isolation is handled by the consent + retention policy, see #123).

## Rationale

Row-level isolation is the industry standard for SaaS at this scale. The DB engine handles the join and filter; the application code does not need to negotiate cross-tenant queries. Tenant-scoped row-level access maps cleanly to the existing Prisma model.

## Implications

- Every new query path MUST filter by `organizationId`. The middleware (`src/server/middleware/auth.ts`) enforces this via `buildTournamentAccessFilter` and the new `isDemoUser` + `enforceDemoCapability` checks (see SH-3 commit `eb985d4`).
- Cross-tenant analytics (e.g. "all tournaments in the system") is out of scope. The platform does not aggregate across tenants.
- Future per-tenant DB migration is possible but not planned. If a tenant outgrows the row-level model, we can move them to a dedicated database without changing the application contract.

## Action items

- [x] SH-3 fix landed: `eb985d4` scoped demo user to synthetic tenant, removed global admin bypass.
- [x] 45/45 isolation tests pass.
- [ ] Verify every new query path adds a `tenantId` filter before merge (CI gate or review checklist).
- [ ] Quarterly review: scan the codebase for `findMany` / `findFirst` on business tables without an `organizationId` filter.

## Related

- #123 (consent / retention)
- #164 (isolated demo environment)
- `auth.ts` `enforceDemoCapability` and `isDemoUser` (SH-3)
