# Accessibility Release Gates (WCAG 2.2 AA)

**Created:** 2026-09-10  
**Owner:** Cameron (camster91)  
**Status:** Slice 1 COMPLETE (PR #278), Slice 2 IN PROGRESS  
**Target:** WCAG 2.2 Level AA conformance for critical user journeys

---

## Overview

This document defines the accessibility (a11y) release gates that Bowin Tournament OS must pass before production deployment. Our goal is WCAG 2.2 Level AA conformance across all critical user journeys, with particular focus on:

1. **Automated testing** via axe-core (baseline)
2. **Keyboard-only navigation** (no mouse/pointer required)
3. **Responsive/zoom resilience** (320px CSS pixels, 200% zoom)
4. **Cross-device usability** (mobile, tablet, desktop)
5. **Reduced motion** support (respects prefers-reduced-motion)

**Important:** GitHub Actions CI is **NOT** a hard ship gate for a11y. VPS production verification is the actual gate. Actions often fail on billing/quota noise — ignore those failures. The human verification checklist below is the real gate.

---

## Slice 1: Axe Baseline + Mobile + Reduced Motion (COMPLETE — PR #278)

### Scope

Four critical surfaces audited with axe-core WCAG 2.2 AA automated checks:

1. **Login** (`/login`, `/verify`)
2. **Public Registration** (`/register/:tournamentId`)
3. **Scorekeeper** (`/tournaments/:id/scorekeeper`)
4. **Public Scoreboard** (`/display/:tournamentId`)

### Coverage

- **Automated axe audits**: All four surfaces pass axe WCAG 2.2 AA with zero violations
- **Viewport**: Mobile Chrome (390×844) baseline coverage
- **Motion preference**: Reduced-motion media query respected
- **Keyboard basics**: Focusable interactive elements, no keyboard traps

### Fixes Shipped (PR #278)

- **Label associations**: Every form input paired with `<label htmlFor>` (Login, Public Reg, Scorekeeper score inputs)
- **ARIA landmarks**: `role="main"`, `role="navigation"`, proper heading hierarchy
- **Error announcements**: `role="alert"` + `aria-live="assertive"` for validation errors
- **Form semantics**: `<fieldset>` + `<legend>` for event selection (Public Reg)
- **Autocomplete hints**: `autocomplete` attributes on personal-info fields (Public Reg)
- **Icon accessibility**: Decorative icons use `aria-hidden="true"`
- **Modal semantics**: `role="dialog"` + `aria-modal="true"` + focus trap (Scorekeeper confirm dialog)
- **Live regions**: `role="status"` + `aria-live="polite"` for SR announcements (Scorekeeper match navigation)
- **Competitor buttons**: `aria-pressed` + descriptive `aria-label` (Scorekeeper winner selection)

### Tests (Slice 1)

- `tests/e2e/public-register-a11y.spec.ts`: 6 tests (label pairing, form name, error alerts, fieldset/legend, autocomplete, empty state)
- `tests/e2e/scorekeeper-a11y.spec.ts`: 8 tests (live region, division list aria-labels, competitor buttons aria-pressed, score input labels, result-type radiogroup, icon-only button aria-labels, arrow-key navigation focus, confirmation modal dialog semantics)

### Verification Checklist (Slice 1)

Before deploying to production VPS, manually verify:

- [ ] **Login flow**: Tab through email field → "Send sign-in link" button → code input → "Verify code" button. No keyboard traps.
- [ ] **Public registration**: Complete a registration using only keyboard (Tab/Shift+Tab/Enter/Space). Form submits successfully.
- [ ] **Scorekeeper**: Navigate divisions list with Tab, select a division with Enter, score a match using keyboard only.
- [ ] **Public scoreboard**: Page loads, bracket is visible, auto-refresh works (no manual interaction needed, but check focus doesn't jump).
- [ ] **Mobile Chrome (390×844)**: All four surfaces render correctly, no horizontal scroll, interactive elements are tappable (44×44px minimum).
- [ ] **Reduced motion**: Set `prefers-reduced-motion: reduce` in browser DevTools → verify animations respect the preference (tour overlay, modals, transitions).

---

## Slice 2: Keyboard-Only Journeys + 320px/Zoom + Expanded Coverage (IN PROGRESS)

### Scope

1. **Keyboard-only journey tests**: Automated Playwright tests that complete critical flows using only keyboard input (Tab/Shift+Tab/Enter/Space/ArrowUp/ArrowDown/Escape/Ctrl+Z as applicable)
2. **320px CSS pixel + 200% zoom tests**: Deterministic viewport/deviceScaleFactor checks for content reflow, no overlapping controls, primary CTAs remain usable
3. **Expand axe coverage**: Add axe audits for Check-in (`/tournaments/:id/checkin`) and Tournament management surfaces (`/tournaments`, `/tournaments/:id`, `/tournaments/:id/settings`) where stable seeded fixtures exist

### Keyboard-Only Journeys (Target: 100% completion without mouse)

#### Login Journey
- [ ] Tab to email field → type email → Tab to "Send sign-in link" → Enter
- [ ] Tab to code input → type 6-digit code → Tab to "Verify code" → Enter
- [ ] Result: Redirects to dashboard, no keyboard traps

#### Public Registration Journey
- [ ] Tab through all Step 1 fields (tournament select, first/last name, gender, DOB, belt, school, height, weight, event checkboxes) → Tab to "Next: Parent & Consent" → Enter
- [ ] Tab through Step 2 fields (parent name, email, phone) → Tab to consent checkbox → Space to check → Tab to "Review & Submit" → Enter
- [ ] Tab through Step 3 review → Tab to "Submit Registration" → Enter
- [ ] Result: Success message appears, confirmation code displayed

#### Scorekeeper Journey
- [ ] Tab to division list → ArrowDown/ArrowUp to select division → Enter to open
- [ ] Tab to competitor 1 button → Enter to select as winner
- [ ] Tab to score input 1 → type score → Tab to score input 2 → type score
- [ ] Tab to "Record Result" → Enter to open confirmation dialog
- [ ] Tab to "Confirm" → Enter to submit
- [ ] Result: Match advances, next match loads
- [ ] Ctrl+Z → Tab to "Undo result" in modal → Enter to undo
- [ ] Result: Match reverts to ready state

#### Check-in Journey (if fixtures allow)
- [ ] Tab to search input → type competitor name → Enter
- [ ] Tab to competitor row → Tab to "Check In" button → Enter
- [ ] Tab to weight input (for sparring) → type weight → Tab to "Confirm" → Enter
- [ ] Result: Competitor marked as checked in

### 320px / 200% Zoom Tests

**320px CSS pixel test** (WCAG 2.2 SC 1.4.10 Reflow):
- Viewport: 320×568 (iPhone SE, smallest common mobile width)
- No horizontal scroll required for any content
- All interactive elements remain tappable (no overlapping buttons)
- Primary CTAs ("Submit", "Confirm", "Record Result") remain visible and usable

**200% zoom test** (WCAG 2.2 SC 1.4.4 Resize Text):
- Viewport: 1280×720 with `deviceScaleFactor: 2` (simulates 200% browser zoom)
- All text remains readable (no truncation, no overlapping)
- Form fields remain usable (labels don't cover inputs)
- Primary CTAs remain clickable (no z-index stacking bugs)

#### Surfaces to Test

1. **Login**: 320px + 200% zoom → email field, code input, buttons remain usable
2. **Public Registration**: 320px + 200% zoom → all three steps render without horizontal scroll, form submits successfully
3. **Scorekeeper**: 320px + 200% zoom → division list, match scoring view, competitor cards don't overlap
4. **Check-in**: 320px + 200% zoom → search bar, competitor list, check-in buttons usable
5. **Tournament Settings**: 200% zoom → settings tabs, form fields, save button visible

### Expanded Axe Coverage

Add axe-core WCAG 2.2 AA audits for:

1. **Check-in** (`/tournaments/:id/checkin`):
   - Search input labeled
   - Competitor rows have accessible names
   - "Check In" buttons have descriptive text (not just "✓")
   - Weight input (sparring) labeled correctly
   - Error states use `role="alert"`

2. **Tournament List** (`/tournaments`):
   - "New Tournament" button accessible
   - Tournament cards have accessible names
   - Status badges have color + text (not color alone)
   - Delete buttons have confirmation (tested in earlier specs, but verify axe passes)

3. **Tournament Settings** (`/tournaments/:id/settings`):
   - Tab navigation works (Settings, Weight Classes, Rules tabs)
   - All form inputs labeled
   - Save button has clear state (enabled/disabled/saving)
   - Error banners use `role="alert"`

**Fixture requirement**: These audits require a logged-in user with at least one seeded tournament + registered competitors. If fixtures are unstable (e.g., empty DB, no tournaments), document the gap and defer coverage to Slice 3.

### Tests (Slice 2)

- `tests/e2e/keyboard-journeys.spec.ts`: 4 journey tests (login, public reg, scorekeeper, check-in if fixtures allow)
- `tests/e2e/viewport-zoom-a11y.spec.ts`: 5 surface tests (login, public reg, scorekeeper, check-in, tournament settings) × 2 modes (320px, 200% zoom)
- `tests/e2e/checkin-a11y.spec.ts`: Axe audit + basic keyboard nav (if fixtures allow)
- `tests/e2e/tournament-management-a11y.spec.ts`: Axe audits for list + detail + settings pages (if fixtures allow)

### Verification Checklist (Slice 2)

Before deploying to production VPS, manually verify:

- [ ] **Login (keyboard-only)**: Complete sign-in flow without touching mouse. Works on macOS Safari, Windows Chrome, Linux Firefox.
- [ ] **Public registration (keyboard-only)**: Complete 3-step registration form without mouse. All checkboxes, dropdowns, inputs reachable via Tab/Shift+Tab.
- [ ] **Scorekeeper (keyboard-only)**: Select division, score a match, confirm result, undo with Ctrl+Z. No mouse needed.
- [ ] **Check-in (keyboard-only)**: Search for competitor, check them in, enter weight for sparring. Keyboard-only flow works.
- [ ] **320px viewport**: Load Login, Public Reg, Scorekeeper, Check-in on real iPhone SE or simulator. No horizontal scroll, all buttons tappable.
- [ ] **200% browser zoom**: Set browser zoom to 200% on 1280×720 desktop window → verify Login, Public Reg, Scorekeeper, Check-in, Tournament Settings don't break (no overlapping text, all buttons clickable).
- [ ] **Axe violations**: Run `npm run test:e2e` locally → verify zero axe violations on Check-in and Tournament management surfaces (if fixtures are present). If fixtures are missing, document the gap.

---

## Slice 3+: Remaining Work (Deferred Until Slice 2 Complete)

After Slice 2 lands, remaining #128 a11y work includes:

1. **Color contrast audits**: Verify all text meets WCAG 2.2 AA contrast ratios (4.5:1 for normal text, 3:1 for large text) on both light and dark themes
2. **Screen reader testing**: Manual verification with NVDA (Windows), JAWS (Windows), VoiceOver (macOS/iOS), TalkBack (Android)
3. **Touch target sizing**: Ensure all interactive elements are ≥44×44px (WCAG 2.2 SC 2.5.5)
4. **Focus indicators**: Verify visible focus rings on all interactive elements (WCAG 2.2 SC 2.4.7)
5. **Heading hierarchy**: Audit all pages for proper `<h1>` → `<h2>` → `<h3>` nesting (WCAG 2.2 SC 1.3.1)
6. **Additional surfaces**: Results page, Schedule page, BracketEditor, DirectorDashboard (day-of command center), PublicRegister parent finder

---

## VPS Verification Workflow (Production Gate)

**Rule**: GitHub Actions CI is NOT the ship gate. VPS production deploy must verify every release.

### Pre-Deploy Verification (Local)

1. **Run automated tests locally**:
   ```bash
   npm run test:e2e -- tests/e2e/*-a11y.spec.ts
   npm run test:e2e -- tests/e2e/keyboard-journeys.spec.ts
   npm run test:e2e -- tests/e2e/viewport-zoom-a11y.spec.ts
   ```
   → All tests pass (zero axe violations, keyboard journeys complete successfully)

2. **Run typecheck + lint**:
   ```bash
   npm run typecheck  # client + server
   npm run lint
   ```
   → Zero errors on touched code

### Post-Deploy Verification (VPS Production)

After deploying to production VPS via `scripts/deploy-production.sh`:

1. **Smoke test critical journeys** (keyboard-only):
   - Login → Dashboard (keyboard-only)
   - Public registration → Submit (keyboard-only)
   - Scorekeeper → Score a match → Confirm (keyboard-only)
   - Check-in → Search → Check in competitor (keyboard-only)

2. **Mobile verification** (real device or simulator):
   - Load Login, Public Reg, Scorekeeper, Check-in on iPhone SE (390×844) or Android (360×640)
   - Verify no horizontal scroll, all buttons tappable

3. **Zoom verification** (desktop browser):
   - Set browser zoom to 200% (Ctrl/Cmd + "+")
   - Verify Login, Public Reg, Scorekeeper, Check-in, Tournament Settings render correctly

4. **Reduced motion** (desktop browser):
   - Set `prefers-reduced-motion: reduce` in DevTools
   - Verify tour overlay, modals, transitions respect the preference

### Rollback Criteria

If any of the following occur during VPS verification, **ROLLBACK IMMEDIATELY**:

- Keyboard trap (user cannot Tab out of a field or modal)
- Broken form submission (keyboard Enter doesn't submit, or Tab skips required fields)
- Horizontal scroll on mobile (320px viewport shows content cutoff)
- Overlapping buttons at 200% zoom (CTAs not clickable)
- Axe violations introduced by this PR (compare before/after violation counts)

Rollback procedure:
```bash
# On VPS (manual):
docker stop taekwondo-tournament
docker rename taekwondo-tournament-rollback taekwondo-tournament
docker start taekwondo-tournament
# Restore DB from backup if migrations were applied:
docker exec -i markup-postgres pg_restore -U markup -d postgres --clean --create < /var/backups/taekwondo/pre-{timestamp}.dump
```

---

## Tools & Resources

- **axe DevTools**: Browser extension for manual audits (https://www.deque.com/axe/devtools/)
- **axe-core**: Automated testing library (https://github.com/dequelabs/axe-core)
- **Playwright accessibility**: https://playwright.dev/docs/accessibility-testing
- **WCAG 2.2**: https://www.w3.org/WAI/WCAG22/quickref/
- **WebAIM**: https://webaim.org/ (contrast checker, screen reader guides)

---

## Status Summary

| Slice | Status | PR | Verification |
|-------|--------|----|-----------------|
| **Slice 1: Axe baseline + mobile + reduced motion** | ✅ COMPLETE | #278 | VPS verified 2026-09-10 |
| **Slice 2: Keyboard journeys + 320px/zoom + expanded coverage** | 🚧 IN PROGRESS | #TBD | Pending |
| **Slice 3+: Color contrast, SR testing, touch targets, remaining surfaces** | ⏸️ DEFERRED | N/A | After Slice 2 |

**Next action**: Complete Slice 2 implementation, run local e2e tests, update this doc with test results, deploy to VPS, verify keyboard journeys + 320px/zoom coverage manually.
