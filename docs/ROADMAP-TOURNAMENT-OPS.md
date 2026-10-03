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
| 1 | Make every rule in the rules editor actually do something (several settings such as "avoid same school in round 1", seeding strategy, bye placement, merge direction, belts per division, target class size are saved but not used), or hide the ones that don't | M |
| 2 | "Auto" weight classes: sort a group by weight and cut it into Light / Middle / Heavy of similar size, with a maximum weight gap | M |
| 3 | Split big divisions by weight (sparring) or age/belt (patterns) instead of dealing people out, then balance schools inside each part | S–M |
| 4 | Hard fairness limits per age band (max weight gap, max age gap): block merges that break them and highlight the unfair pairs | M |
| 5 | Separate age bands for colour belts and black belts (as the old sheets did) | S |
| 6 | Stripe-level belt grouping and configurable dan groups | M |
| 7 | Host-school balance: treat "Newtons TKD" and "Newtons TKD (Markham)" as one school (school aliases), spread a big school across the bracket, and warn when one school fills most of a division | M |
| 8 | Show the number of same-school first-round fights per bracket and for the whole tournament | S |

### 2. Picking competitors and slots
| # | What | Size |
|---|------|------|
| 9 | Full-screen "add competitors" panel: filter by gender, age range, belt range, weight range, school; sortable columns; "select all filtered"; per-person Patterns/Sparring choice (mirrors the old macro form) | S–M |
| 10 | Move people between bracket slots across matches, and add/remove a bye slot, without clearing the bracket | M–L |
| 11 | Import straight into a tournament: rows marked Y for Patterns/Sparring become registrations for those events | M |

### 3. Paper that matches what people know
| # | What | Size |
|---|------|------|
| 12 | "Classic" bracket PDF matching the old sheets (legal landscape, single elimination 16/8/4/2, belt/dan range footer, dan per slot, 1st/2nd/3rd boxes) and a ZIP of all brackets organised like the old folders | M |
| 13 | Tournament-level default bracket format (the old events used single elimination; the app defaults to double) | S |
| 14 | Printable ring-by-time schedule using the same division names as the bracket PDFs | S |

### 4. Smaller items
| # | What | Size |
|---|------|------|
| 15 | Show Special Needs on divisions (option for a separate division) | S |
| 16 | Use height as an optional tie-break in sparring splits | S |
| 17 | The bell icon in the top bar does nothing; wire it to real notifications or remove it | S |
| 18 | Bug reports: an optional AI pass that groups and ranks new "bug-report" support tickets | S–M |

## Done on 2026-10-02 (for reference)
Tour fixed; form labels; restore deleted tournaments; backup panel refresh;
byes left out of match counts; Results empty state; Scorekeeper hint;
first-run setup key; decimal scores; clean import template; Scorekeeper
polish; "Report a bug" button.

## Done on 2026-10-03
Organizer branding (logo, name, colour) on the family portal, manage
registration, registration lookup and parent scoreboard pages; the
organization's colour now shows when a tournament has not picked its own.
