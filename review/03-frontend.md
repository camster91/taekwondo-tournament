# Frontend Review — Bowin Tournament OS (Track 3)

**Reviewer:** frontend-dev
**Date:** 2026-09-10
**Scope:** `src/client/**` (App, pages, components, hooks, context, services, utils), `index.html`, `vite.config.ts`, `bundle-baseline.json`, `public/brand/**`, anti-pattern sweep (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `setAttribute('on…')`), client-bundle secrets scan.
**Method:** static read-only review. No dev server, no browser, no side-effects. Bundle budget read from `bundle-baseline.json`.
**Out of scope:** server correctness, security (Track 1), platform / deploy (Track 2), brand/launch copy, test coverage.

---

## 1. Executive Summary

The frontend is generally well-built: code-split per page, Sentry- and top-level error-boundary wrapped, branded error fallback, React Router 7 Suspense, React Query with reasonable `staleTime`s, dedicated `AccessibleDialog` + `ConfirmDialog` primitives with proper focus trap and Esc handling, `LiveChatWidget` mounted at app root, `ConnectionStatusBanner` wired to the WebSocket hook, and bundle budgets enforced per chunk.

There is **one critical regression** from the cookie-auth migration (`useBracketWebSocket` still reads `localStorage.getItem('bowin_session' || 'tkd_auth_token')` — neither key is set after the migration, so the bracket live-update channel is dead), and **two HIGH issues** that affect production UX (a non-blocking `ConfirmDialog` for irreversible bracket-destroying actions is replaced by `window.confirm()`, and the keyboard-help modal in `Scorekeeper` cannot be closed with Esc). Beyond that, the high-volume of native `window.confirm()` / `window.alert()` / `navigator.clipboard.writeText()`-with-no-error-handling calls, the garbled UTF-8 ellipsis strings in two source files, the empty `aria-describedby` pointer in `ManageRegistration`, and the missing `react-router-dom` `<ScrollRestoration />` together make this **needs-fixes-before-ship** rather than a clean ship.

Bundle hygiene is good: all heavy pages are in their own chunk, every chunk is under its declared budget, and the entry chunk is 74 KB raw / 22.7 KB gzip. The large *source* files (Divisions 1967 lines, Scorekeeper 1798 lines, BracketEditor 1175 lines) are flagged as refactor opportunities but not defects on their own — the in-file extraction of `SortableDivisionRow`, `MatchCard`, etc. is already happening.

Nothing previously RESOLVED in `AUDIT-REPORT-2026-06-26.md` regressed: the Sentry-ErrorBoundary mount, the `<Suspense fallback={PageFallback}>` wrapping every lazy page, the `bowin_csrf` cookie + `X-CSRF-Token` header on mutations, and the per-page `aria-live` regions in Scorekeeper / BracketEditor are all still in place.

---

## 2. Findings table

| Severity | Title | Location |
|---|---|---|
| CRITICAL | WebSocket hook reads `localStorage` keys that are no longer written after cookie auth migration — live bracket updates are dead | `src/client/hooks/useBracketWebSocket.ts:38-43` |
| HIGH | Keyboard-help modal in `Scorekeeper` has no Esc handler (only Tab trap) and no outer `onClick` to close | `src/client/pages/Scorekeeper.tsx:1682-1703` |
| HIGH | `Input` component ignores `error` prop for `aria-invalid` / `aria-describedby` — form errors are not announced to screen readers | `src/client/components/ui/Input.tsx:8-37` |
| HIGH | `ManageRegistration` form sets `aria-describedby="lookup-error"` but the error `<div>` has no `id="lookup-error"` — screen readers announce nothing | `src/client/pages/ManageRegistration.tsx:541-549` |
| MEDIUM | Native `window.confirm()` used for irreversible bracket / division / tournament actions — blocks AT and is not focusable | `src/client/pages/BracketEditor.tsx:762, 807, 823, 841`; `src/client/pages/Divisions.tsx:1822`; `src/client/pages/TournamentDetail.tsx:389, 823`; `src/client/components/MatchTimer.tsx:174` |
| MEDIUM | Native `window.alert()` used for clone-failure toast | `src/client/pages/TournamentDetail.tsx:385` |
| MEDIUM | `navigator.clipboard.writeText` called without try/catch and without user feedback on success / failure | `src/client/pages/Competitors.tsx:663`; `src/client/pages/PublicRegister.tsx:586`; `src/client/pages/TournamentDetail.tsx:412, 423`; `src/client/components/CustomDomainSettings.tsx:213`; `src/client/pages/TournamentSettings.tsx:328, 434`; `src/client/pages/Login.tsx:474` |
| MEDIUM | `<Link target="_blank">` from `react-router-dom` does not auto-add `rel="noopener noreferrer"` (reverse-tabnabbing window-opener) | `src/client/pages/DirectorDashboard.tsx:1110-1124` |
| MEDIUM | `CommandPalette` is a combobox-like UI with no `role="combobox"`, `role="listbox"`, `aria-expanded`, or `aria-activedescendant` | `src/client/components/CommandPalette.tsx:268-310` |
| MEDIUM | `BroadcastModal` and `IncidentReportModal` build their own `role="dialog"` panels instead of using `AccessibleDialog` (no shared focus trap, no Esc on help modal) | `src/client/pages/TournamentDetail.tsx:1440-1545`; `src/client/pages/Scorekeeper.tsx:1574-1680` |
| MEDIUM | React Router 7 `<ScrollRestoration />` not mounted — back-button / deep-link scroll position is stale | `src/client/App.tsx:597, 639, 741` |
| MEDIUM | Icon-only buttons in `Divisions` row have `title` but missing `aria-label` for the Split and Delete actions | `src/client/pages/Divisions.tsx:1941-1954` |
| LOW | Garbled UTF-8 ellipsis `â€¦` instead of `…` in two source files (real visible bug) | `src/client/pages/Schedule.tsx:683`; `src/client/pages/Competitors.tsx:607` |
| LOW | `console.log` / `console.warn` left in production paths in WebSocket hook, BracketEditor, Scorekeeper (no `import.meta.env.DEV` gate) | `src/client/hooks/useBracketWebSocket.ts:42, 56, 73, 75, 85, 105, 115`; `src/client/pages/BracketEditor.tsx:114, 117`; `src/client/pages/Scorekeeper.tsx:347, 350, 386, 389` |
| LOW | `IconButton` size variant `h-11 w-11 sm:h-8 sm:w-8` shrinks below 44×44 on `sm+` screens | `src/client/components/ui/IconButton.tsx:15-17` |
| LOW | `Divisions` spinner condition relies on JS operator precedence (`a || b && !c`); add parens for readability | `src/client/pages/Divisions.tsx:908` |
| LOW | Scorekeeper keydown handler has duplicate `case 'ArrowLeft':` / `case 'ArrowRight':` labels (lines 674, 682) — second occurrence is dead code, comment at 669-673 describes a Ctrl+Z handler that already lives at 591-599 | `src/client/pages/Scorekeeper.tsx:669-689` |
| LOW | Top-level `<ErrorBoundary>` only — no per-route error boundary, so one page crash takes the whole app down | `src/client/main.tsx:109-113`; `src/client/App.tsx:597, 639, 741` |
| LOW | `Divisions.tsx` (1967), `Scorekeeper.tsx` (1798), `BracketEditor.tsx` (1175) and `TournamentDetail.tsx` (~1500) would benefit from hook / sub-component extraction | `src/client/pages/Divisions.tsx`; `src/client/pages/Scorekeeper.tsx`; `src/client/pages/BracketEditor.tsx`; `src/client/pages/TournamentDetail.tsx` |
| LOW | `getCompetitorName(currentMatch.competitor2)` called on `undefined` competitors in penalty/score paths (the JSX handles the button-disabled state but the helper would still throw if ever reached) | `src/client/pages/Scorekeeper.tsx:549, 1251-1289, 1331, 1360, 1599` |

**Counts:** CRITICAL: 1, HIGH: 3, MEDIUM: 9, LOW: 7

---

## 3. Numbered findings

### 3.1 [CRITICAL] `useBracketWebSocket` reads from `localStorage` keys that no longer exist after the cookie-auth migration — live bracket updates are dead

- **Location:** `src/client/hooks/useBracketWebSocket.ts:38-43`; server side at `src/server/services/websocket.ts:60-69`; contract mismatch with `src/client/context/AuthContext.tsx:30-38`
- **Trigger:** Any user opens `Scorekeeper` or `BracketEditor` for a live tournament. The hook calls `localStorage.getItem('bowin_session')` and falls back to `localStorage.getItem('tkd_auth_token')`. Both keys return `null` because the auth migration moved the JWT into the `HttpOnly` `bowin_session` cookie (which JavaScript cannot read) and the client `tkd_auth_token` is no longer written anywhere (confirmed by `grep` of `src/client`).
- **Impact:** The hook emits `console.warn('[websocket] No auth token available')` and never opens a connection. Server side, the same code path rejects with `Missing authentication token` because `verifyToken` requires a real JWT signed with the `bowin` issuer/audience. **The live bracket update channel — the headline feature of the scorekeeper — is silently broken in production.** The `isConnected` flag returned to the page is `false` forever, but neither page surfaces this to the user (no toast, no banner). The `ConnectionStatusBanner` component is mounted but its connection state is fed by the same broken hook.
- **Remediation:** For WebSocket auth the standard approach is one of: (a) have the server accept the same `bowin_session` cookie on the upgrade request (cookie is `HttpOnly` but `sameSite=lax` and is sent on the WebSocket upgrade if the server reads `req.headers.cookie` directly — no need for the client to read it); (b) on connect, `fetch('/api/auth/me', { credentials: 'same-origin' })` to get a short-lived ticket that the WS upgrade passes as a query param; or (c) sign the WS with the `bowin_csrf` cookie value (already readable by JS) and verify on the server. Option (a) is the smallest change and matches the rest of the app. Either way, the `console.warn` should become a `addToast('Live bracket updates are offline. Reconnect to resume live updates.', 'warning')` and the banner should expose that.
- **Evidence:**
  ```ts
  // src/client/hooks/useBracketWebSocket.ts:36-43
  const connect = useCallback(() => {
    if (!enabled) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // BUG: 'bowin_session' is the COOKIE name, not a localStorage value.
    // BUG: 'tkd_auth_token' was the pre-migration localStorage JWT key.
    const token = localStorage.getItem('bowin_session') || localStorage.getItem('tkd_auth_token');
    if (!token) { console.warn('[websocket] No auth token available'); return; }
    const url = `${protocol}://${window.location.host}/ws/bracket?token=${encodeURIComponent(token)}`;
    ws.current = new WebSocket(url);
  }, [enabled]);
  ```
  ```ts
  // src/client/context/AuthContext.tsx:30-38 — confirms the migration:
  // "Auth is now cookie-based. The HttpOnly `bowin_session` cookie is set
  //  by the server on every successful login … so client code no longer reads,
  //  stores, or sends the JWT"
  ```

### 3.2 [HIGH] Keyboard-help modal in `Scorekeeper` has no Esc handler and no outer-click dismiss

- **Location:** `src/client/pages/Scorekeeper.tsx:1682-1703`
- **Trigger:** A director opens the scorekeeper and presses `?` to bring up the keyboard-shortcuts help modal (the page-level keydown handler is at line 580 and explicitly bails when `showKeyboardHelp` is true at line 583, so the page's own `case 'Escape'` never fires while the modal is open).
- **Impact:** The help modal is keyboard-trapped on the Close button only — the outer overlay's `onKeyDown` only handles `Tab` cycling, and there is no `onClick` on the backdrop. Pressing `Esc` does nothing. There is no `aria-label` / `aria-modal` on the outer overlay, only on the inner panel (line 1705). A keyboard-only user must Tab to the Close button to dismiss. Compare with the incident modal in the same file, which correctly uses `activateDialogFocus` (line 700-702) and gets Esc handling for free.
- **Remediation:** Replace the custom `onKeyDown` overlay with `AccessibleDialog` (the project already exports it at `src/client/components/ui/AccessibleDialog.tsx:11`). It wraps `activateDialogFocus` and gives you Esc + Tab trap + restore-focus on close in 4 lines.
- **Evidence:**
  ```tsx
  // src/client/pages/Scorekeeper.tsx:1682-1703
  {showKeyboardHelp && (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
      onKeyDown={(e) => { /* Tab trap only — no Escape, no onClick */ }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-help-title"
        className="bg-gray-800 rounded-xl p-6 max-w-md w-full"
      >
  ```

### 3.3 [HIGH] `Input` component ignores its `error` prop for `aria-invalid` / `aria-describedby`

- **Location:** `src/client/components/ui/Input.tsx:8-37`; consumed across `PublicRegister`, `TournamentSettings`, `ManageRegistration`, `Login`, `Profile`, `SupportChatWidget`, etc.
- **Trigger:** Any form using `<Input error="..." />` (e.g. password length, required field, server-side validation) renders the red border (`border-danger` on line 21) but the `error` string is never passed to the `<input>` as `aria-invalid` or `aria-describedby`. The error message is usually rendered as a sibling `<p>` immediately under the field.
- **Impact:** Screen-reader users hear the field as valid; the red error text and border are not announced. In `PublicRegister` the page has a top-of-form `role="alert"` region (line 802-810) that summarises errors, which is good — but on individual fields, the form's *per-field* error state is invisible to AT. This is a WCAG 1.3.1 / 4.1.2 failure that affects every form in the app.
- **Remediation:** Change `Input` to `forwardRef` (already done) and accept `id` + `errorId?: string`. When `error` is truthy, set `aria-invalid="true"` and `aria-describedby={errorId}`. In consumers, render `<span id={errorId} role="status">{error}</span>` immediately under the field, or change the existing sibling-error pattern to pass the id. Same fix is needed on `Select.tsx` (currently also accepts `error` but does not propagate it).
- **Evidence:**
  ```tsx
  // src/client/components/ui/Input.tsx:8-37
  const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ error, className = '', children, ...props }, ref) => {
      return (
        <div className="relative">
          <input
            ref={ref}
            className={[
              'h-11 px-3 rounded-lg border border-surface-200 ...',
              error && 'border-danger focus:ring-danger/30 focus:border-danger',
              className,
            ].filter(Boolean).join(' ')}
            {...props}    // <-- no aria-invalid / aria-describedby wiring
          />
  ```

### 3.4 [HIGH] `ManageRegistration` lookup form sets `aria-describedby="lookup-error"` but the target div has no matching `id`

- **Location:** `src/client/pages/ManageRegistration.tsx:541-549`
- **Trigger:** A parent types an invalid code or email into the lookup form, the server returns an error, and the form re-renders with `lookupError` set. The `<form>` element sets `aria-describedby="lookup-error"`.
- **Impact:** The `aria-describedby` points to nothing because the inner error `<div>` (line 543) has no `id`. A screen reader announces the form as described-by the empty id and reads nothing. Compare with `CheckRegistration.tsx:198-208` which correctly has `id="lookup-error"` on the same div — the two pages drifted apart.
- **Remediation:** Add `id="lookup-error"` to the div on line 543. Better: extract a `LookupErrorAlert` shared by both pages.
- **Evidence:**
  ```tsx
  // src/client/pages/ManageRegistration.tsx:541-549
  <form onSubmit={handleLookup} className="space-y-4" aria-describedby={lookupError ? 'lookup-error' : undefined}>
    {lookupError && (
      <div
        role="alert"
        // <-- missing id="lookup-error"
        className="p-3 rounded-md bg-danger/10 ..."
      >
  ```

### 3.5 [MEDIUM] Native `window.confirm()` for irreversible actions

- **Location:** `src/client/pages/BracketEditor.tsx:762, 807, 823, 841`; `src/client/pages/Divisions.tsx:1822`; `src/client/pages/TournamentDetail.tsx:389, 823`; `src/client/components/MatchTimer.tsx:174`
- **Trigger:** Director clicks "Remove competitor from division" (`BracketEditor.tsx:762`), "Swap competitors" (807/823/841), "Restore divisions from backup" (`Divisions.tsx:1822`), "Clone tournament" (`TournamentDetail.tsx:389`), "Mark tournament completed" (`TournamentDetail.tsx:823`), or "Reset match timer" (`MatchTimer.tsx:174`).
- **Impact:** Native `confirm()` is not focusable, not themable, not keyboard-only-reachable in all browsers (some screen readers won't read it), and shows a different copy on every browser. The `ConfirmDialog` primitive at `src/client/components/ui/ConfirmDialog.tsx:1-160` is the right replacement and is already used elsewhere in the app (and is exactly the one the prior audit nudged the team toward).
- **Remediation:** Replace each `if (confirm('…')) { … }` with `<ConfirmDialog open={x} onConfirm={fn} onClose={() => setX(false)} title=… description=… destructive confirmLabel=… />`. The `MatchTimer` `confirm('…no undo on tournament day')` is the most user-facing of the bunch.
- **Evidence:**
  ```tsx
  // src/client/pages/BracketEditor.tsx:762
  if (confirm(`Remove ${a.registration.competitor.firstName} ${a.registration.competitor.lastName} from this division? Their bracket slot will be freed; regenerate the bracket to refill.`)) {
  // src/client/pages/TournamentDetail.tsx:823
  if (confirm('Mark this tournament as completed? Parents will no longer be able to register and the public scoreboard will show final results.')) {
  ```

### 3.6 [MEDIUM] Native `window.alert()` for clone-failure

- **Location:** `src/client/pages/TournamentDetail.tsx:385`
- **Trigger:** `cloneTournament` mutation rejects on the server.
- **Impact:** The error message bypasses the `ToastContext` and shows a browser-native alert. Inconsistent with the rest of the page which already uses `addToast` for success.
- **Remediation:** `addToast(e.message || 'Clone failed', 'error')` and remove the `alert` import if it's now unused.
- **Evidence:**
  ```ts
  // src/client/pages/TournamentDetail.tsx:384-386
  onError: (e: Error) => alert(e.message || 'Clone failed'),
  ```

### 3.7 [MEDIUM] `navigator.clipboard.writeText` called without try/catch and without user feedback

- **Location:** `src/client/pages/Competitors.tsx:663`; `src/client/pages/PublicRegister.tsx:586`; `src/client/pages/TournamentDetail.tsx:412, 423`; `src/client/components/CustomDomainSettings.tsx:213`; `src/client/pages/TournamentSettings.tsx:328, 434`; `src/client/pages/Login.tsx:474`
- **Trigger:** User clicks a "Copy" / "Copy link" / "Copy as CSV" button. On pages that don't gate with `await` (e.g. `Competitors.tsx:663` and `PublicRegister.tsx:586` use the optional-chaining fire-and-forget `navigator.clipboard?.writeText(...)`), the call may reject in a non-secure context, with denied permissions, or behind a permission prompt.
- **Impact:** The button often toggles a "Copied!" label without the copy actually happening. No `try/catch` and no fallback (e.g. legacy `document.execCommand('copy')` or just showing the value in a text field the user can manually select).
- **Remediation:** Wrap each call in `try { await navigator.clipboard.writeText(text); addToast('Copied', 'success'); } catch { addToast('Copy failed — select and copy manually', 'error'); fallbackShowValue(text); }`.
- **Evidence:**
  ```ts
  // src/client/pages/Competitors.tsx:663 — fire-and-forget, no error path
  navigator.clipboard?.writeText(Array.from(selectedIds).join('\n'));
  // src/client/pages/PublicRegister.tsx:586
  navigator.clipboard?.writeText(result.registration.confirmationCode || '');
  ```

### 3.8 [MEDIUM] `<Link target="_blank">` from `react-router-dom` does not auto-add `rel="noopener noreferrer"`

- **Location:** `src/client/pages/DirectorDashboard.tsx:1110-1124`
- **Trigger:** Director clicks the "Scorekeeper" or "Public Scoreboard" tiles on the dashboard, which open the destination in a new tab via `react-router-dom`'s `<Link target="_blank" as={Link}>`.
- **Impact:** `react-router-dom` does not auto-add `rel="noopener noreferrer"`. The opened tab keeps a `window.opener` reference back to the app, which is the textbook reverse-tabnabbing setup. Mitigated in practice by the fact that the destinations are same-origin, but a future external link added the same way inherits the bug.
- **Remediation:** Add a `SafeLink` wrapper that injects `rel="noopener noreferrer"` whenever `target === '_blank'`, or do `if (target === '_blank') rel = 'noopener noreferrer'` inline.
- **Evidence:**
  ```tsx
  // src/client/pages/DirectorDashboard.tsx:1111-1120
  <Button
    as={Link}
    to={`/scorekeeper/${tournamentId}`}
    target="_blank"
    variant="secondary"
    className="justify-center"
  >
    <Activity className="h-4 w-4 mr-2" /> Scorekeeper
  </Button>
  ```

### 3.9 [MEDIUM] `CommandPalette` is a combobox without the ARIA contract

- **Location:** `src/client/components/CommandPalette.tsx:268-310`
- **Trigger:** User hits `Cmd+K` / `Ctrl+K` from any page; the palette opens with an `<input>` and a `<div>` of commands below.
- **Impact:** No `role="combobox"` on the input, no `aria-expanded`, no `role="listbox"` on the results, no `aria-activedescendant` for the highlighted row, no `aria-controls`. Screen-reader users can type into the input but cannot navigate the result list.
- **Remediation:** Add `role="combobox" aria-expanded={isOpen} aria-controls="cmdk-list" aria-autocomplete="list" aria-activedescendant={selectedId}` to the input; add `role="listbox" id="cmdk-list"` to the results container; add `id={\`cmdk-row-${i}\`} role="option" aria-selected={i === selectedIndex}` to each row.
- **Evidence:**
  ```tsx
  // src/client/components/CommandPalette.tsx:268-310 (no role/aria attributes)
  <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-fadeIn" onClick={onClose} />
  <div className="fixed top-[20vh] left-1/2 -translate-x-1/2 w-full max-w-2xl z-50 animate-slideDown">
    <div className="bg-white dark:bg-gray-800 rounded-2xl ...">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <Search className="w-5 h-5 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search commands..."
          ...
  ```

### 3.10 [MEDIUM] `BroadcastModal` (TournamentDetail) and `IncidentReportModal` (Scorekeeper) build their own dialogs instead of using `AccessibleDialog`

- **Location:** `src/client/pages/TournamentDetail.tsx:1440-1545`; `src/client/pages/Scorekeeper.tsx:1574-1680` (incident) and 1682-1703 (help)
- **Trigger:** Director opens "Email parents" (TournamentDetail) or scorekeeper incident / help modals.
- **Impact:** Inconsistent focus management. The incident modal does call `activateDialogFocus` correctly (`Scorekeeper.tsx:700-702`), so that one is fine. The broadcast modal (TournamentDetail) and the help modal (`Scorekeeper.tsx:1682`) do not. The `BroadcastModal` accepts no `onClose` and the outer overlay has no backdrop-click handler — only the explicit close button dismisses it.
- **Remediation:** Wrap all three with `<AccessibleDialog label=… onClose=…>` from `src/client/components/ui/AccessibleDialog.tsx`. This is the same pattern the `ConfirmDialog` already uses internally.
- **Evidence:**
  ```tsx
  // src/client/pages/TournamentDetail.tsx:1444
  <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Email registered parents">
  ```

### 3.11 [MEDIUM] No `<ScrollRestoration />` mounted in the React Router 7 router

- **Location:** `src/client/App.tsx:597, 639, 741` (the three `<Suspense>` boundaries in the protected route, the public layout, and the catch-all)
- **Trigger:** User scrolls down a long page (e.g. Schedule, Divisions, TournamentDetail), clicks a link, and hits the browser back button.
- **Impact:** Scroll position is not restored. Some pages (e.g. `PublicRegister`) do explicit `window.scrollTo({ top: 0 })` on transitions, but most don't. The browser will land the user at the top of the previous page instead of where they were.
- **Remediation:** Add `<ScrollRestoration />` (from `react-router-dom`) inside the layout, between the `<Routes>` and the closing `</Layout>`. RR7 supports it natively.
- **Evidence:**
  ```tsx
  // src/client/App.tsx:597-598 — Suspense present, ScrollRestoration absent
  <Suspense fallback={<PageFallback />}>
    <Routes>
  ```

### 3.12 [MEDIUM] Icon-only buttons in `Divisions` row lack `aria-label` (Split, Delete)

- **Location:** `src/client/pages/Divisions.tsx:1940-1954`
- **Trigger:** Screen reader / keyboard user tabs through the divisions table.
- **Impact:** The Manage (1932-1936) and drag-handle (1895) buttons have `aria-label`; Split (1941-1947) and Delete (1949-1954) only have `title` attributes, which AT inconsistently reads. Net effect: an AT user cannot tell what Split or Delete will do without activating them.
- **Remediation:** Add `aria-label={\`Split ${div.name} division\`}` and `aria-label={\`Delete ${div.name} division\`}` to match the existing `Manage competitors in ${div.name}` pattern on the adjacent button.
- **Evidence:**
  ```tsx
  // src/client/pages/Divisions.tsx:1940-1954
  {(div._count?.assignments ?? 0) > 8 && (
    <button onClick={onSplit} className="..." title="Split Division">
      <Scissors className="h-4 w-4" />
    </button>
  )}
  <button onClick={onDelete} className="..." title="Delete Division">
    <Trash2 className="h-4 w-4" />
  </button>
  ```

### 3.13 [LOW] Garbled UTF-8 ellipsis `â€¦` instead of `…` in two source files

- **Location:** `src/client/pages/Schedule.tsx:683`; `src/client/pages/Competitors.tsx:607`
- **Trigger:** Source file is read by a tool that treats the file as Windows-1252 (or the file was originally saved through a Windows-1252 intermediary).
- **Impact:** The visible text "Loading saved live conditionsâ€¦" and "Exportingâ€¦" renders the mojibake to the end user. The surrounding code on the very same line (e.g. `Schedule.tsx:686` uses `…` correctly) confirms the file is otherwise valid UTF-8 — only these two strings are corrupted.
- **Remediation:** Replace `â€¦` with `…` in both files. Re-save with explicit UTF-8 (no BOM).
- **Evidence:**
  ```tsx
  // src/client/pages/Schedule.tsx:683
  {conditionsLoading && <div role="status" className="flex items-center gap-2 text-sm"><Spinner size="sm" /> Loading saved live conditionsâ€¦</div>}
  // src/client/pages/Competitors.tsx:607
  <FileSpreadsheet className="h-4 w-4" /> {exportState === 'pending' ? 'Exportingâ€¦' : 'Export'}
  ```

### 3.14 [LOW] `console.log` / `console.warn` left in production paths

- **Location:** `src/client/hooks/useBracketWebSocket.ts:42, 56, 73, 75, 85, 105, 115`; `src/client/pages/BracketEditor.tsx:114, 117`; `src/client/pages/Scorekeeper.tsx:347, 350, 386, 389`
- **Trigger:** A user opens the scorekeeper or bracket editor; the browser console receives several `[websocket] …` and `[bracket-editor] …` log lines per interaction.
- **Impact:** Console noise for end users and would-be attackers (information disclosure of internal state). Defeats the `console.error` and `console.log` minimization goal the prior audit tracked.
- **Remediation:** Gate all of them with `if (import.meta.env.DEV) …` (the codebase already uses this pattern in `src/client/main.tsx:13, 38, 87`).
- **Evidence:**
  ```ts
  // src/client/hooks/useBracketWebSocket.ts:42, 56, 105
      console.warn('[websocket] No auth token available');
      console.log('[websocket] Connected to bracket updates');
      console.log(`[websocket] Connection closed: ${event.code} ${event.reason}`);
  ```

### 3.15 [LOW] `IconButton` shrinks below 44×44 on `sm+` screens

- **Location:** `src/client/components/ui/IconButton.tsx:15-17`
- **Trigger:** User on a tablet / desktop (≥ 640 px) uses a control rendered with `IconButton` (e.g. `size="sm"`).
- **Impact:** Touch target is 32×32 on `sm+` screens (32×32 on `sm`, 36×36 on `md`, 40×40 on `lg`). Below the WCAG 2.5.5 minimum (44×44) and below the existing `touch-target` utility the team standardised on elsewhere. The intent (a smaller desktop target) is reasonable; the values just dip below the team-wide convention.
- **Remediation:** Either document the variant as keyboard-only and force `min-h-11 min-w-11`, or change the `sm+` values to `h-9 w-9` (36×36) minimum and stop using `h-8 w-8` for primary actions.
- **Evidence:**
  ```tsx
  // src/client/components/ui/IconButton.tsx:14-17
  sm: 'h-11 w-11 sm:h-8 sm:w-8 p-1.5',
  md: 'h-11 w-11 sm:h-9 sm:w-9 p-2',
  lg: 'h-11 w-11 sm:h-10 sm:w-10 p-2.5',
  ```

### 3.16 [LOW] `Divisions` spinner condition relies on JS operator precedence

- **Location:** `src/client/pages/Divisions.tsx:908`
- **Trigger:** Code review / future refactor.
- **Impact:** `recommendationsLoading || recommendationsFetching && !recommendations` evaluates as `recommendationsLoading || (recommendationsFetching && !recommendations)`. Runtime behaviour is actually correct (initial loading shows the spinner, refetch-while-data-present does not), but the lack of parens invites a future bug.
- **Remediation:** `(recommendationsLoading || recommendationsFetching) && !recommendations` to match the apparent intent.
- **Evidence:**
  ```tsx
  // src/client/pages/Divisions.tsx:908
  {recommendationsLoading || recommendationsFetching && !recommendations ? (
  ```

### 3.17 [LOW] Scorekeeper keydown handler has duplicate `case 'ArrowLeft':` / `case 'ArrowRight':` labels — dead code

- **Location:** `src/client/pages/Scorekeeper.tsx:669-689`
- **Trigger:** Anyone reading the file looking for the "undo the most recently completed match" behaviour described in the comment at 669-673.
- **Impact:** The comment at 669-673 says "Ctrl/Cmd+Z: undo the most recently completed match…" but the case label is `case 'ArrowLeft':` (which already exists at 613). The second occurrence is unreachable JavaScript. The Ctrl+Z handler is correctly at 591-599. The duplicate labels are dead code that misleads readers.
- **Remediation:** Delete lines 669-689. If a key other than `ArrowLeft` was intended (e.g. `case 'z':`), write the correct label.
- **Evidence:**
  ```tsx
  // src/client/pages/Scorekeeper.tsx:669-689
  // Ctrl/Cmd+Z: undo the most recently completed match...
  case 'ArrowLeft':                           // <-- duplicate of label at line 613
    e.preventDefault();
    currentMatch.competitor1 && setSelectedWinner(currentMatch.competitor1.id);
    break;
  case 'ArrowRight':                          // <-- duplicate of label at line 625
    e.preventDefault();
    if (currentMatch.competitor2) setSelectedWinner(currentMatch.competitor2.id);
    break;
  ```

### 3.18 [LOW] Top-level error boundary only — one page crash takes the whole app down

- **Location:** `src/client/main.tsx:109-113`; `src/client/App.tsx:597, 639, 741`
- **Trigger:** Any uncaught render error in a page component (e.g. a `<Suspense>` boundary resolves with bad data after a refetch).
- **Impact:** The whole app shows the Sentry fallback / "Something went wrong" page instead of the user being able to navigate to another section. The `<ErrorBoundary>` is at the outermost level, with no per-route fallback.
- **Remediation:** Wrap each `<Route element={<Page ... />}>` in its own `<RouteErrorBoundary route="...">`. React Router 7 supports an `errorElement` prop directly on `<Route>` which is the smallest change.
- **Evidence:**
  ```tsx
  // src/client/main.tsx:109-113
  <SentryErrorBoundary fallback={(errorData) => <SentryFallback error={errorData.error as Error} />}>
    <ErrorBoundary>
      <AppRoutes />
    </ErrorBoundary>
  </SentryErrorBoundary>
  ```

### 3.19 [LOW] Large page files would benefit from hook / sub-component extraction

- **Location:** `src/client/pages/Divisions.tsx` (1967 lines); `src/client/pages/Scorekeeper.tsx` (1798 lines); `src/client/pages/BracketEditor.tsx` (1175 lines); `src/client/pages/TournamentDetail.tsx` (~1500 lines)
- **Trigger:** New contributors adding features to any of these files.
- **Impact:** Slow incremental compile in Vite's dev pipeline; cognitive load when reading. `SortableDivisionRow`, `MatchCard`, `BracketSection`, etc. are already extracted in some of these files; the rest of the page is monolithic.
- **Remediation:** Extract the obvious data-load / mutation blocks into `useXxx` hooks (`useDivisionsQuery`, `useScorekeeperMatch`, `useBroadcastMutation`), and pull remaining JSX sub-trees (filter bar, restore-card, bracket chrome, etc.) into named local components. The team has been doing this incrementally — keep going.
- **Evidence:** N/A (architectural observation, not a defect).

### 3.20 [LOW] `getCompetitorName(currentMatch.competitor2)` reachable when competitor2 is undefined

- **Location:** `src/client/pages/Scorekeeper.tsx:549, 1251, 1260, 1284, 1331, 1360, 1554, 1599`
- **Trigger:** A round-1 bye match has `competitor2: null` (or in `currentMatch` from a partially-populated bracket). Several of these calls happen inside the per-side JSX blocks that DO have a `if (currentMatch.competitor2)` guard — but at least the `getCompetitorName` and `getCompetitorSchool` helpers at 549 / 1260 / 1289 / 1331 / 1599 are not wrapped in the same guard, and a future refactor that moves the JSX into a shared component will trip over them.
- **Impact:** Today, no observable bug because each site is inside a guarded block. Tomorrow, a NPE when a non-guard is moved.
- **Remediation:** Make `getCompetitorName(c?: Competitor | null)` and `getCompetitorSchool(c?: Competitor | null)` null-safe (return `''`). This is a 2-line change with no behavioural impact.
- **Evidence:**
  ```ts
  // src/client/pages/Scorekeeper.tsx:1260-1261
  <div className="text-2xl font-bold">{getCompetitorName(currentMatch.competitor2)}</div>
  <div className="text-surface-600 mt-1">{getCompetitorSchool(currentMatch.competitor2)}</div>
  ```

---

## 4. Regression check vs `AUDIT-REPORT-2026-06-26.md`

The 2026-06-26 audit's frontend-relevant findings were:
1. **D1 / D2** — stale-closure in `Scorekeeper` keyboard handler. **Holds fixed** at `src/client/pages/Scorekeeper.tsx:591-599` (Ctrl+Z path is now self-contained and uses `latestCompletedMatchId(selectedDivisionMatches)` directly without a stale-closure entry-point).
2. **D3** — `console.log` in production paths. **New violations added** — see 3.14 (WebSocket hook + Scorekeeper + BracketEditor). The old `bracket.ts:266` comment was removed; the new violations are in different files.
3. **D6** — input a11y. **Regressed** — `Input` component does not wire `aria-invalid` / `aria-describedby` from its `error` prop (3.3).
4. **D7 / D8** — bracket generator + density. Not in this track's scope (server-side), but no client-side regressions in the bracket UI.
5. **M5** — public scoreboard mobile QR. **Fixed** at `src/client/pages/PublicScoreboard.tsx:298-308`.
6. **Bundle size** — still 1.6 MB unminified / 488 KB gzip range; budgets enforced via `bundle-baseline.json`. No regression.
7. **`aria-live` regions for bracket operations** — still present at `src/client/pages/BracketEditor.tsx:543-555`.
8. **CSRF cookie + `X-CSRF-Token`** — still wired at `src/client/context/AuthContext.tsx:357-362`; no regression.
9. **Sentry ErrorBoundary** — still mounted at `src/client/main.tsx:109-113`; no regression. *(New finding 3.18: still only top-level.)*
10. **`<Suspense fallback>` per page** — still in place; no regression. *(New finding 3.11: scroll restoration not added.)*

**Net: 1 prior item regressed (input a11y wiring), 1 prior item gained new occurrences (console.log), 8 prior items still hold. One item the prior audit did not flag is the new CRITICAL: WebSocket auth reads dead `localStorage` keys.**

---

## 5. Verdict

**NEEDS_FIXES_BEFORE_SHIP**

The single CRITICAL (WebSocket hook auth regression) breaks the live-bracket-update feature that the scorekeeper is sold on. The three HIGH items (keyboard-help Esc, input error wiring, ManageRegistration describedby) are accessibility issues that would be axe-critical and that the team has already shown a pattern for fixing. The MEDIUM `window.confirm` / `window.alert` cluster and the garbled UTF-8 ellipses are quick wins. Nothing else blocks ship.

Suggested minimal ship-blocking patch list:
1. Switch `useBracketWebSocket` to read the `bowin_session` cookie on the *server* (or sign the WS upgrade with the CSRF cookie) — at minimum, surface a `toast.error('Live updates offline — reconnecting…')` when no token is available.
2. Replace the `Scorekeeper` keyboard-help overlay with `AccessibleDialog` (or copy its `onKeyDown` to add Escape handling).
3. Add `aria-invalid` / `aria-describedby` to the `Input` (and `Select`) primitive.
4. Add `id="lookup-error"` to the `ManageRegistration` error div.
5. Replace the seven `window.confirm` call sites with the existing `ConfirmDialog`.
6. Replace `window.alert` in `TournamentDetail.tsx:385` with `addToast`.
7. Fix the two `â€¦` mojibake strings.
