# Tournament operations roadmap

What a tournament director still needs so the app fully replaces the old
spreadsheet + PDF workflow (Newton's Championship 2025:
`2025 NEWTONS CHAMPIONSHIP LIST.xlsm` and the `BB …` / `CB …` bracket PDF
folders at the repo root). Written 2026-10-02 from a comparison of those
files with the app, plus the owner's requests. Sizes: S = about a day,
M = a few days, L = a week or more.

## How the old workflow worked

- One big competitor list (683 rows: Gender, Name, Age, Belt, Dan, Height,
  Weight, School, Patterns Y/N, Sparring Y/N, Special Needs).
- Rows were copied into 8 sheets (Colour/Black belt × Male/Female ×
  Patterns/Sparring), sorted by age → belt → weight, and a blank row was
  typed between groups to make divisions. Big sparring groups were cut into
  Light / Middle / Heavy by weight, relative to the group (no fixed tables).
- Colour-belt age bands: 4-5, 6-7, 8-9, 10-11, 12-14, 15-17, 18-35, 36+.
  Black-belt bands: 11 & under, 12-13, 14-15, 16-17, 18-35, 36+.
- Belt ranges were stripe-level ("Yellow – Single Green Stripe"), dan
  ranges varied by division (1-2, 1-3, 3-6, 4-6).
- An Excel macro paired a filtered range (gender, age from/to, belt
  from/to, lb from/to) and counted same-school bouts.
- Brackets were a fillable single-elimination PDF (legal landscape,
  16 → 8 → 4 → 2 → winner, 1st/2nd/3rd boxes), each slot "Name / School",
  header like "SPARRING Males 10 - 11 Light", footer the belt or dan range.
- The host school had about 19% of all entries.

## Already in the app

Automatic divisions (belt tier, gender, age, event, weight or dan) with
split/merge; an editable rule set; seeding that avoids same-school first-round
pairs; single, double elimination and round robin; bracket, results,
certificate and school-report PDFs; ring schedule; drag-and-drop division
edits; bracket corrections with undo; Excel import with column auto-detection.

## Next, in order

### 1. Fair automatic sorting (fewer manual drags)
| # | What | Size |
|---|------|------|
| 1 | Make every rule in the rules editor actually do something, or hide the ones that don't. Bracket rules done (opt-in) and weight/split settings done (see below); still unused: merge direction, cross-tier merge, belts per division, belt tiers, single-year age bands and their minimum, event on/off and "group by", per-event overrides | M |
| 6 | Stripe-level belt grouping and configurable dan groups | M |
| 7 | Host-school balance: spread a big school across the bracket (school aliases and the "one school fills a division" warning are done, see below) | S |

### 2. Picking competitors and slots
| # | What | Size |
|---|------|------|
| 9 | Full-screen "add competitors" panel: filter by gender, age range, belt range, weight range, school; sortable columns; "select all filtered"; per-person Patterns/Sparring choice (mirrors the old macro form) | S–M |
| 10 | ~~Move people between bracket slots across matches, and add/remove a bye slot, without clearing the bracket~~ Done (see below) | M–L |
| 11 | Import straight into a tournament: rows marked Y for Patterns/Sparring become registrations for those events | M |

| 10 | Move people between bracket slots across matches, and add/remove a bye slot, without clearing the bracket | M–L |
| 11 | ~~Import straight into a tournament: rows marked Y for Patterns/Sparring become registrations for those events~~ Done (see below) | M |

### 3. Paper that matches what people know
| # | What | Size |
|---|------|------|
| ~~12~~ | Done 2026-10-03 — see below | M |
| ~~13~~ | Done 2026-10-03 — see below | S |
| ~~14~~ | Done 2026-10-03 — see below | S |

### 4. Smaller items
| # | What | Size |
|---|------|------|
| 15 | Show Special Needs on divisions (option for a separate division) | S |
| 17 | The bell icon in the top bar does nothing; wire it to real notifications or remove it | S |
| 18 | Bug reports: an optional AI pass that groups and ranks new "bug-report" support tickets | S–M |

| 16 | Use height as an optional tie-break in sparring splits | S |

## Done on 2026-10-03: fair divisions (items 2, 3, 4, 5, 7 in part, 16)
All opt-in under Tournament Settings → Categorization + Brackets; the
default rules give the same divisions as before.
- **2** Weight classes "Auto": each sparring group is sorted by weight and cut
  into Light / Middle / Heavy (up to "Most classes per group") of similar size.
- **3** "Keep similar people together when a division is too big": sparring
  splits by weight, patterns by age (or belt when splitting by belt).
- **4** "Hard limits by age" (most weight / age difference): merges that break
  a limit are blocked, automatic weight classes and splits keep to it, and the
  preview names the two people furthest apart in any division over a limit.
- **5** "Black belts use their own age bands" (11 & under, 12-13, ... editable).
- **7** School names match regardless of capitals, spaces and punctuation;
  organizer aliases ("Newtons TKD (Markham)" is "Newtons TKD") count as one
  school when spreading schools, plus an optional "one school is at least N%
  of a division" warning. Shared helper: `src/shared/utils/school.ts`.
- **16** "Use height when weights are the same" (sparring ordering).

## Done on 2026-10-03: fair brackets (item 1 in part, 8)
- Bracket rules can now be used when brackets are generated or reseeded,
  behind an opt-in switch "Use these bracket rules when brackets are made"
  (off by default; with it off brackets are made exactly as before): seed by
  (skill rating / years of training / belt rank / random), who gets byes,
  round 1 pairing, keep team-mates apart in round 1 (part of #1). The unused
  "Consolation rounds" choice is no longer shown.
- #8: same-school first-round fights shown per bracket (Divisions page,
  bracket editor) and for the whole tournament, and in the bracket API.

## Done on 2026-10-02 (for reference)
Tour fixed; form labels; restore deleted tournaments; backup panel refresh;
byes left out of match counts; Results empty state; Scorekeeper hint;
first-run setup key; decimal scores; clean import template; Scorekeeper
polish; "Report a bug" button.

## Done on 2026-10-03
Organizer branding (logo, name, colour) on the family portal, manage
registration, registration lookup and parent scoreboard pages; the
organization's colour now shows when a tournament has not picked its own.

Item 10 (2026-10-03): in the bracket editor a director taps Move next to a
first-round name and then taps another spot (or drags on a desktop) to move or
swap people across matches; "Take out (make a bye)" empties a spot and
"Place" puts someone without a spot into an empty one. Only unplayed
first-round matches change; later rounds re-sync. Changing the bracket size
(e.g. 8 to 16 spots) still needs Reseed.

- #11 Import straight into a tournament: "Import from spreadsheet" on the
  tournament page. Y/Yes/X/1 in an event column (found by the sport's event
  names, e.g. Kata/Kumite) registers that event; a preview shows new and
  matched competitors, registrations, waiting list and skipped rows before
  anything is saved. Existing competitors are reused, never changed.

- #12 Paper brackets: a "Classic" sheet per division (legal landscape,
  single-elimination 2/4/8/16/32 tree, "SPARRING Females 10 - 11 Heavy"
  header, "Name / School · dan" per slot, 1st/2nd/3rd boxes, belt or dan
  range footer). Winners fill in for single elimination; other formats
  print the starting names. "Paper brackets" on Divisions (one division or
  a ZIP of all, in `CB Females Sparring/` style folders) and Results.
- #13 Tournament Settings → "Bracket type" (double or single elimination)
  is used when brackets are made; double stays the default.
- #14 Schedule → "Print by ring": a ring-by-time grid using the bracket
  sheet names and the folder each sheet is in.

## Done on 2026-10-03 (small items)
- 15: Special-needs notes show for directors on the Divisions page (per
  division, expandable), in the bracket editor and on check-in. Not done: a
  one-click "separate division" option (`Division.isSpecialNeeds` exists but
  nothing uses it yet).
- 17: The bell lists real notifications (new registrations, waitlist,
  staffing gaps near the event, your own staff jobs, open support requests,
  invite problems) with an unread badge.
- 18: Admins can sort open bug reports with AI on Support Tickets when an AI
  key is set; suggestions are not stored, a priority is applied on request.

## Done on 2026-10-03 (private label)
Custom-domain home: an organizer's own web address opens on their events
(`/` and `/register`), sign-in unchanged; share kit on the tournament page
(sign-up link, QR code, website embed code); "bowin" hidden from parent
emails and page titles on the pro plan (`whiteLabel`).
