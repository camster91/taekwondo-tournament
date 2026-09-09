# Bowin End-to-End Ship Plan — Path to 100%

**Created:** 2026-09-09  
**Owner:** Cameron (camster91)  
**Status:** Pre-pilot → Competitive GA  
**Repository:** camster91/taekwondo-tournament  
**Product name:** Bowin Tournament OS

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
| Competitor registry | 90% | 🟢 Strong | Excel import, search, soft-delete complete; needs merge/deduplication |
| Registration (staff) | 95% | 🟢 Strong | Bulk + manual registration complete |
| Registration (public) | 80% | 🟡 Needs work | Self-serve form complete; needs waitlist, payment gateway, confirmation emails |
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
| P0-1 | #TBD | **JWT token revocation** | Logout invalidates tokens server-side via `tokenVersion` bump; isActive flip kills all sessions | M |
| P0-2 | #TBD | **Auth: HttpOnly cookies** | Move JWT from localStorage to HttpOnly cookie; add CSRF protection | M |
| P0-3 | #TBD | **Uptime monitoring** | Add UptimeRobot/Pingdom for /api/health/ready; 5xx rate alerts to email/Slack | S |
| P0-4 | #TBD | **Error tracking** | Integrate Sentry (server + client); capture user context, breadcrumbs | S |
| P0-5 | #TBD | **Database backups** | Automate daily encrypted backups to off-host storage; test restore drill | M |
| P0-6 | #TBD | **Privacy policy v1** | Publish GDPR-compliant privacy notice covering minor data, retention, deletion | M (legal review) |
| P0-7 | #TBD | **Terms of service v1** | Publish organizer TOS covering liability, data ownership, refunds | M (legal review) |
| P0-8 | #TBD | **Parental consent flow** | Public registration requires parent/guardian checkbox + email for minors | M |

**Exit criteria:**  
- 1 pilot tournament completes with no security incidents, no data loss, and documented recovery time < 5 min.
- Privacy/terms are live and linked in footer + public registration flow.
- Monitoring alerts fire correctly (test with synthetic failure).

---

### Phase 1: Pilot to Beta (Weeks 3–6) — *Core Hardening*

**Objective:** Expand to 5–10 paying organizers with confidence in reliability and support.

| ID | Issue/PR | Task | Acceptance Criteria | Effort |
|----|----------|------|---------------------|--------|
| **Auth & Multi-tenancy** | | | | |
| P1-1 | #TBD | **Organization invites** | Admins invite users by email; magic-link flow with role assignment | M |
| P1-2 | #TBD | **Org-level access control** | Wire `requireTournamentAccess()` into all mutation routes; test isolation | S |
| P1-3 | #TBD | **User audit log** | Track login, role change, org invite, tournament create/delete | S |
| **Billing & Payments** | | | | |
| P1-4 | #TBD | **Stripe plan selection** | `/organization` shows plan tiers; Checkout flow for annual/per-event purchase | L |
| P1-5 | #TBD | **Usage metering** | Track competitors/event for per-event pricing; show usage in org settings | M |
| P1-6 | #TBD | **Billing portal** | Link to Stripe Customer Portal for invoices, payment method, cancel subscription | S |
| P1-7 | #TBD | **Trial enforcement** | Limit free tier to 1 event + 30 competitors; upgrade gate with clear CTA | M |
| **Operations** | | | | |
| P1-8 | #TBD | **Offline mode (scorekeeper)** | ServiceWorker caches scoring UI; queues writes; syncs on reconnect | L |
| P1-9 | #TBD | **Ring sync indicator** | Real-time WebSocket for multi-ring updates; show "Ring 2 updated 3s ago" | M |
| P1-10 | #TBD | **Undo/redo for scoring** | Match result UI shows undo button (5min window); audit log preserves history | M |
| **Public-facing** | | | | |
| P1-11 | #TBD | **Organizer white-label** | Upload logo, set primary color, custom "Hosted by [Org Name]" on public pages | L |
| P1-12 | #TBD | **Public scoreboard polish** | TV-optimized layout (dark mode, 4K-safe fonts); auto-refresh every 10s | M |
| P1-13 | #TBD | **QR code poster generator** | Generate PDF poster with QR to public registration + scoreboard | S |
| **Support** | | | | |
| P1-14 | #TBD | **Help center (v1)** | 10 articles: setup, import, divisions, brackets, day-of, troubleshooting | M |
| P1-15 | #TBD | **Video tutorials** | 3 videos: quickstart, import Excel, run a tournament | M |
| P1-16 | #TBD | **In-app live chat** | Integrate Intercom/Crisp; show for paying customers only | S |

**Exit criteria:**  
- 5 pilot tournaments run successfully with zero payment failures.
- At least 3 organizers complete checkout and run a paid event.
- Offline mode tested in real venue (no WiFi for 10min; data syncs on reconnect).
- Public scoreboard renders correctly on 4K TV at real event.

---

### Phase 2: Competitive Parity (Weeks 7–12) — *Feature Completeness*

**Objective:** Match or beat Tower/TaeMaster/MartialMatch on core workflows. No embarrassing gaps.

| ID | Issue/PR | Task | Acceptance Criteria | Effort |
|----|----------|------|---------------------|--------|
| **Registration** | | | | |
| P2-1 | #TBD | **Waitlist management** | Auto-waitlist when division cap hit; notify on opening | M |
| P2-2 | #TBD | **Payment at registration** | Collect entry fee via Stripe during public reg (optional, per-tournament setting) | L |
| P2-3 | #TBD | **Email confirmations** | Send receipt + event details after public registration | S |
| P2-4 | #TBD | **Competitor deduplication** | Fuzzy match on name+DOB; suggest merge; preserve history | M |
| **Divisions & Brackets** | | | | |
| P2-5 | #TBD | **Manual division override** | Drag-drop UI to move competitors between divisions before bracket generation | M |
| P2-6 | #TBD | **Bracket print layout** | PDF export with fold marks, match numbers, ring assignments, schedule | M |
| P2-7 | #TBD | **Real-time bracket collab** | Multiple scorekeepers update same bracket; WebSocket syncs changes instantly | L |
| **Day-of Operations** | | | | |
| P2-8 | #TBD | **Announcer view** | Public display variant with "Up Next" + "On Deck" for ring announcements | M |
| P2-9 | #TBD | **Video review integration** | Attach video URL to match; link from results page | S |
| P2-10 | #TBD | **Director command center** | Live dashboard: ring status, delays, divisions behind schedule, SOS alerts | L |
| **Results & Reporting** | | | | |
| P2-11 | #TBD | **Certificate generation** | PDF certificates for 1st/2nd/3rd place with org logo + signatures | M |
| P2-12 | #TBD | **School reports** | Per-school results export (medals, placements, competitor list) | S |
| P2-13 | #TBD | **Historical trends** | Competitor profile: past tournaments, W/L record, skill rating over time | M |
| **Legal & Compliance** | | | | |
| P2-14 | #TBD | **COPPA compliance** | Verify parental consent flow; add parent email verification step | M |
| P2-15 | #TBD | **GDPR export/delete** | Self-service data export (JSON); hard-delete account + all PII | M |
| **Marketing** | | | | |
| P2-16 | #TBD | **Case studies (3x)** | Interview 3 pilot customers; publish written + video testimonials | L |
| P2-17 | #TBD | **Demo video (2min)** | Screen recording with voiceover: setup → event day → results | M |
| P2-18 | #TBD | **Onboarding checklist** | First-time user sees 5-step setup guide: org profile, import, first tournament | M |

**Exit criteria:**  
- Competitive feature matrix shows Bowin ≥ Tower/TaeMaster on 15/20 core features.
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
| Payment at registration | ⚠️ (P2) | ✅ | ✅ | ❌ | ❌ | ✅ | P2 |
| Waitlist management | ⚠️ (P2) | ✅ | ❌ | ❌ | ❌ | ❌ | P2 |
| Mobile-optimized reg form | ✅ | ❌ | ⚠️ | ❌ | ❌ | ⚠️ | P1 |
| **Divisions & Brackets** | | | | | | | |
| Auto-categorization | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | P0 |
| Manual division adjustments | ⚠️ (P2) | ✅ | ✅ | ✅ | ✅ | ✅ | P2 |
| Double-elimination brackets | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | P0 |
| School-spread seeding | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | P1 |
| Skill-based seeding | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P2 |
| Print-optimized brackets | ⚠️ (P2) | ✅ | ✅ | ✅ | ✅ | ✅ | P2 |
| **Day-of Operations** | | | | | | | |
| Digital check-in | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | P0 |
| Real-time scoring | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | P0 |
| Offline mode | ⚠️ (P1) | ❌ | ❌ | ❌ | ❌ | ❌ | P1 |
| Multi-ring sync | ⚠️ (P1) | ✅ | ✅ | ✅ | ❌ | ⚠️ | P1 |
| Director dashboard | ✅ | ⚠️ | ✅ | ❌ | ❌ | ❌ | P1 |
| Announcer view | ⚠️ (P2) | ✅ | ❌ | ❌ | ❌ | ❌ | P2 |
| **Public Display** | | | | | | | |
| Live scoreboard (web) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | P0 |
| TV-optimized layout | ⚠️ (P1) | ✅ | ⚠️ | ❌ | ❌ | ❌ | P1 |
| Parent finder (by name) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P1 |
| QR code posters | ⚠️ (P1) | ❌ | ✅ | ❌ | ❌ | ❌ | P1 |
| **Results & Reporting** | | | | | | | |
| PDF certificates | ⚠️ (P2) | ✅ | ✅ | ✅ | ✅ | ✅ | P2 |
| School reports | ⚠️ (P2) | ✅ | ✅ | ✅ | ✅ | ✅ | P2 |
| Excel export | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | P1 |
| Historical competitor records | ⚠️ (P2) | ❌ | ❌ | ❌ | ❌ | ❌ | P2 |
| **Tech & UX** | | | | | | | |
| Modern web UI (React) | ✅ | ❌ | ⚠️ | ❌ | ❌ | ⚠️ | P0 |
| Mobile tablet optimized | ✅ | ❌ | ⚠️ | ❌ | ❌ | ⚠️ | P0 |
| Dark mode | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | P1 |
| Keyboard shortcuts | ⚠️ (P2) | ❌ | ❌ | ❌ | ❌ | ❌ | P2 |
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

**Bowin competitive score:** 18/32 complete (56%), 14 in-progress (P1/P2)  
**Unique advantages:** Offline mode, parent finder, skill-based seeding, multi-sport, modern UX, no watermarks  
**Key gaps to close:** Payment at reg, print layouts, announcer view, certificates

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
| Product/Price config | ⚠️ Needs setup | Create 6 products in Stripe dashboard (test + live) |
| Checkout Session API | ⚠️ In progress | `POST /api/billing/checkout` creates session, redirects to Stripe |
| Webhook handler | ⚠️ In progress | `POST /api/billing/webhook` validates signature, updates `OrganizationBillingSubscription` |
| Customer Portal | ❌ Not started | Link to Stripe portal from `/organization` |
| Usage metering | ❌ Not started | Report competitor count to Stripe on tournament completion |
| Failed payment handling | ❌ Not started | Email notification + grace period (7 days) before downgrade |

**Blocker:** Cameron must create Stripe account, configure products/prices, deploy webhook endpoint with signing secret.

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

### Operations & Vendor Setup

10. **Domain purchase:** Buy `bowin.io` or final production domain (Cameron)
11. **Email domain verification:** Mailgun sender identity (Cameron, DNS records)
12. **Monitoring accounts:** Sign up for UptimeRobot, Sentry (Cameron, credit card)
13. **Support tool setup:** Intercom/Crisp account for live chat (Cameron, credit card)

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

**Rule:** GitHub Actions CI is NOT the ship gate. VPS/Coolify must verify every release.

### Verification Steps

1. **CI passes** (GitHub Actions):
   - Unit tests (vitest)
   - E2E tests (Playwright)
   - Type checks (tsc)
   - Lint (eslint)
   - Production build succeeds

2. **Deploy to staging** (Coolify):
   - Automated deploy to `staging.bowin.io` on push to `main`
   - Smoke test: `/api/health/ready` returns 200
   - Manual smoke test: Login, create competitor, generate bracket, score match

3. **Staging approval** (human gate):
   - Cameron clicks "Approve" in Coolify UI after testing
   - Blocks production deploy until approval

4. **Deploy to production** (Coolify):
   - Automated deploy to `app.bowin.io` after staging approval
   - Database migrations run via `prisma migrate deploy`
   - Rollback container tagged as `bowin-rollback-{timestamp}`

5. **Production verification**:
   - Automated: `/api/health/ready` returns 200
   - Automated: Sentry reports no errors in first 5min
   - Manual: Cameron confirms login + critical path works

6. **Rollback procedure** (if verification fails):
   - Stop new container: `docker stop bowin-production`
   - Start rollback: `docker start bowin-rollback-{timestamp}`
   - Revert DB migrations if needed (manual, from backup)
   - Post-mortem: Document failure, fix, re-deploy

**Rollback time target:** < 5 minutes (container swap is instant; DB rollback adds 2–4min).

---

## Next Actions (Priority Order)

### Immediate (This Week)

1. **Cameron:** Review this plan; approve phasing + priorities
2. **Cameron:** Create Stripe account (test mode); configure 6 products/prices
3. **Agent:** Implement P0-1 (JWT token revocation via `tokenVersion`)
4. **Agent:** Implement P0-2 (HttpOnly cookies for auth)
5. **Cameron:** Sign up for UptimeRobot + Sentry (free tiers OK for pilot)

### Week 2

6. **Agent:** Implement P0-3 (uptime monitoring integration)
7. **Agent:** Implement P0-4 (Sentry error tracking)
8. **Agent:** Implement P0-5 (database backup automation)
9. **Cameron:** Draft privacy policy (use template + customize for Bowin)
10. **Cameron:** Draft terms of service (use SaaS template + customize)

### Week 3–4 (Start P1)

11. **Agent:** Implement P1-4 (Stripe checkout flow)
12. **Agent:** Implement P1-11 (organizer white-label: logo upload + primary color)
13. **Agent:** Implement P1-8 (offline mode for scorekeeper)
14. **Cameron:** Reach out to 5 pilot candidates (Newton's contacts)
15. **Cameron:** Record demo video (2min walkthrough)

### Week 5–6 (Pilot Launch)

16. **Agent:** Polish public scoreboard (P1-12: TV-optimized layout)
17. **Agent:** Implement P1-16 (live chat widget)
18. **Cameron:** Deploy to production; test end-to-end with synthetic data
19. **Cameron:** Run first pilot event (schedule with friendly organizer)
20. **Cameron:** Collect feedback, iterate on P0/P1 bugs

---

## Appendix: Key Technical Debt

Items that don't block launch but should be fixed post-GA:

1. **Rebrand completion:** Finish sweeping `tkd_*` localStorage keys → `bowin_*`; update email templates to remove "TKD Tournament Manager" branding
2. **Multi-sport seed data:** Add Karate/Judo test seeds to prove sport-agnostic design
3. **Bracket auto-layout:** Current PDF export is functional but not print-shop quality; needs fold marks, better spacing
4. **React Router advisory:** Prisma tooling inherits `deepmerge-ts` advisory; track until upstream fix available
5. **Automated migration testing:** CI should test migrations from empty DB + prod-like snapshot
6. **Rate limit bypass for tests:** Currently gated by `RATE_LIMIT_DISABLED=1`; should use test-specific middleware
7. **Email template design:** Current magic-link emails are plain-text-ish; needs HTML design pass
8. **Public scoreboard auto-refresh config:** Hardcoded 10s refresh; should be per-tournament setting
9. **Competitor merge UI:** Deduplication logic exists but no UI for human-in-the-loop merge
10. **Keyboard shortcuts:** Power users want `Cmd+K` command palette, arrow keys for bracket navigation

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
