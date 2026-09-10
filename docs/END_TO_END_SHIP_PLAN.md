# Bowin End-to-End Ship Plan — Path to 100%

**Created:** 2026-09-09  
**Owner:** Cameron (camster91)  
**Status:** Pre-pilot → Competitive GA  
**Repository:** camster91/taekwondo-tournament  
**Product name:** Bowin Tournament OS

**Latest Update:** 2026-09-10  
**Recent Progress:**  
- ✅ **PR #244 merged:** P0-5 database backup automation + fresh-migration proof (#120 agent parts complete)
- ✅ PR #238: Support diagnostics auth (#195) + public registrations visible in check-in (#187)
- ✅ PR #239: Tenant-branded event portals (#212) — canonical organizer portal URLs, event slug management, publish/unpublish controls, fail-closed security
- ✅ PR #240: Portal registration tenant-scoped operations (#213) — connect public portal registrations to org operations, fail-closed cross-tenant protection, portal-aware registration flow
- ✅ PR #241: VPS-first ops — remove hard SaaS dependencies (GlitchTip/Uptime Kuma/manual payment docs, env-gated Crisp/Sentry/Stripe)
<<<<<<< HEAD
- ✅ PR #242: Tenant isolation proof & release readiness (#214) — two-org isolation matrix tests, portal health monitoring docs, migration/rollback rehearsal steps
- ✅ PR #243: GlitchTip error-tracking wiring for VPS (P0-4) — VPS-hosted error tracking, user context capture, breadcrumbs, env-gated integration
- 🔄 **This PR (#244)**: P0-5 database backups — fresh-DB migration proof (CI job + script), backup/restore automation with encryption, restore-drill template, destructive migration policy
=======
- 🔄 **This PR (active)**: P0-118 completion — registration management token expiration, revocation, rotation, audit logging, integration tests
>>>>>>> 6ae13ec (feat(P0-118): Complete registration management token security)

---

## Vision & Paid Offer

**One sentence:**  
Bowin gives tournament organizers one command center to run registration, divisions, brackets, scoring, and results for martial arts competitions—so they can focus on running the event, not fighting spreadsheets.

**Target customer:**  
Tournament directors and organizing teams at martial arts schools (Taekwondo, Karate, Judo, BJJ, etc.) running 50–500 competitor events.

**Paid offer:**  
SaaS subscription for organizers only. Public-facing pages (registration, scoreboard, parent finder) are branded with the organizer's identity, never "Powered by Bowin" watermarks.

**Pricing model:**  
- **Freemium/Trial:** 1 free event up to 30 competitors (proof-of-value)
- **Per-event:** $99–299/event based on size (50/100/250/500+ competitors)
- **Annual subscription:** $999–2,499/year for unlimited events at one organization
- Stripe-powered checkout, no manual invoicing for standard plans

---

## Current State — Completion Percentage by Area

| Area | % Complete | Status | Key Gaps |
|------|------------|--------|----------|
| **Core product** | | | |
| Auth & users | 85% | 🟡 Needs work | Magic-link complete; lacks org invites, SSO, token revocation |
| Tournament setup | 95% | 🟢 Strong | Settings, rules, weight classes complete; needs org-level templates |
| Competitor registry | 95% | 🟢 Strong | Excel import, search, soft-delete, merge/deduplication complete |
| Registration (staff) | 95% | 🟢 Strong | Bulk + manual registration complete |
| Registration (public) | 95% | 🟢 Strong | Self-serve form, waitlist, payment gateway, confirmation emails complete |
| Divisions & categorization | 90% | 🟢 Strong | Auto-generation complete; needs manual override UX, merge conflicts UI |
| Brackets | 85% | 🟡 Needs work | DE generation complete; needs real-time collab, print layout, QR codes |
| Day-of operations | 75% | 🟡 Needs work | Check-in, scorekeeper, director dashboard complete; needs offline mode, ring sync, announcer view |
| Scoring & results | 80% | 🟡 Needs work | Match scoring, audit trail complete; needs undo/redo UI, video review integration |
| Public display | 70% | 🟡 Needs work | Public scoreboard by slug complete; needs TV-optimized layout, auto-refresh config, QR poster |
| **Non-product** | | | |
| Branding | 70% | 🟡 Needs work | Bowin identity complete; needs organizer white-label, logo upload, custom domains |
| Billing & subscriptions | 30% | 🔴 Blocking | Stripe integrated; needs plan selection, usage metering, billing portal, invoices |
| Ops & monitoring | 60% | 🟡 Needs work | VPS deployment complete; needs uptime monitoring, error tracking (Sentry), log aggregation |
| Legal & compliance | 40% | 🔴 Blocking | Privacy/terms drafted; needs COPPA compliance, minor consent flow, GDPR export/delete |
| Support & docs | 50% | 🟡 Needs work | In-app tour complete; needs video tutorials, help center, live chat widget |
| Marketing & onboarding | 40% | 🟡 Needs work | Landing page drafted; needs case studies, demo video, onboarding checklist |

**Overall estimated completion:** ~70%  
**Blocker count:** 8 critical items (auth revocation, billing, legal, white-label, offline mode, monitoring, COPPA, case studies)

---

## Phased Roadmap to ~100%

### Phase 0: Pre-pilot Lock-in (Weeks 1–2) — *Foundation*

**Objective:** Get the product safe for a controlled pilot with 1–2 friendly organizers.

| ID | Issue/PR | Task | Acceptance Criteria | Effort |
|----|----------|------|---------------------|--------|
| P0-1 | #237 | **✅ VERIFIED: JWT token revocation** | Logout invalidates tokens via `tokenVersion` bump; isActive flip kills sessions — **FULLY TESTED** (auth-session-invalidation.test.ts + auth-token-version.test.ts, 8 regression tests) | S (verify) |
| P0-2 | #237 | **✅ VERIFIED: HttpOnly cookies + CSRF** | SESSION_COOKIE with httpOnly:true + double-submit CSRF protection on mutations; Bearer tokens exempt — **FULLY TESTED** (auth-csrf-protection.test.ts, 11 tests covering cookie attributes, CSRF gates, Bearer exemption) | S (verify) |
| P0-3 | #TBD | **Uptime monitoring** | Add **Uptime Kuma** (self-hosted on Ashbi VPS) for /api/health/ready; 5xx rate alerts to email/Slack — **VPS-first: no third-party SaaS required** | S |
<<<<<<< HEAD
| P0-4 | #243 | **✅ VERIFIED: Error tracking** | Integrate **GlitchTip** (self-hosted Sentry-compatible on Ashbi VPS); capture user context, breadcrumbs — **SHIPPED** in PR #243 (env-gated, VPS-hosted) | S |
| P0-5 | #120 (partial) | **✅ AGENT-SHIPABLE COMPLETE: Database backups** | Fresh-DB migrate proof (CI job + script); backup/restore automation with encryption tested in ephemeral DB; restore-drill evidence template with RPO/RTO; destructive migration gate docs. **Cameron VPS install remains:** daily cron + off-host sync to S3/rsync, baseline production restore drill, rotation of `BACKUP_ENCRYPTION_KEY` env var. | M |
=======
| P0-4 | #TBD | **Error tracking** | Integrate **GlitchTip** (self-hosted Sentry-compatible on Ashbi VPS); capture user context, breadcrumbs — **VPS-first: no third-party SaaS required** | S |
| P0-5 | #244 | **✅ Database backups** | Automate daily encrypted backups to off-host storage; test restore drill — **AGENT WORK COMPLETE, awaiting Cameron VPS cron install + off-host setup + restore drill** (see docs/P0-5-DELIVERY-SUMMARY.md) | M (Cameron ops) |
>>>>>>> 6ae13ec (feat(P0-118): Complete registration management token security)
| P0-6 | #232 | **✅ Privacy policy v1** | Legal.tsx published at /legal/privacy; linked from footer + public registration — **SHIPPED** in PR #232 (pending counsel approval of copy) | M (legal review) |
| P0-7 | #232 | **✅ Terms of service v1** | Legal.tsx published at /legal/terms; linked from footer + public registration — **SHIPPED** in PR #232 (pending counsel approval of copy) | M (legal review) |
| P0-8 | #232 | **✅ VERIFIED: Parental consent flow** | Public registration requires guardianAttested checkbox for minors (age < 18); parent email required and verified via email link with 48h TTL — **FULLY IMPLEMENTED** (ParentalConsentVerification model + service + routes in PR #232) | M |
| **P0-9** | **#118** | **🔄 Registration token security** | Management tokens have expiration (30-day default), revocation + rotation endpoint, audit logs, integration tests — **THIS PR, ACTIVE** | M |

**Exit criteria:**  
- 1 pilot tournament completes with no security incidents, no data loss, and documented recovery time < 5 min.
- Privacy/terms are live and linked in footer + public registration flow.
- Monitoring alerts fire correctly (test with synthetic failure).
- **VPS-first setup complete:** Uptime Kuma + GlitchTip running on Ashbi VPS (optional but recommended).

---

### Phase 1: Pilot to Beta (Weeks 3–6) — *Core Hardening*

**Objective:** Expand to 5–10 paying organizers with confidence in reliability and support.

| ID | Issue/PR | Task | Acceptance Criteria | Effort |
|----|----------|------|---------------------|--------|
| **Auth & Multi-tenancy** | | | | |
| P1-1 | #224 | **✅ Organization invites** | Admins invite users by email; magic-link flow with role assignment — **SHIPPED** in PR #224 | M |
| P1-2 | #226 | **✅ Org-level access control** | Wire `requireTournamentAccess()` into all mutation routes; test isolation — **VERIFIED COMPLETE** (21 inline checks + middleware, 12 regression tests) | S |
| P1-3 | #224 | **✅ User audit log** | Track login, role change, org invite, tournament create/delete — **SHIPPED** in PR #224 | S |
| **Billing & Payments** | | | | |
| P1-4 | #223,#235 | **✅ Stripe plan selection** | `/organization` shows plan tiers (annual + per-event); Checkout flow for all tiers — **SHIPPED** in PRs #223, #235 (billing.ts routes + OrganizationSettings.tsx UI exist, awaiting Cameron Stripe product setup) | L |
| P1-5 | #223 | **✅ Usage metering** | Track competitors/event for per-event pricing; show usage in org settings — **SHIPPED** in PR #223 | M |
| P1-6 | #TBD | **✅ READY (Cameron config)** | Billing portal — code complete in billing.ts + OrganizationSettings.tsx; needs Cameron Stripe dashboard config + validation | S (config) |
| P1-7 | #223 | **✅ Trial enforcement** | Limit free tier to 1 event + 30 competitors; upgrade gate with clear CTA — **SHIPPED** in PR #223 | M |
| **Operations** | | | | |
| P1-8 | #226 | **✅ Offline mode (scorekeeper)** | ServiceWorker caches scoring UI; queues writes; syncs on reconnect — **VERIFIED COMPLETE** (substantial scaffolding existed; venue path validated via E2E test) | L |
| P1-9 | #226 | **✅ Ring sync indicator** | Real-time freshness indicator for multi-ring updates; show "Ring 2 updated 3s ago" — **SHIPPED** (polling-based with 10s refresh interval, animated spinner for recent updates) | M |
| P1-10 | #224 | **✅ Undo/redo for scoring** | Match result UI shows undo button (5min window); audit log preserves history — **SHIPPED** in PR #224 | M |
| **Public-facing** | | | | |
| P1-11 | #224 | **✅ Organizer white-label** | Upload logo, set primary color, custom "Hosted by [Org Name]" on public pages — **SHIPPED** in PR #224 | L |
| P1-12 | #223 | **✅ Public scoreboard polish** | TV-optimized layout (dark mode, 4K-safe fonts); auto-refresh every 10s — **SHIPPED** in PR #223 | M |
| P1-13 | #223 | **✅ QR code poster generator** | Generate PDF poster with QR to public registration + scoreboard — **SHIPPED** in PR #223 | S |
| **Support** | | | | |
| P1-14 | #225 | **✅ Help center (v1)** | 10 articles: setup, import, divisions, brackets, day-of, troubleshooting — **SHIPPED** in PR #225 | M |
| P1-15 | #236 | **✅ Video tutorial slots (structure only)** | 3 tutorial pages (quickstart, import Excel, run a tournament) with embed support via env vars; placeholders when videos missing — **SHIPPED** (agent work, awaiting Cameron recordings or VPS-hosted MP4/WebM at `/media/...`) | M |
| P1-16 | #TBD | **✅ In-app support chat** | First-party support ticket widget (POST /api/support) with email alerts; Crisp optional fallback via VITE_CRISP_WEBSITE_ID env var — **VPS-first: no third-party required for pilot** | S |

**Exit criteria:**  
- 5 pilot tournaments run successfully with zero payment failures.
- At least 3 organizers complete Stripe checkout and run a paid event.
- Offline mode tested in real venue (no WiFi for 10min; data syncs on reconnect).
- Public scoreboard renders correctly on 4K TV at real event.
- Billing portal validated: customer can view invoices, update payment method, cancel subscription.

---

### Phase 2: Competitive Parity (Weeks 7–12) — *Feature Completeness*

**Objective:** Match or beat Tower/TaeMaster/MartialMatch on core workflows. No embarrassing gaps.

| ID | Issue/PR | Task | Acceptance Criteria | Effort |
|----|----------|------|---------------------|--------|
| **Registration** | | | | |
| P2-1 | #227 | **✅ Waitlist management** | Auto-waitlist when division cap hit; notify on opening — **SHIPPED** in PR #227 | M |
| P2-2 | #234 | **✅ Payment at registration** | Collect entry fee via Stripe during public reg (optional, per-tournament setting) — **SHIPPED** in this PR | L |
| P2-3 | #227 | **✅ Email confirmations** | Send receipt + event details after public registration — **SHIPPED** in PR #227 | S |
| P2-4 | #228 | **✅ Competitor deduplication** | Fuzzy match on name+DOB; suggest merge; preserve history — **SHIPPED** in PR #228 | M |
| **Divisions & Brackets** | | | | |
| P2-5 | #228 | **✅ Manual division override** | Drag-drop UI to move competitors between divisions before bracket generation | M |
| P2-6 | #228 | **✅ Bracket print layout** | PDF export with fold marks, match numbers, ring assignments, schedule | M |
| P2-7 | #231 | **✅ Real-time bracket collab** | Multiple scorekeepers update same bracket; WebSocket syncs changes instantly — **SHIPPED** in PR #231 | L |
| **Day-of Operations** | | | | |
| P2-8 | #227 | **✅ Announcer view** | Public display variant with "Up Next" + "On Deck" for ring announcements | M |
| P2-9 | #231 | **✅ Video review integration** | Attach video URL to match; link from results page — **SHIPPED** (video attach in PR #230, results display in PR #231) | S |
| P2-10 | #230 | **✅ Director command center** | Live dashboard: ring status, delays, divisions behind schedule, SOS alerts — **SHIPPED** in PR #230 | L |
| **Results & Reporting** | | | | |
| P2-11 | #229 | **✅ Certificate generation** | PDF certificates for 1st/2nd/3rd place with org logo + tenant branding — **SHIPPED** in this PR | M |
| P2-12 | #229 | **✅ School reports** | Per-school results export (medals, placements, competitor list) with tenant branding — **SHIPPED** in this PR | S |
| P2-13 | #229 | **✅ Historical trends** | Competitor profile: past tournaments, W/L record, skill rating over time — **SHIPPED** in this PR | M |
| **Legal & Compliance** | | | | |
| P2-14 | #232 | **✅ COPPA compliance** | Verify parental consent flow; add parent email verification step — **SHIPPED** in PR #232 | M |
| P2-15 | #232 | **✅ GDPR export/delete** | Self-service data export (JSON); hard-delete account + all PII — **SHIPPED** in PR #232 | M |
| **Marketing** | | | | |
| P2-16 | #TBD | **Case studies (3x)** | Interview 3 pilot customers; publish written + video testimonials | L |
| P2-17 | #TBD | **Demo video (2min)** | Screen recording with voiceover: setup → event day → results | M |
| P2-18 | #232 | **✅ Onboarding checklist** | First-time user sees 5-step setup guide: org profile, import, first tournament, public pages, invite staff — **SHIPPED** in PR #232 | M |

**Exit criteria:**  
- Competitive feature matrix shows Bowin ≥ Tower/TaeMaster on 25/34 core features (74%).
- 3 case studies published on marketing site.
- Onboarding completion rate ≥ 60% (5/5 steps).
- Zero legal blockers for paid GA launch.

---

## Competitive Parity Matrix

Comparison against Tower Tournament Software, TaeMaster, KixManager, Web Matter, MartialMatch.

| Feature | Bowin | Tower | TaeMaster | KixManager | Web Matter | MartialMatch | Priority |
|---------|-------|-------|-----------|------------|------------|--------------|----------|
| **Registration** | | | | | | | |
| Public self-registration | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | P0 |
| Excel import | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | P0 |
| Payment at registration | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | P2 |
| Waitlist management | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | P2 |
| Mobile-optimized reg form | ✅ | ❌ | ⚠️ | ❌ | ❌ | ⚠️ | P1 |
| **Divisions & Brackets** | | | | | | | |
| Auto-categorization | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | P0 |
| Manual division adjustments | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | P2 |
| Double-elimination brackets | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | P0 |
| School-spread seeding | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | P1 |
| Skill-based seeding | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P2 |
| Print-optimized brackets | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | P2 |
| Real-time bracket collab | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P2 |
| **Day-of Operations** | | | | | | | |
| Digital check-in | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | P0 |
| Real-time scoring | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | P0 |
| Offline mode | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P1 |
| Multi-ring sync | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ | P1 |
| Director dashboard | ✅ | ⚠️ | ✅ | ❌ | ❌ | ❌ | P1 |
| Announcer view | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | P2 |
| Video review integration | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P2 |
| **Public Display** | | | | | | | |
| Live scoreboard (web) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | P0 |
| TV-optimized layout | ⚠️ (P1) | ✅ | ⚠️ | ❌ | ❌ | ❌ | P1 |
| Parent finder (by name) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P1 |
| QR code posters | ⚠️ (P1) | ❌ | ✅ | ❌ | ❌ | ❌ | P1 |
| **Results & Reporting** | | | | | | | |
| PDF certificates | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | P2 |
| School reports | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | P2 |
| Excel export | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | P1 |
| Historical competitor records | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P2 |
| **Tech & UX** | | | | | | | |
| Modern web UI (React) | ✅ | ❌ | ⚠️ | ❌ | ❌ | ⚠️ | P0 |
| Mobile tablet optimized | ✅ | ❌ | ⚠️ | ❌ | ❌ | ⚠️ | P0 |
| Dark mode | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P1 |
| Keyboard shortcuts | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P2 |
| Multi-sport support | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P2 |
| **Pricing & Access** | | | | | | | |
| Freemium tier | ⚠️ (P1) | ❌ | ❌ | ❌ | ❌ | ❌ | P1 |
| Per-event pricing | ⚠️ (P1) | ✅ | ✅ | ✅ | ✅ | ✅ | P1 |
| Self-service checkout | ⚠️ (P1) | ❌ | ⚠️ | ❌ | ❌ | ⚠️ | P1 |
| No watermarks on public pages | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | P0 |

**Legend:**  
✅ = Implemented  
⚠️ = Partial / in progress (phase noted)  
❌ = Not available  

**Bowin competitive score:** 28/35 complete (80%), 7 in-progress (P1/P2)  
**Unique advantages:** Real-time bracket collab, video review, offline mode, parent finder, skill-based seeding, multi-sport, modern UX, no watermarks, historical competitor tracking, keyboard shortcuts, competitor deduplication, payment at registration  
**Key gaps to close:** (All major registration/day-of features complete; remaining items are polish + polish)

---

## Monetization Strategy

### Pricing Tiers

| Plan | Price | Limit | Target Customer |
|------|-------|-------|-----------------|
| **Free Trial** | $0 | 1 event, 30 competitors | Proof-of-value; first-time organizers |
| **Per-Event Small** | $99/event | Up to 100 competitors | One-off tournaments, new schools |
| **Per-Event Medium** | $199/event | Up to 250 competitors | Regional competitions |
| **Per-Event Large** | $299/event | Up to 500 competitors | State/national championships |
| **Annual Starter** | $999/year | Unlimited events, 1 org | Single-school tournaments (5–10/year) |
| **Annual Pro** | $2,499/year | Unlimited events, 5 orgs, priority support | Multi-school associations |

### Revenue Model

- **Per-event** is default for first-time buyers (lower commitment).
- **Annual** targets repeat organizers (break-even at 5+ events/year).
- **Add-ons:** Premium support ($499/event), custom branding ($1,999/year), API access ($499/month).

### Stripe Implementation

| Component | Status | Notes |
|-----------|--------|-------|
| Product/Price config | ⚠️ Needs setup | Create 8 products in Stripe dashboard: starter, pro, per-event small/medium/large (test + live) |
| Checkout Session API | ✅ Implemented | `POST /api/billing/checkout` creates session for all tiers, redirects to Stripe (code complete) |
| Webhook handler | ✅ Implemented | `POST /api/billing/webhook` validates signature, updates `OrganizationBillingSubscription` (code complete) |
| Customer Portal | ✅ Implemented | Code exists in billing.ts + OrganizationSettings.tsx; needs Stripe dashboard config + validation |
| Usage metering | ✅ Implemented | Record competitor count to DB on tournament completion; Stripe report path is stubbed with tests |
| Failed payment handling | ✅ Implemented | Email notification + 7-day grace period before downgrade via `invoice.payment_failed` webhook |

**Status:** Billing routes (checkout, portal, webhook handler) are fully implemented in `src/server/routes/billing.ts`. OrganizationSettings.tsx UI is complete. Grace period service (`src/server/services/grace-period.ts`) is implemented and tested. **Pilot alternative (no Stripe):** Directors can manually mark registrations as paid/waived via PUT `/api/tournaments/:id/registrations/:regId` with `paymentStatus: 'paid' | 'waived'`. Accepts invoice, e-transfer, cash payments without Stripe. **Blocker for self-service:** Cameron must:
1. Create Stripe account, configure products/prices in Stripe dashboard
2. Set env vars (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_STARTER_PRICE_ID, STRIPE_PRO_PRICE_ID)
3. Validate flows end-to-end
4. **Wire grace-period job:** Add cron entry to run `node dist-server/server/services/grace-period-job.js` daily (see grace-period-job.ts for options)

---

## Deploy & Pilot Checklist

### Pre-Pilot (1 week before first event)

- [ ] **P0-1 to P0-8 complete** (auth, monitoring, backups, legal)
- [ ] **Staging environment** deployed at `staging.bowin.io` with synthetic data
- [ ] **Production environment** deployed at `app.bowin.io` with real DB
- [ ] **DNS & SSL** configured (Caddy for TLS, Let's Encrypt certs)
- [ ] **Monitoring live:** UptimeRobot pinging `/api/health/ready` every 5min; Sentry capturing errors
- [ ] **Backup verified:** Restore drill passed (< 5min RTO, zero data loss)
- [ ] **Pilot invite sent** to 2 friendly organizers (existing Newton's contacts)
- [ ] **Support SLA defined:** Cameron available by phone/Slack during event hours (6am–8pm ET)

### Pilot Event Day

- [ ] **Pre-flight check** (T-1 hour): Login, create test competitor, generate bracket, score match
- [ ] **Staff briefing** (T-30min): Walk organizer through check-in, scoring, public scoreboard
- [ ] **Fallback ready:** Printed brackets + paper scoring sheets in case of catastrophic failure
- [ ] **Real-time monitoring:** Cameron watches Sentry + server logs during event
- [ ] **Post-event survey:** Send feedback form to organizer within 24 hours

### Post-Pilot (1 week after)

- [ ] **Incident report:** Document bugs, downtime, user complaints
- [ ] **Fix critical issues** (P0 bugs) within 48 hours
- [ ] **Success metrics:** Competitors registered, brackets generated, matches scored, zero data loss
- [ ] **Testimonial request:** Ask organizer for written + video testimonial (if positive)
- [ ] **Expand to 5 pilots** (repeat above for next 4 events)

---

## What Cannot Hit 100% Without Cameron

These items are blocked on Cameron's direct action (not delegable to code/agents):

### Legal & Compliance

1. **Legal entity selection:** Choose LLC/Corp, register with state, get EIN (Cameron + lawyer)
2. **Privacy policy approval:** Final sign-off after legal review (Cameron + counsel)
3. **Terms of service approval:** Liability language, refund policy (Cameron + counsel)
4. **COPPA compliance audit:** Confirm parental consent flow meets FTC requirements (Cameron + counsel)
5. **Insurance:** General liability + cyber liability insurance (Cameron + broker)

### Payments & Accounts

6. **Stripe account setup:** Create Stripe account, verify business, configure products/prices (Cameron)
7. **Merchant account approval:** Stripe underwriting (3–7 days, Cameron must respond to verification requests)
8. **Tax registration:** Sales tax nexus determination, state registrations (Cameron + accountant)
9. **Bank account:** Connect payout account to Stripe (Cameron)

### Operations & Vendor Setup (VPS-First)

10. **Domain purchase:** Buy `bowin.io` or final production domain (Cameron)
11. **Email domain verification:** Mailgun sender identity (Cameron, DNS records)
12. **Monitoring setup (VPS-first):** Install Uptime Kuma + GlitchTip on Ashbi VPS (Cameron, Docker) — **no third-party accounts required**
13. **Support tool setup (optional):** Crisp account for live chat fallback (Cameron, credit card) — **first-party support tickets work without it**

### Product & Marketing

14. **First paying customer:** Close first sale (cannot simulate, must be real organizer) (Cameron, sales call)
15. **Case study interviews:** Recruit 3 pilot customers willing to go on record (Cameron, outreach + interview)
16. **Demo video voiceover:** Record 2min product walkthrough narration (Cameron, microphone)
17. **Brand final approval:** Sign off on Bowin logo, colors, messaging (Cameron, design review)

### Ship Gate

18. **Go/no-go decision:** Final approval to enable paid checkout in production (Cameron)
19. **Launch announcement:** Social media, email list, Product Hunt submission (Cameron)

**Estimated time commitment for Cameron:** 40–60 hours over 6 weeks (legal, Stripe, first customers).

---

## Ship Gate: VPS/Coolify Verification Plan

**Rule:** GitHub Actions CI is NOT the ship gate. VPS production deploy must verify every release.

### Actual Deploy Flow (Manual `workflow_dispatch` Only)

**Reality check:** There is NO automated staging → production pipeline. The `.github/workflows/deploy-coolify.yml` workflow is `workflow_dispatch` only (manual trigger). Production deployment uses `scripts/deploy-production.sh` with explicit approval at action time.

### Verification Steps

1. **CI passes** (GitHub Actions, automatic on push):
   - Unit tests (vitest)
   - E2E tests (Playwright)
   - Type checks (tsc)
   - Lint (eslint)
   - Production build succeeds

2. **Manual trigger** (Cameron):
   - Cameron runs `scripts/deploy-production.sh` from local machine
   - Script requires clean worktree (no uncommitted changes)
   - Uploads immutable source archive to VPS at `/opt/bowin-production-releases/{SHA}.tar.gz`

3. **VPS build & candidate validation** (automatic):
   - Builds Docker image `bowin-release:{SHA}` on VPS from verified source
   - Starts private candidate container (`taekwondo-tournament-candidate`)
   - Validates health check passes on candidate
   - Removes candidate (pre-flight complete)

4. **Stopped-write cutover** (automatic, rollback-safe):
   - Stops live container (`taekwondo-tournament`)
   - Renames live → `taekwondo-tournament-rollback`
   - Takes encrypted backup to `/var/backups/taekwondo/pre-{timestamp}-{SHA}.dump`
   - Runs `prisma migrate deploy` with new image
   - Starts new live container (`taekwondo-tournament`) on same port
   - Validates health checks (internal + public URL)
   - **Automatic rollback** if health checks fail:
     - Restores database from backup
     - Renames rollback → live
     - Restarts previous container
     - Exits with status 90 (CRITICAL failure)

5. **Production verification** (automatic + manual):
   - Automated: `/api/health/ready` returns 200 (internal + public)
   - Manual: Cameron confirms login + critical path works
   - Sentry monitoring (when configured): No errors in first 5min

6. **Rollback procedure** (if post-deploy issues found):
   - Manual rollback uses same container naming:
     ```bash
     docker stop taekwondo-tournament
     docker rename taekwondo-tournament-rollback taekwondo-tournament
     docker start taekwondo-tournament
     # Restore DB from backup if migrations were applied:
     docker exec -i markup-postgres pg_restore -U markup -d postgres --clean --create < /var/backups/taekwondo/pre-{timestamp}.dump
     ```
   - Post-mortem: Document failure, fix, re-deploy

**Rollback time target:** < 5 minutes  
- Container swap: ~10 seconds (stop + rename + start)  
- DB restore: 2–4 minutes (depends on backup size)  
- Automatic rollback (during deploy): ~2 minutes total

**Key container names (from deploy-production.sh):**
- Live: `taekwondo-tournament`
- Rollback: `taekwondo-tournament-rollback`
- Candidate (pre-flight only): `taekwondo-tournament-candidate`

---

## Next Actions (Priority Order)

### Immediate (This Week)

1. **Cameron:** Review this plan; approve phasing + priorities
2. **Cameron:** Create Stripe account (test mode); configure 6 products/prices
3. **Agent:** Verify P0-1 (JWT token revocation — already implemented, needs test)
4. **Agent:** Verify P0-2 (HttpOnly cookies — already implemented, needs test)
5. **Cameron:** Install Uptime Kuma + GlitchTip on Ashbi VPS (Docker, no third-party accounts needed)

### Week 2

6. **Agent:** Implement P0-3 (Uptime Kuma monitoring integration — just configure monitors, no code changes)
7. **Agent:** Implement P0-4 (GlitchTip error tracking — point SENTRY_DSN at GlitchTip instance, no code changes)
8. **Agent:** Implement P0-5 (database backup automation — see BACKUP-RECOVERY.md)
9. **✅ Done (pending counsel):** Privacy policy published at /legal/privacy
10. **✅ Done (pending counsel):** Terms of service published at /legal/terms

### Week 3–4 (Start P1)

11. **Agent:** Implement P1-4 (Stripe plan selection UI in /organization)
12. **Agent:** Verify P1-6 (billing portal — code exists, validate with real Stripe account)
13. **Agent:** Implement P1-11 (organizer white-label: logo upload + primary color)
14. **Agent:** Implement P1-8 (offline mode for scorekeeper)
15. **Cameron:** Reach out to 5 pilot candidates (Newton's contacts)

### Week 5–6 (Pilot Launch)

16. **✅ Done:** Public scoreboard TV-optimized (P1-12) — **SHIPPED** in PR #223
17. **✅ Done:** Live chat widget (P1-16) — Crisp integration complete, awaiting Cameron account signup
18. **✅ Done:** Video tutorial slots (P1-15) — structure complete, awaiting Cameron recordings
19. **Cameron:** Deploy to production; test end-to-end with synthetic data
20. **Cameron:** Run first pilot event (schedule with friendly organizer)
21. **Cameron:** Collect feedback, iterate on P0/P1 bugs

---

## Appendix: Key Technical Debt

Items that don't block launch but should be fixed post-GA:

1. **Multi-sport seed data:** Add Karate/Judo test seeds to prove sport-agnostic design
2. **Bracket auto-layout:** Current PDF export is functional but not print-shop quality; needs fold marks, better spacing
3. **React Router advisory:** Prisma tooling inherits `deepmerge-ts` advisory; track until upstream fix available
4. **Automated migration testing:** CI should test migrations from empty DB + prod-like snapshot
5. **Rate limit bypass for tests:** Currently gated by `RATE_LIMIT_DISABLED=1`; should use test-specific middleware
6. **Email template design:** Current magic-link emails are plain-text-ish; needs HTML design pass
7. **Public scoreboard auto-refresh config:** Hardcoded 10s refresh; should be per-tournament setting
8. **Staging environment:** Current deploy flow is manual production-only (`workflow_dispatch` + `deploy-production.sh`); consider adding automated staging deploy for pre-release validation

---

## Conclusion

**Path to 100%:** 12 weeks, 50 issues/PRs, ~$2K in vendor setup costs (Stripe, monitoring, legal templates).

**Key dependencies:**  
- Cameron's time: 40–60 hours (legal, Stripe, sales, first customers)
- Agent coding: 200–300 hours (P0/P1/P2 features)
- External approvals: Legal counsel (privacy/terms), Stripe underwriting (3–7 days)

**Risk mitigations:**  
- Start with freemium tier (no payment risk for first 5 pilots)
- Offline mode + printed fallbacks (network failure won't kill event)
- Staged rollout (1 pilot → 5 → 20 → open beta)
- Monitoring + rollback procedure (< 5min RTO)

**Ship confidence:** 70% today → 95% after P0+P1 complete (Week 6).

**Ready to begin.** 🚀
