# Tournament Manager — End-to-End User Journey Map

## PHASE 1: SETUP (days/weeks before)

### Step 1: Sign in / Sign up
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/Login.tsx:34-539` + `src/server/routes/auth.ts` |
| **Status** | FULL |
| **Critical Issues** | Email not configured in production — magic links show as dev-mode inline UI (works, but no real email delivery). No traditional password auth; magic link only. Demo login available for instant access. |
| **Effort** | N/A — functional as-is |

### Step 2: Create a Tournament
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/Tournaments.tsx:31-376` + `src/server/routes/tournaments.ts:121-138` |
| **Status** | FULL |
| **Critical Issues** | None — create form with name, date, location, sport profile (taekwondo/karate/judo/wrestling/BJJ). Creates tournament in `draft` status. |
| **Effort** | N/A |

### Step 3: Configure Tournament Rules
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/TournamentSettings.tsx:75-599` + `src/server/routes/tournaments.ts:141+` |
| **Status** | FULL |
| **Critical Issues** | Age groups editor (add/remove/modify ranges), weight classes editor (with default loading), and full TournamentRulesEditor v2 rules engine. Uses tournament `settings` JSON field. |
| **Effort** | N/A |

### Step 4: Set Up Divisions
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/Divisions.tsx:75-786` + `src/server/routes/divisions.ts:189-270` |
| **Status** | FULL |
| **Critical Issues** | Auto-generate runs the `categorization-engine.ts` which respects tournament rules (CB/BB tiers, 8 age bands, weight classes). Preview before generation. Division threshold controls split. Assignments appear to be automatic from auto-categorization (no manual step visible). |
| **Effort** | N/A |

### Step 5: Set Tournament Status to "Registration"
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/TournamentDetail.tsx:403-484` (updateStatusMutation) |
| **Status** | FULL |
| **Critical Issues** | Status transitions: `draft` → `registration` (open) → `brackets`/`in_progress` → `completed`. Registration URL is generated and copyable. Reopen and close registration buttons work. |
| **Effort** | N/A |

---

## PHASE 2: REGISTRATION (weeks before)

### Step 6: Share the Public Registration Link
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/TournamentDetail.tsx:189,403-428` |
| **Status** | FULL |
| **Critical Issues** | Registration URL format: `{origin}/register?tournament={id}`. Copy link button present. Only works when tournament status is `registration`. |
| **Effort** | N/A |

### Step 7: Parents Register via Public Form
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/PublicRegister.tsx:55-703` + `src/server/routes/public.ts:77-262` |
| **Status** | FULL |
| **Critical Issues** | 2-step form (athlete info → parent/consent). Minor detection for under-18 forces parent contact fields. Creates competitor + registration. Deduplicates by name+DOB. Tournament selector only shows `status=registration` + future tournaments. Confirmation page shown on success. |
| **Effort** | N/A |

### Step 8: Manager Imports from Excel
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/Competitors.tsx` + `src/server/routes/competitors.ts:367-377` |
| **Status** | FULL |
| **Critical Issues** | Template download (`GET /api/competitors/template`), auto-mapping (`POST /api/competitors/auto-map`), import (`POST /api/competitors/import`). Full `excel-import.ts` service with column mapping. |
| **Effort** | N/A |

### Step 9: Manager Assigns Competitors to Divisions
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/Divisions.tsx` (auto-generate creates assignments) + `src/server/routes/divisions.ts:422-453` |
| **Status** | PARTIAL |
| **Critical Issues** | Auto-generate creates DivisionAssignments automatically. Manual assign endpoint exists (`POST /api/divisions/:id/assign`) but no UI for manual assignment — competitors are assigned by the categorization engine, not manually. The Divisions page shows competitor counts per division but doesn't allow adding/removing competitors from a division. This is a gap if auto-categorization misplaces someone. |
| **Effort** | 2-4 hrs — would need an "Add Competitor" modal on the Divisions page |

### Step 10: Manager Generates Brackets
| Aspect | Detail |
|--------|--------|
| **File** | `src/server/routes/brackets.ts:40-139` + `src/client/pages/Divisions.tsx:144-161` |
| **Status** | FULL |
| **Critical Issues** | `POST /api/brackets/division/:id/generate` supports `double_elim`, `single_elim`, `round_robin`, `pool_play` formats. Seeding strategy configurable. `handleByeMatches` auto-resolves byes. `advanceWinner` auto-advances winners. All brackets can be generated at once via `POST /api/brackets/tournament/:id/generate-all`. |
| **Effort** | N/A |

### Step 11: Manager Reviews/Reseds Brackets
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/BracketEditor.tsx:68-480` + `src/server/routes/brackets.ts:263-287,303-350` |
| **Status** | FULL |
| **Critical Issues** | BracketEditor shows visual bracket with clickable competitors to record winners. Reseed button (re-generates bracket, resets all results). Swap endpoint (`POST /api/brackets/match/:id/swap`). Undo endpoint (`POST /api/brackets/match/:id/undo`). Match audit log. |
| **Effort** | N/A |

---

## PHASE 3: TOURNAMENT DAY

### Step 12: Manager Opens Day-of Dashboard
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/DirectorDashboard.tsx:82-515` + `src/server/routes/tournaments.ts` (schedule) |
| **Status** | FULL |
| **Critical Issues** | Shows ring status (active/idle/completed), division progress, match counts, estimated time remaining, warnings (idle rings, long matches, divisions without brackets). Polls every 10s. Links to scorekeeper, schedule, divisions. |
| **Effort** | N/A |

### Step 13: Competitors Check In
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/CheckIn.tsx:48-532` + `src/server/routes/tournaments.ts:200+` |
| **Status** | FULL |
| **Critical Issues** | Search by name/school, filters (status, event, school), sort options. Bulk check-in for non-sparring competitors. Individual check-in with weigh-in modal for sparring (weight difference warning if >2 lbs from registration). Undo check-in. Polls every 5s. Progress bar and stats. |
| **Effort** | N/A |

### Step 14: Scorekeeper Opens Scorekeeper View
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/Scorekeeper.tsx:61-749` + `src/server/routes/brackets.ts:166-225` |
| **Status** | FULL |
| **Critical Issues** | Division selector with ready/pending counts. Match timer component for sparring (`MatchTimer.tsx`). Keyboard shortcuts (1/2 for competitors, arrows for navigation, w/d/f/i for result types). Penalty controls per competitor. Polls every 10s. |
| **Effort** | N/A |

### Step 15: Scorekeeper Records Match Results
| Aspect | Detail |
|--------|--------|
| **File** | `src/server/routes/brackets.ts:166-225` |
| **Status** | FULL |
| **Critical Issues** | `PUT /api/brackets/match/:id` with winnerId, score1, score2, status, notes. Creates `MatchAuditLog` entry. Penalty notes appended to notes field. Handles DQ/forfeit/injury result types. |
| **Effort** | N/A |

### Step 16: Bracket Auto-Advances Winners
| Aspect | Detail |
|--------|--------|
| **File** | `src/server/services/match-advancement.ts` |
| **Status** | FULL |
| **Critical Issues** | `advanceWinner` called after each match completion. Handles double-elimination bracket structure (winners → next winners round, losers → losers bracket, final matchup). Bye matches auto-resolved. |
| **Effort** | N/A |

### Step 17: Public TV Scoreboard — NOW COMPETING + UP NEXT
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/PublicScoreboard.tsx:47-442` + `src/server/routes/public.ts:264-307` |
| **Status** | FULL |
| **Critical Issues** | TV-optimized dark theme. "NOW COMPETING" hero section (amber highlight, live match). "UP NEXT" queue (8 ready matches sorted by scheduledTime). Auto-cycles through rings every 12s. Ring filter tabs. Progress bar. Polls every 3s. Division status grid. |
| **Effort** | N/A |

### Step 18: Spectators View Public Scoreboard
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/PublicScoreboard.tsx` (unauthenticated) + `src/server/routes/public.ts:264-307` |
| **Status** | FULL |
| **Critical Issues** | Public endpoint (`/api/public/tournaments/:id/scoreboard`) — no auth required. Works from any device with the URL. Shows recent results with winner/loser names and scores. |
| **Effort** | N/A |

---

## PHASE 4: WRAP-UP

### Step 19: Manager Views Final Results / Standings / Medals
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/Results.tsx:82-862` + `src/server/routes/brackets.ts:227-260` |
| **Status** | FULL |
| **Critical Issues** | School standings (gold/silver/bronze counts, sorted). Breakdown by belt level and age group. View modes: schools / divisions / breakdown. Division selector with event filter. Medal icons for placements. |
| **Effort** | N/A |

### Step 20: Manager Exports Bracket PDFs
| Aspect | Detail |
|--------|--------|
| **File** | `src/server/routes/brackets.ts:443-610+` + `src/server/services/pdf-export.ts` |
| **Status** | FULL |
| **Critical Issues** | `GET /api/brackets/tournament/:id/pdf` for batch PDF. `GET /api/brackets/division/:id/pdf` for single bracket. `generateBatchBracketsPDF` in pdf-export. Results PDF via `GET /api/brackets/tournament/:id/results/pdf`. Certificates via `GET /api/brackets/tournament/:id/certificates`. |
| **Effort** | N/A |

### Step 21: Manager Exports Competitor Data
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/Results.tsx:316-392` (exportExcel function) |
| **Status** | FULL |
| **Critical Issues** | CSV export (schools, results by division, competitors by competitor). Excel multi-sheet export (School Standings, By Division, By Belt Level, By Age Group). Client-side generation using SheetJS (`xlsx`). |
| **Effort** | N/A |

### Step 22: Archive Tournament (status → completed)
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/TournamentDetail.tsx:445-468` |
| **Status** | FULL |
| **Critical Issues** | "Mark Completed" button sets status to `completed`. Can be reopened. Completed tournaments shown in separate "Past Tournaments" section on Tournaments list. |
| **Effort** | N/A |

### Step 23: Audit Trail / User Management
| Aspect | Detail |
|--------|--------|
| **File** | `src/client/pages/UserManagement.tsx:63-692` + `src/server/routes/auth.ts` + `src/server/routes/invites.ts` |
| **Status** | FULL |
| **Critical Issues** | User list with role badges (admin/director/scorekeeper/viewer). Role editing inline. Active/disabled toggle. Invitation system (send invite, resend, cancel). Pending invitations list. Audit trail via `MatchAuditLog` (visible through bracket/match undo). No global audit log page, but match-level audit exists. |
| **Effort** | N/A |

---

## SUMMARY

### Minimum Viable Flow (MUST WORK to run a real tournament)

To run a real tournament from start to finish, these steps are **non-negotiable**:

1. **Sign in** (Step 1) — Demo login works, magic link needs email configured in production
2. **Create tournament** (Step 2) — Fully works
3. **Register competitors** (Steps 7+8) — Public form works; Excel import works
4. **Generate divisions** (Step 4) — Auto-generate works
5. **Generate brackets** (Step 10) — Works for all formats
6. **Check-in** (Step 13) — Works fully
7. **Scorekeeping** (Steps 14-16) — Works; bracket auto-advances
8. **Results view** (Step 19) — Works
9. **Export PDFs** (Step 20) — Works

**Skippable for MVP:**
- Step 3 (rules config) — defaults work fine
- Step 6 (share link) — manual告知也可以
- Step 9 (manual division assignment) — auto-categorization handles it
- Step 11 (bracket review/reseed) — rarely needed on day-of
- Step 17-18 (public scoreboard) — nice to have but not required for running the event
- Step 21 (competitor data export) — results page has this
- Step 23 (user management) — irrelevant for single-director tournaments

### Steps with Biggest Gaps

**Gap 1 — Step 9 (Manual Division Assignment): PARTIAL**
Auto-categorization assigns competitors to divisions, but there's **no UI to manually reassign a competitor** if the categorization misplaces them. The API has `POST /api/divisions/:id/assign` and `POST /api/divisions/:id/move` but no UI for it. This could cause real problems if a kid is in the wrong division.

**Gap 2 — Step 3 (Tournament Rules): FULL but complex**
The `TournamentRulesEditor` component drives the categorization engine, but it's a complex rules object. Understanding exactly what it does requires reading `tournament-rules.ts` and `categorization-engine.ts`. The defaults are reasonable but customizing requires deep knowledge.

**Gap 3 — Step 23 (Audit Trail): FULL but limited**
`MatchAuditLog` exists per match, but there's **no page to browse the full audit trail** across the tournament. User management (Step 23) is fully implemented but the global audit log (who did what, when) isn't surfaced in the UI.

### Suggested 5-Agent Split (for deepest testing)

Based on leverage and gap depth:

**Agent 1 — Registration Flow (Steps 6-9)**
Tests: Public registration form, Excel import, bulk registration, competitor deduplication, division assignment (auto). File issues on the manual assignment gap (Step 9 has no UI).

**Agent 2 — Tournament Day Operations (Steps 12-16)**
Tests: Director dashboard accuracy, check-in flow, scorekeeper view, match result recording, bracket auto-advancement. File issues on real-time data consistency.

**Agent 3 — Public Scoreboard (Steps 17-18)**
Tests: TV mode rendering, ring auto-cycling, "NOW COMPETING" detection, "UP NEXT" accuracy, recent results, score display. File issues on polling reliability and edge cases.

**Agent 4 — Bracket Generation + PDF Export (Steps 10-11, 20)**
Tests: All bracket formats (double elim, single elim, round robin, pool play), bye handling, bracket visualization, PDF export quality, certificate generation. File issues on bracket display accuracy.

**Agent 5 — Results + Wrap-up (Steps 19, 21-22)**
Tests: Results page accuracy, school standings calculations, CSV/Excel export correctness, tournament archival. File issues on data completeness after bracket completion.

### Known Critical Bugs to Flag

1. **TournamentDetail crashes with React error #31** — occurs when tournament status is not `draft` and `DayOfPanel` component renders. DayOfPanel is rendered conditionally at line 399 but there may be a rendering bug in that component.

2. **Email not configured in production** — magic link auth falls back to dev-mode inline UI. Production deployments need SMTP configured via `email.ts` service.

3. **Division assignment has no manual override UI** — competitors auto-assigned but no way to fix misplacements without direct DB access.