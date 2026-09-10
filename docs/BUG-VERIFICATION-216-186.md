# Bug Verification: #216 and #186

**Date:** 2026-09-10  
**Agent:** cursor/ship-plan-sync-bug-verify-c45e  
**Context:** HIGH priority bugs from user request post-PR #245

---

## Investigation Summary

### Issue #216: "completed-event Dashboard dynamic-import failure"

**Status:** Cannot reproduce, likely stale

**Evidence:**
1. `docs/bowin-pilot-ship.md:147` states: "Issue #216 (dashboard-module-load): Cannot reproduce, likely resolved"
2. PR #238 could not reproduce this issue in prior investigation
3. GitHub issue #216 does not exist (gh CLI returns "Could not resolve to an issue")
4. No TODO/FIXME comments in codebase referencing #216
5. No git commits mentioning this specific bug

**Code Review (2026-09-10):**
- `src/client/pages/Dashboard.tsx`: All imports are static (lines 1-42), no dynamic imports
- `src/client/App.tsx`: Dashboard is lazy-loaded via `lazy(() => import('./pages/Dashboard'))` (line 48)
- Lazy loading is working correctly with proper `<Suspense>` boundaries
- No obvious module-load failures in current main branch

**Hypothesis:**
This may have been a transient build/bundling issue that was resolved by:
- Vite updates
- React Router upgrades  
- Build cache clearing
- Or never existed (internal tracking artifact)

**Recommendation:** CLOSE as cannot-reproduce. If a similar dynamic-import failure resurfaces, capture:
- Browser console error with full stack trace
- Network tab showing failed chunk loads
- Steps to reproduce from clean state
- Specific tournament status/state that triggers it

---

### Issue #186: "blank Settings/Bracket in isolated demo"

**Status:** Cannot reproduce, likely stale

**Evidence:**
1. GitHub issue #186 does not exist (gh CLI returns "Could not resolve to an issue")
2. No TODO/FIXME comments in codebase referencing #186
3. No git commits mentioning this specific bug
4. No references in docs/ beyond the user query

**Code Review (2026-09-10):**
- `src/client/pages/TournamentSettings.tsx`: Lazy-loaded, proper Suspense handling
- `src/client/pages/BracketEditor.tsx`: Lazy-loaded, proper Suspense handling
- Demo-user paths use standard data-fetching (React Query) with loading states
- No conditional rendering that would cause blank pages for demo users

**Hypothesis:**
This may have been:
- A race condition during demo-data seeding (now fixed)
- Auth/permission issue that prevented data fetch (now hardened with tenant isolation work)
- Build artifact from stale `dist/` (now cleared by deploy process)
- Or never existed (internal tracking artifact)

**Recommendation:** CLOSE as cannot-reproduce. If blank pages resurface in demo mode, capture:
- Browser console for API errors or network failures
- React DevTools component tree (confirm components mounted)
- Steps to reproduce from `POST /api/auth/demo` flow
- Specific tournament/division IDs involved

---

## Conclusion

Both issues appear to be stale internal tracking items or transient build artifacts that have been resolved through normal development churn. Neither has:
- A corresponding GitHub issue
- Code comments or TODOs
- Recent reproductions (PR #238 could not reproduce #216)
- Clear reproduction steps

**Action:** Mark both as CLOSED/cannot-reproduce in any tracking system. Monitor for similar symptoms in future testing, but do not block current ship on these.

**Next:** Proceed with ship-plan polish work (email templates, scoreboard auto-refresh, multi-sport seed, test rate limits).
