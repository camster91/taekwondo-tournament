# Advisory Tracking: deepmerge-ts via Prisma Config

**Status:** Monitored, non-blocking  
**Last Updated:** 2026-09-10  
**Advisory:** [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)  
**Severity:** High (npm audit)  
**Affected:** `deepmerge-ts <8.0.0` via `@prisma/config` via `prisma` CLI tooling

---

## Summary

The `deepmerge-ts` package has a stack exhaustion vulnerability when merging recursive object graphs. This affects Prisma's **development/build tooling only** (schema parsing, config processing) — not runtime database operations.

---

## Impact Assessment

### ✅ Runtime: Not Affected
- The Prisma **Client** (`@prisma/client`) does not use `deepmerge-ts` at runtime
- No code path exists where user input reaches `deepmerge-ts`
- Database queries and application code are isolated from the vulnerability

### ⚠️ Development: Low Risk
- `prisma` CLI is only used during:
  - Schema generation (`prisma generate`)
  - Migration operations (`prisma migrate`)
  - Studio UI (`prisma studio`)
- Attack surface requires:
  - Malicious schema file modifications **and**
  - Running Prisma CLI commands locally

**Likelihood:** Negligible (requires compromised developer environment)

---

## Fix Available

`npm audit fix --force` proposes:
- Upgrading `prisma` from current to `6.19.3`
- **This is a breaking change** per npm's own output

---

## Decision: Track Only (No Forced Upgrade)

**Rationale:**
1. **No production risk** — vulnerability is in dev tooling, not runtime
2. **Breaking change** — forcing Prisma major version upgrade mid-sprint introduces migration/compatibility risks
3. **Mitigation in place** — developers should not run Prisma commands on untrusted schema files
4. **Upstream fix pending** — Prisma will upgrade `deepmerge-ts` in a future release

**Policy:**
- Monitor Prisma release notes for non-breaking fix
- Upgrade Prisma during next planned dependency maintenance window
- Do NOT run `npm audit fix --force` without explicit approval and testing
- Do NOT block releases or deployments on this advisory

---

## React Router Advisory (False Alarm)

`npm audit` also flags React Router as depending on `deepmerge-ts`, but:
- React Router 7 (current version) does not use `deepmerge-ts` in its dependency tree
- The audit may be picking up a transitive/phantom dependency
- No actual vulnerability in React Router usage

---

## Monitoring

**Check for fix:**
```bash
npm outdated | grep prisma
npm view prisma dependencies.deepmerge-ts
```

**Expected resolution:**
- Prisma upgrades `@prisma/config` to use `deepmerge-ts >=8.0.0`
- npm audit advisory clears automatically

---

## References

- Advisory: https://github.com/advisories/GHSA-ggr8-5vv4-36mx
- Prisma Release Notes: https://github.com/prisma/prisma/releases
- Ship Plan Context: `docs/END_TO_END_SHIP_PLAN.md` Appendix #3

---

**Do NOT:**
- Run `npm audit fix --force` without testing Prisma upgrade path
- Block deployments on this advisory
- Upgrade Prisma outside of planned maintenance windows

**DO:**
- Monitor Prisma releases for non-breaking fix
- Keep Prisma up to date during regular dependency updates
- Report any unusual Prisma CLI behavior during schema operations
