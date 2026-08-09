# Legendary Bowin Product Roadmap

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make Bowin the most trusted, understandable, and operationally calm tournament-day platform for independent Taekwondo schools and regional events.

**Architecture:** Preserve the React/Vite, Express, Prisma, PostgreSQL, and Docker foundation. Build differentiation through isolated demo environments, deterministic tournament operations, observable offline resilience, and an explainable recommendation engine that never silently changes brackets, schedules, divisions, or results.

**Tech Stack:** React, TypeScript, TanStack Query, Express, Prisma, PostgreSQL 16, Playwright, Vitest, Docker, service worker/PWA APIs.

---

## Product north star

Bowin should let a first-time director run a tournament confidently without needing a spreadsheet expert, a dedicated IT operator, or undocumented tribal knowledge.

The product wins when directors can answer these questions immediately:

1. What needs my attention now?
2. What happens if I approve this change?
3. Can I undo it safely?
4. Is every ring, athlete, and parent seeing truthful information?
5. Will the system keep working when venue Wi-Fi fails?

## Market position

Initial category: **Tournament-day operating system for independent Taekwondo schools and regional events.**

Primary promise: **From registration to final medal, Bowin keeps every ring moving and every decision explainable.**

Do not lead with generic AI. Lead with operational reliability, then demonstrate AI through useful recommendations with evidence, confirmation, audit history, and undo.

## Release gates

| Gate | Outcome | Exit evidence |
|---|---|---|
| 1. Legendary demo | Any prospect can complete the showcase without interference | 10 concurrent isolated sessions; complete fabricated lifecycle; no shared logout or 429 lockout |
| 2. Tournament-day trust | Directors can recover from ordinary mistakes and connectivity loss | full rehearsal, offline reload, conflict recovery, printed fallback, restore drill |
| 3. Experience polish | Critical journeys feel coherent on phone, tablet, laptop, and venue TV | WCAG 2.2 AA audit; physical-device matrix; no contradictory or silent states |
| 4. Explainable intelligence | AI reduces work without becoming a source of truth | recommendation explanations, confidence, approval, audit log, deterministic fallback |
| 5. Commercial maturity | A customer can buy, onboard, operate, and receive support | billing, legal approval, support SLA, monitoring, analytics, three successful pilots |
| 6. Global readiness | Multi-language and multi-timezone events work predictably | locale matrix, timezone tests, regional rulesets, translated critical journeys |

---

## Phase 1: Build a legendary, isolated demo

### Task 1: Separate demo traffic from authentication security controls

**Objective:** Keep magic-link brute-force protection strict while allowing legitimate concurrent demos.

**Files:**
- Modify: `src/server/routes/auth.ts`
- Test: `src/server/routes/auth.test.ts`
- Test: `tests/e2e/login.spec.ts`

**Steps:**
1. Write failing tests proving demo and magic-link requests use independent rate-limit buckets.
2. Write a failing test proving a sixth demo visitor does not lock out magic-link authentication.
3. Add a dedicated demo limiter with environment-configurable capacity.
4. Return machine-readable `retryAfterSeconds` on `429` responses.
5. Run focused tests, then `npm test` and `npm run typecheck`.

**Acceptance:** Ten simultaneous demo entries behind one IP succeed; abusive bursts still receive `429`; magic-link protection is unchanged.

### Task 2: Give every demo visitor an isolated session

**Objective:** Prevent one visitor from seeing or invalidating another visitor's demo session.

**Files:**
- Modify: `src/server/routes/auth.ts`
- Modify: `prisma/schema.prisma` only if ephemeral demo ownership requires persistence
- Create migration only if the schema changes
- Test: `src/server/routes/auth.test.ts`
- Test: `tests/e2e/login.spec.ts`

**Steps:**
1. Write a failing two-context test where visitor A logs out while visitor B stays authenticated.
2. Replace the shared demo principal with per-session demo identities or demo-specific logout behavior.
3. Scope every demo identity to synthetic data only.
4. Add expiry and cleanup tests.
5. Verify concurrent Chromium contexts and cross-browser sessions.

**Acceptance:** Demo logout affects only the initiating session; no demo session can reach customer tenants or non-demo users.

### Task 3: Create a resettable showcase tournament

**Objective:** Make every product surface demonstrable within five minutes.

**Files:**
- Create: `prisma/demo-seed.ts`
- Create: `scripts/reset-demo.ts`
- Modify: `package.json`
- Modify: staging deployment configuration
- Test: `tests/e2e/demo-lifecycle.spec.ts`

**Fixture:**
- clearly named synthetic tournament;
- open public registration and management token;
- four schools and realistic Unicode names;
- checked and unchecked competitors;
- patterns and sparring divisions;
- one small double-elimination bracket and one larger bracket;
- four rings with ready, active, delayed, and completed matches;
- public slug, parent scoreboard, incidents, results, and certificates.

**Acceptance:** Reset is idempotent, touches only the demo tenant, and restores the showcase in under two minutes. The lifecycle test covers registration through published results.

### Task 4: Turn demo entry into a guided story

**Objective:** Help evaluators experience the product in the right order without reading documentation.

**Files:**
- Modify: `src/client/pages/Login.tsx`
- Modify: `src/client/pages/Dashboard.tsx`
- Create: `src/client/components/demo/DemoGuide.tsx`
- Create: `src/client/utils/demo-progress.ts`
- Test: corresponding Vitest files and `tests/e2e/demo-lifecycle.spec.ts`

**Experience:** A dismissible guide offers Director, Scorekeeper, Check-in, Parent, and Venue Display paths. Each path states what is fabricated, what can be changed, and how to reset it.

**Acceptance:** A new evaluator reaches a meaningful live screen in two clicks and can restart the tour without support.

---

## Phase 2: Make tournament-day operations exceptionally trustworthy

### Task 5: Cache the offline application shell

**Objective:** Allow previously authenticated staff to reopen critical tooling during an outage.

**Files:**
- Create: `public/sw.js` or adopt a reviewed Vite PWA integration
- Modify: `src/client/main.tsx`
- Modify: `src/client/hooks/useOfflineOperations.ts`
- Test: `tests/e2e/offline-reload.spec.ts`

**Acceptance:** Check-in and scorekeeper reopen after an offline refresh, clearly show cached/stale state, queue changes, and reconcile conflicts after reconnecting. No private API response is cached indiscriminately.

### Task 6: Build one universal operation-status model

**Objective:** Eliminate silent, contradictory, or misleading loading/error/offline states.

**Files:**
- Modify: `src/client/context/ToastContext.tsx`
- Create: `src/client/components/ui/OperationStatus.tsx`
- Modify: public scoreboard, parent scoreboard, registration, check-in, scorekeeper, settings, and exports pages
- Test: component tests and route-specific E2E cases

**Acceptance:** Every critical mutation exposes pending, saved, queued, retrying, rejected, and resolved states; anonymous users never receive session-expired messaging without evidence of a prior session.

### Task 7: Add a tournament command centre

**Objective:** Give directors a prioritized operational view rather than a collection of navigation cards.

**Files:**
- Modify: `src/client/pages/DirectorDashboard.tsx`
- Create: `src/server/services/tournament-attention.ts`
- Add API route under the tournament routes
- Test: service, API, and E2E tests

**Signals:** unchecked athletes in soon-to-start divisions, ring delay, schedule conflicts, incomplete division data, unresolved incidents, offline queues requiring review, stale public displays, and divisions blocked from starting.

**Acceptance:** Every alert has severity, explanation, affected records, recommended action, and direct navigation.

### Task 8: Make every correction safe and auditable

**Objective:** Normalize preview, confirm, audit, and undo across high-risk operations.

**Scope:** scoring corrections, bracket regeneration, division reassignment, schedule regeneration, tournament deletion, public-link rotation, and bulk check-in.

**Acceptance:** No destructive or bracket-affecting operation occurs without an impact preview; reversible actions expose undo; irreversible actions explain why they cannot be reversed.

---

## Phase 3: Deliver top-tier UX and accessibility

### Task 9: Complete the critical-journey design system migration

**Objective:** Make the product feel like one coherent system.

**Files:**
- Extend components under `src/client/components/ui/`
- Migrate Login, Dashboard, Tournament Detail, Director Dashboard, Check-in, Scorekeeper, Results, Public Registration, and both scoreboards
- Update `src/client/index.css`

**Acceptance:** Consistent page headers, action hierarchy, form errors, loading states, modal behavior, touch targets, spacing, typography, and dark mode.

### Task 10: Pass a real WCAG 2.2 AA and device matrix

**Objective:** Verify accessibility beyond automated DOM checks.

**Coverage:** NVDA/Windows, VoiceOver/iOS, Android TalkBack, keyboard-only desktop, 200% and 400% zoom, reduced motion, high contrast, 390/768/1024/1440/1920 widths, and venue TV.

**Acceptance:** No critical journey contains missing headings, unnamed controls, focus loss, keyboard traps, target-size failures, or status changes unavailable to assistive technology.

### Task 11: Make the public experience a product advantage

**Objective:** Give parents and schools a polished, low-anxiety live experience.

**Features:** searchable athlete/division view, clear delay/status language, saved favorites, QR sharing, local-time schedule, accessible live updates, school view, and graceful revoked/expired-link states.

**Acceptance:** A parent can find an athlete and understand where and when they compete without logging in or asking staff.

---

## Phase 4: Add explainable AI that earns trust

### Task 12: Establish the recommendation contract

**Objective:** Ensure AI cannot become an unreviewed system of record.

**Required fields:** recommendation type, input snapshot, explanation, constraints considered, confidence, warnings, proposed diff, deterministic validation result, approval identity, timestamp, applied result, and undo reference.

**Rules:** AI may propose; deterministic domain services validate; a human approves; the audit log records; the user can undo where safe.

### Task 13: Build the division recommendation assistant

**Objective:** Suggest safe merges, splits, and exception handling for incomplete or sparse categories.

**Files:**
- Extend: `src/server/services/categorization-engine.ts`
- Create: `src/server/services/division-recommendations.ts`
- Create director review UI under `src/client/pages/Divisions.tsx`
- Add deterministic fixture and adversarial tests

**Acceptance:** Recommendations never silently move pinned competitors, never invent missing age/weight, explain every constraint, and require explicit approval.

### Task 14: Build the schedule optimizer and live delay assistant

**Objective:** Reduce conflicts and keep rings balanced during the event.

**Inputs:** registration identity, division duration, ring eligibility, school/coach conflicts, rest windows, current completion pace, incidents, and manual locks.

**Acceptance:** The system proposes a measurable improvement, shows the before/after schedule, preserves manual locks, and lets the director reject or undo the change.

### Task 15: Add natural-language operational queries

**Objective:** Let directors ask questions without allowing free-form mutation.

**Examples:** “Which divisions are blocked?”, “Who competes in the next 20 minutes?”, “Why is Ring 3 late?”, and “Which schools need to check in?”

**Acceptance:** Answers cite live records and timestamps, respect tenant authorization, clearly mark uncertainty, and provide links rather than executing changes.

---

## Phase 5: Commercial and global maturity

### Task 16: Complete the customer lifecycle

Implement verified checkout, invoices, taxes, refunds, dunning, cancellation, entitlement changes, trial conversion, data export, and deletion. Finalize legal documents with qualified review before general availability.

### Task 17: Add club, staff, and communications operations

Build bulk club registration, coach conflict visibility, referee/volunteer assignments, invitation lifecycle, email templates, delivery history, incident escalation, and support/status surfaces.

### Task 18: Internationalize critical journeys

Externalize UI strings; use locale-aware dates, timezones, numbers, and weights; support translated legal versions and per-event language. Begin with English and French for the Canadian market before expanding.

### Task 19: Prove operational readiness

Configure encrypted automated backups, restore drills, uptime/error monitoring, alert delivery, log retention, capacity tests, security review, incident runbooks, and a named on-call owner.

### Task 20: Run the pilot ladder

1. Internal fabricated rehearsal.
2. One invite-only school rehearsal.
3. Three supervised paid regional events.
4. Retrospective and reliability report after each event.
5. General availability only after no unresolved scoring, bracket, privacy, or recovery incident remains.

---

## Success metrics

- Demo completion rate: at least 80% without staff assistance.
- Time to first tournament: under 10 minutes.
- Check-in throughput: under 20 seconds per athlete at the median.
- Score submission acknowledgement: under 1 second on healthy venue Wi-Fi.
- Recoverable scoring conflicts: 100%; unrecoverable result loss: zero.
- Public display freshness: under 5 seconds when online, visibly stale when not.
- Director intervention: fewer than five manual recovery actions per 100 matches.
- Support burden: fewer than two urgent contacts per tournament.
- Accessibility: zero critical WCAG failures in critical journeys.
- Reliability: 99.9% monthly service availability after general availability.

## Immediate execution order

1. Tasks 1–3: isolated demo and complete fabricated data.
2. Tasks 4 and 6: guided experience and truthful status handling.
3. Tasks 5, 7, and 8: offline recovery, command centre, and correction safety.
4. Tasks 9–11: design-system, accessibility, and public experience polish.
5. Tasks 12–14: explainable division and scheduling intelligence.
6. Tasks 16–20: commercial, global, operational, and pilot readiness.

## Explicit non-goals for the first release

- Generic chatbot on every page.
- Autonomous bracket, score, or schedule mutation.
- Native mobile applications before the PWA is proven.
- Federation-wide rankings or certification claims.
- Supporting every combat sport before Taekwondo is excellent.
- Unsupervised general availability before the pilot ladder passes.

## Verification commands for every implementation batch

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Run Playwright against a disposable PostgreSQL database in Chromium, Firefox, and WebKit. Deploy to isolated staging with fabricated data, complete the relevant rehearsal, and preserve an immutable rollback image before production promotion.
