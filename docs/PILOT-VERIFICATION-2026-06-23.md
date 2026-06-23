# Pilot verification smoke test — 2026-06-23

Live: https://tkd.ashbi.ca

**Result: 17 PASS, 0 FAIL**

## Results

| # | Step | Status | Detail |
|---|------|--------|--------|
| 1. GET /api/health | PASS | 200 in {"status":"ok","timestamp":"2026-06-23T16:18:55.100Z"} |
| 2. GET /api/public/tournaments | PASS | 200, 1 tournament(s), first: Test 1 |
| 3. GET /api/public/tournaments/:id/scoreboard (UUID) | PASS | 200, 2 division(s) |
| 4. POST /api/auth/demo | PASS | 200, role=admin, token len=287 |
| 5. GET /api/tournaments (admin) | PASS | 200, 2 tournament(s) |
| 6a. /login renders | PASS | title=Martial Arts Tournament Manager |
| 6b. Demo login + dashboard | PASS | URL=https://tkd.ashbi.ca/ |
| 6c. /tournaments list | PASS | 4 tournament links |
| 6d. Tournament detail + View Public button | PASS | URL=https://tkd.ashbi.ca/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3 |
| 6e. /tournaments/:id/divisions | PASS | URL=https://tkd.ashbi.ca/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3/divisions |
| 6f. Settings tabs work | PASS | setup + rules tabs |
| 6g. /display/:id renders | PASS | heading=Test 1 |
| 6h. Logout flow | PASS | URL after logout=https://tkd.ashbi.ca/login |
| 6i. Public registration E2E | PASS | heading=Registration Complete! |
| 6j. check-registration returns no PII | PASS | 200, body={"registered":true,"confirmationCode":"089aeae5"} |
| 6k. Share link /scoreboard/:slug resolves | PASS | heading=Test 1, slug=_2QMyHeG55Q4WA |
| 7. No console errors during walkthrough | PASS | clean |

## Screenshots

All saved to /tmp/_p11-shots/

## Failures (if any)

_No failures._