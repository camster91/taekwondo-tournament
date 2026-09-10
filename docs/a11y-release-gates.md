# Accessibility Release Gates

This document defines the accessibility (a11y) compliance gates that **MUST** pass before any release affecting critical user journeys: Login, Public Registration, Scorekeeper, and Public Scoreboard.

## Compliance Target

**WCAG 2.2 Level AA** across desktop and mobile viewports.

---

## Automated Gates

### 1. Axe-core Violations (Zero Tolerance)

Run the full Playwright test suite including a11y specs:

```bash
npm run test:e2e
```

**Gate:** All axe-core scans in the following specs must report **zero violations**:

- `tests/e2e/login.spec.ts` — "axe scan on login page"
- `tests/e2e/public-register-a11y.spec.ts` — all 3 axe scan tests (step 1 empty, step 1 with tournament, step 2)
- `tests/e2e/scorekeeper-a11y.spec.ts` — both axe scan tests (division list, match view)
- `tests/e2e/public-scoreboard-a11y.spec.ts` — "public scoreboard renders with semantic HTML and is scannable"

**If any axe test fails:** The release is blocked until violations are fixed.

### 2. Cross-Device Test Coverage

The Playwright config includes 4 browser projects:

- `chromium` (Desktop Chrome)
- `firefox` (Desktop Firefox)
- `webkit` (Desktop Safari)
- `mobile-chrome` (Pixel 5: 393×851 logical px, 44px+ touch targets validated)

**Gate:** All a11y tests must pass on **at least** the `chromium` and `mobile-chrome` projects.

Run a specific project:
```bash
npx playwright test --project=mobile-chrome tests/e2e/*-a11y.spec.ts
```

---

## Manual Screen Reader Smoke Tests

Automated tools catch ~30–50% of real a11y issues. Before shipping UI changes to critical journeys, perform these **5-minute manual checks** using a real screen reader.

### Recommended Tools

- **macOS:** VoiceOver (built-in; Cmd+F5 to toggle)
- **iOS:** VoiceOver (Settings → Accessibility → VoiceOver)
- **Android:** TalkBack (Settings → Accessibility → TalkBack)
- **Windows:** NVDA (free; https://www.nvaccess.org/download/)

### Test Matrix (Pick ONE per release)

For each critical journey, verify **one** of the following:

| Journey | Platform | SR | Duration | Pass Criteria |
|---------|----------|----|---------:|---------------|
| Login | macOS + Chrome | VoiceOver | 2 min | Email input, code input, submit button all announced; form submission success navigates to dashboard |
| Public Registration | iOS Safari | VoiceOver | 3 min | Tournament select, all step-1 fields, "Next" button, step-2 parent fields, submit button all announced; validation errors announced in live region |
| Scorekeeper | macOS + Chrome | VoiceOver | 3 min | Division list buttons announced with state ("X ready"), match navigation (arrow keys announce new match), score inputs announced, confirm dialog focus trap works |
| Public Scoreboard | Android + Chrome | TalkBack | 2 min | Tournament name, division headings, bracket structure navigable; match results readable |

### Pass Criteria (All Journeys)

1. **Forms:** Every input has an accessible label (announced when focused).
2. **Buttons:** Every button announces its label and role.
3. **Errors:** Validation errors are announced immediately (aria-live).
4. **Navigation:** Tab/arrow-key navigation reaches all interactive elements in logical order.
5. **Dialogs:** Focus is trapped inside modals; Escape closes them; focus returns to trigger on close.
6. **Dynamic updates:** Live regions announce status changes (e.g., "Match result recorded").

**If any criterion fails:** File a GitHub issue with `[a11y]` prefix, label as `P0`, and block the release until fixed.

---

## Reduced Motion

Users with `prefers-reduced-motion: reduce` must not experience distracting or infinite animations.

**Gate:** Load any critical journey in Chrome DevTools with "Emulate CSS media feature prefers-reduced-motion" enabled.

1. Open DevTools → Command Palette (Cmd+Shift+P) → "Show Rendering"
2. Check "Emulate CSS media feature prefers-reduced-motion"
3. Reload the page

**Pass:** Animations are either eliminated or reduced to <50ms (instant feel). No infinite shimmer/spinner loops without a hard stop.

**Implementation:** The global `@media (prefers-reduced-motion: reduce)` rule in `src/client/index.css` already covers this. Verify no new CSS animations bypass it.

---

## Touch Target Size (Mobile)

**WCAG 2.5.5 (AAA) / 2.5.8 (AA in WCAG 2.2):** Interactive targets must be at least **44×44 CSS pixels** on mobile.

**Gate:** All primary CTAs (submit buttons, navigation, scorekeeper actions) use our component library defaults:

- `<Button size="md">` → 44px height ✓
- `<IconButton size="md">` → 44×44px on mobile ✓

**Spot-check:** Open the mobile-chrome Playwright project and visually inspect:
- Public Registration submit buttons (step 1 "Next", step 2 "Submit")
- Scorekeeper division buttons, arrow navigation, "Record Result"
- Login "Send sign-in link" / "Verify code"

If a new button uses `size="sm"` (36px) for a primary action, change to `size="md"`.

---

## Keyboard Navigation

All interactive elements must be reachable via keyboard (Tab, Shift+Tab, Enter, Space, arrow keys where applicable).

**Manual check (2 minutes per journey):**

1. Load the page.
2. Press Tab repeatedly.
3. Verify:
   - Every button, link, input is reachable.
   - Focus indicator is visible (blue ring or outline).
   - Enter/Space activates buttons.
   - Escape closes dialogs.
   - Arrow keys navigate where expected (e.g., Scorekeeper match navigation).

**Pass:** No interactive element is skipped; focus order is logical (top-to-bottom, left-to-right).

---

## Color Contrast

**WCAG 1.4.3 (AA):** Text must have at least **4.5:1** contrast for normal text, **3:1** for large text (≥18pt or bold ≥14pt).

**Gate:** Run Chrome DevTools Lighthouse accessibility audit on any changed page. Fix all "Background and foreground colors do not have a sufficient contrast ratio" warnings.

**Brand tokens (shipped in #269–#273):** Our design system uses `--color-surface-*` and `--color-primary-*` tokens that already meet AA contrast. If you introduce a new color, validate it with a contrast checker (e.g., https://webaim.org/resources/contrastchecker/).

---

## Pre-Release Checklist

Before merging a PR that touches Login, Public Registration, Scorekeeper, or Public Scoreboard:

- [ ] All automated axe tests pass (`npm run test:e2e`)
- [ ] Mobile viewport tests pass (`npx playwright test --project=mobile-chrome`)
- [ ] One manual screen reader smoke test completed (document in PR)
- [ ] Reduced motion tested (no infinite animations without `prefers-reduced-motion` check)
- [ ] Touch targets ≥44px for all primary CTAs (component defaults used)
- [ ] Keyboard navigation spot-checked (all elements reachable)
- [ ] Lighthouse a11y audit shows no contrast errors

---

## Out of Scope (Future Work)

These are **NOT** hard gates for Slice 1 (#128) but should be tracked for full WCAG 2.2 AA compliance:

- [ ] Automated CI gate (VPS verify only; GitHub Actions not yet wired)
- [ ] Every browser × AT combination (we test 1 per journey per release)
- [ ] ARIA Authoring Practices Guide (APG) full conformance for complex widgets
- [ ] Screen magnification / zoom testing (up to 200%)
- [ ] Full WCAG 2.2 audit by external agency

See GitHub issue #128 for the full roadmap.

---

## Resources

- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [axe DevTools Browser Extension](https://www.deque.com/axe/devtools/) (Chrome, Firefox, Edge)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [VoiceOver User Guide](https://support.apple.com/guide/voiceover/welcome/mac)
- [TalkBack User Guide](https://support.google.com/accessibility/android/answer/6283677)
- [NVDA User Guide](https://www.nvaccess.org/files/nvda/documentation/userGuide.html)

---

**Last Updated:** 2026-09-10  
**Owner:** Engineering (maintained in `docs/a11y-release-gates.md`)
