# Tournament Manager — Operator Quickstart

A 1-page reference for running your first tournament. Assumes you've been
sent a `tkd.ashbi.ca` URL and want to run a real event end-to-end.

> 5 sections, ~5 minutes to read, ~30 minutes to follow along and run a
> first tournament. Save this in your bookmarks.

---

## 1. Sign in

You'll get an email from the platform admin with a magic link. Click it
once and you're in for 7 days — no password to remember during a busy
week.

If a separately approved demo environment has demo login enabled, click
**Try the demo** for a pre-loaded tour. Production keeps demo login disabled.

---

## 2. Create a tournament

**Tournaments → New Tournament**

You only need three fields:
- **Name** — what spectators see (e.g. `Spring Championship 2026`)
- **Date** — day of the event (week-of is fine, you can edit later)
- **Location** — venue name + city (full address added later)

Save. You now have a tournament in **draft** status. Open it.

---

## 3. Import competitors

**Two paths. Pick whichever matches your data:**

### Excel (recommended for 20+ kids)

**Tournament detail → Add Competitors → Import Excel**

Drop your `.xlsm` file. The app auto-detects columns by header name
(first name, last name, DOB, gender, belt, school, weight). A preview
shows the mapping before you commit. Fix any wrong columns in the UI.

### Manual (for a few additions)

**Competitors → Add Competitor** — one at a time.

> Tip: most dojangs already have a roster spreadsheet. Ask for it as
> `.xlsx` and import. Saves 2 hours of typing.

---

## 4. Set up registration + rules

**Tournament detail → Settings**

Two tabs:

- **Setup** — division threshold (max kids per division, default 8),
  registration fee notes ("$25 pay at door" or "Free"), share link.
- **Categorization + Brackets** — the rules engine. Default rules work
  for most dojangs (8 age bands, belt-tiered, 3-4 weight classes).
  Don't touch unless you have a specific reason.

**Open registration when ready:**
- Tournament detail → green banner at top → **Open Registration**
- Copy the public URL, send it to parents in your WhatsApp / email /
  printed flyer.

> The share link section in Settings gives you a separate read-only
> URL for the live scoreboard. Generate it on tournament day when you
> want spectators watching on a TV.

---

## 5. Run the day-of

**Three tabs, three roles. You can use one laptop and switch between them.**

### Check-in (`/checkin/:id`)

Weigh kids, mark them present. Each competitor shows their declared
weight vs. measured. Anyone who fails to show up is greyed-out and
excluded from bracket generation.

If venue Wi-Fi drops, individual and bulk check-ins are saved on that
device for the signed-in operator. The pending-work banner shows what is
waiting. Reconnect and use **Sync now**; review or discard any item the
server rejects instead of entering it twice.

### Scorekeeper (`/scorekeeper/:id`)

The bracket view. Click a competitor to mark them winner, enter the
score, press Enter to confirm. Division auto-advances to next match.

If the connection drops while recording a result, the result is saved
on that device for the signed-in scorekeeper and the match is removed
from the ready queue. Reconnect and use **Sync now** in the pending-work
banner. A rejected result is held for review and is never silently
overwritten.

**Keyboard shortcuts** (much faster than clicking):

| Key | Action |
|---|---|
| `1` / `2` | Pick competitor 1 or 2 as winner |
| `←` / `→` | Previous / next match |
| `Enter` | Confirm winner + advance |
| `Esc` | Back to division picker |
| `w` | Result type: Win |
| `d` | Result type: DQ |
| `f` | Result type: Forfeit |
| `i` | Result type: Injury |
| `?` | Toggle this help |
| `t` | Toggle match timer on/off |

### Public Display (`/display/:id`)

Big-screen TV mode. Auto-refreshes every 5 seconds. Shows now-competing
matches, recent results, up-next queue, and per-division progress.

Put a laptop connected to the venue TV on this URL. No login needed —
it's the share-link URL you generated in Settings.

---

## 6. After the tournament

**Results** — final placements, medals, division standings. Export as
PDF for the dojang newsletter.

**Tournament detail → Trash** — if you delete by mistake, you have
the configured retention window to recover from the Trash view. The
production operator currently plans a 7-day window, but permanent purge
must be enabled only after the published retention policy is approved.

---

## Common gotchas

- **"Why is the share link button grayed out?"** — You need to be on
  the tournament's Settings page as admin/director. Viewers and parents
  don't see it.

- **"The bracket is missing matches."** — Some divisions have <2
  competitors after check-in. The auto-categorizer merges small
  divisions. Check the Divisions page warning banner.

- **"I can't find my tournament."** — Soft-deleted tournaments go to
  Trash for the configured retention window. Check there.

- **"Demo data is showing instead of my real tournament."** — You
  logged in via the demo button. Sign out and sign in with your real
  email link.

- **"Public registration page is blank."** — The tournament is in
  `draft` or `completed` status. Open it for registration first.

---

## Where to get help

- **App issues / bugs:** check the GitHub repo or message the platform
  admin who sent you the invite.
- **Tournament-rules questions:** the rules engine was tuned for the
  Newton's Championship 2025 format. If your format is unusual (e.g.
  round-robin pools instead of double-elim), ask before changing rules.
- **Lost your magic link:** sign in again with the same email; the
  system will send a new one.

> Release candidate verified locally on 2026-08-07 with 473 automated
> unit/integration tests and 120 browser workflows across Chromium,
> Firefox, and WebKit against a disposable
> PostgreSQL 16 database. Production deployment and venue-device smoke
> testing remain required before launch.
