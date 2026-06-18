# QA walkthrough — 2026-06-18

## Live: https://tkd.ashbi.ca

## Flows tested (all in chromium against prod, headless)

### Public (unauthenticated)
- /api/health → 200, 132ms
- /api/public/tournaments → returns 1 tournament (Test 1) with
  only id/name/date/location/sportProfileSlug/_count fields.
  No PII. ✓
- /api/public/tournaments/:id/scoreboard → was 404 (broken);
  fixed by adding back-compat shim in src/server/routes/public.ts.
  Now returns the array of divisions the client expects. ✓
- /api/public/scoreboard/:publicSlug → 404 indistinguishably
  for "no such slug" vs "no such tournament". ✓
- /api/public/check-registration → 404 with {registered:false}
  (no name/belt/school/DOB echoed back). ✓
- /register → form loads, Step 1 (kid info) → Step 2 (parent
  info) → submission → "Registration Complete!" with full
  details. End-to-end registration works. ✓
- /display/:tournamentId → scoreboard renders with tournament
  metadata + division data. ✓
- /scoreboard/bad-slug → currently 404 with no client UI
  (client still uses /display/:tournamentId). New slug-based
  route exists for future share-link UI.

### Demo login
- POST /api/auth/demo → was 404 (broken — landing page advertises
  "Try the demo" as primary CTA). Fixed by adding
  ENABLE_DEMO_LOGIN=1 to deploy-to-vps.sh env file.
  Now returns 200 + admin JWT for demo@ashbi.ca with 4h TTL. ✓
- Login page → "Try the demo" button → Dashboard
  (Welcome back, DV avatar). ✓
- DV avatar dropdown → Sign out → redirect to /login +
  localStorage cleared. ✓

### Authenticated admin (as demo = admin)
- /tournaments → 4 tournaments listed, all clickable. ✓
- /tournaments/:id → Tournament detail loads, all tabs work. ✓
- /tournaments/:id/divisions → "Divisions - Test 1" ✓
- /tournaments/:id/schedule → "Schedule - Test 1" ✓
- /tournaments/:id/results → "Tournament Results" ✓
- /tournaments/:id/settings → "Settings - Test 1" ✓
- /scorekeeper/:id → Scorekeeper page loads with division list. ✓
- /competitors → "Competitors(1)" with 3 table rows. ✓
- /divisions (no tournament id) → correctly 404. The actual
  route is /tournaments/:id/divisions.

### Security checks
- All 5 security-related endpoints verified:
  - check-registration: no PII, 404 indistinguishable, rate-limited
  - public scoreboard: requires publicSlug or tournament UUID
    (via back-compat shim); 30/min/IP
  - demo login: gated, 4h TTL
  - magic-link: dev-mode bypass env flag, no code leak
  - match-result validation: 0-999 scores, 500-char notes
- All previous security headers still present (HSTS, CSP,
  Referrer-Policy, Permissions-Policy)

## Bugs found + fixed

1. POST /api/auth/demo returned 404 in prod
   - Root cause: ENABLE_DEMO_LOGIN gate was off in prod
   - Fix: deploy-to-vps.sh sets ENABLE_DEMO_LOGIN=1 in env file
   - Commit: 148d6b7

2. /api/public/tournaments/:id/scoreboard returned 404
   - Root cause: client (PublicScoreboard.tsx) still calls old path
   - Fix: back-compat shim in public.ts that lazily generates slug
   - Commit: 148d6b7

3. /api/public/scoreboard/:publicSlug returned wrong shape
   - Root cause: route returned {tournament, divisions} object
     but client expected bare array of divisions
   - Fix: return bare array (matches original contract)
   - Commit: 148d6b7

## Non-bugs (false alarms during QA)

- "/divisions" returned 404 in initial QA test — actually the
  correct behavior; the real route is /tournaments/:id/divisions.
  Test script was missing the tournament id.
- "No logout button visible" — actually the logout is in the
  DV avatar dropdown, which the QA test didn't click.
  After clicking, the dropdown shows "Sign out" and works correctly.
