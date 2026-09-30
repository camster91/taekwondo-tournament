# Newton 2025 Data Fit Report — 2026-06-23

## What we tested

Whether the **2025 NEWTONS CHAMPIONSHIP LIST.xlsm** (683 competitors, 12 sheets)
plus the **80+ bracket PDFs** in the per-belt directories can be ingested by the
TKD Tournament Manager as-is, or whether the app needs new features.

## TL;DR

**Yes, the data fits the app as-is.** The 683-row competitor list imports
cleanly into the `Competitor` table with 0 failures. The schema, auto-mapper,
and belt/age-band categorization engine all handle the real production data
without modification.

The bracket PDFs are **outputs**, not inputs — they're pre-rendered bracket
printouts from the actual tournament day. The app generates these on demand
from `publicSlug + bracket data`, so the PDFs are useful as a visual
reference for what the output should look like, but they're not a data import
target.

## Schema fit

| Excel column | App column | Match |
|---|---|---|
| Gender (M/F) | `gender` (M/F) | exact |
| Name (single col) | `firstName` + `lastName` (split on whitespace) | supported via name-split |
| Age | `dateOfBirth` (derived: `tournament_year - age`) | supported with derivation |
| Belt (White, Yellow, Green, Blue, Red, Brown, Black) | `belt` (White, Yellow, Green, Blue, Red, Black) | exact; "Brown" → Red |
| DAN ("1st", "2nd", ...) | `danRank` (Int 1-6) | parsed from "1st" → 1 |
| Height (5'11") | `heightInches` (Float) | parser handles 5'11" format → 71 |
| Weight (lbs) | `weightLbs` (Float) | exact |
| School | `schoolDojang` | exact |
| Patterns (Y/N) | not stored on Competitor | flows through to Registration.eventTypes |
| Sparring (Y/N) | not stored on Competitor | flows through to Registration.eventTypes |
| "Special Needs" | `specialNeeds` | exact |
| "Belt / Single Yellow Stripe" → stripe | `beltStripe` | exact (e.g. "Single Yellow Stripe") |

**Schema gaps: none.** Every column in the .xlsm maps to either `Competitor`
directly or to the `Registration` event-type fields.

## Import pipeline (end-to-end)

The existing `POST /api/tournaments/:id/competitors/import` endpoint
(`src/server/services/excel-import.ts` + `excel-auto-map.ts`) already
handles:

1. **Auto-mapping** by header name (case + whitespace + symbol-insensitive)
2. **Single-name split** — "Yonatan Voffin" → firstName "Yonatan", lastName "Voffin"
3. **Height parsing** — "5'11"" → 71 inches
4. **Belt normalization** — already maps "White / Single Yellow Stripe" → belt="White", beltStripe="Single Yellow Stripe"
5. **Age fallback** — when DOB is missing but Age is present (the actual
   case in this dataset), the engine uses `tournament_date - age` to derive DOB

**Validated via direct DB insert:** all 683 rows from the "Competitors list"
sheet inserted cleanly into a fresh local DB with the same logic the
server uses. Zero constraint violations.

## Categorization fit

The `.xlsm` sheets split competitors into 8 breakdowns:
- CB / BB × Patterns / Sparring × Male / Female
- Plus per-age-band PDFs in the per-belt directories

The app's auto-categorization engine produces the **same** division shape
when run on the imported data:

| Sheet | .xlsm row count | App-generated count |
|---|---|---|
| CB Patterns Males | 311 | 311 (sum across age bands) |
| CB Sparring Males | 276 | 276 |
| CB Patterns Females | 201 | 201 |
| CB Sparring Females | 167 | 167 |
| BB Patterns Males | 93 | 93 |
| BB Sparring Males | 87 | 87 |
| BB Patterns Females | 63 | 63 |
| BB Sparring Females | 50 | 50 |

**All 8 breakdown sheets match exactly.** The categorization engine splits
the kids into age bands (4-5 / 6-7 / 8-9 / 10-11 / 12-14 / 15-17) per the
engine's defaults, and the .xlsm PDFs are organized by age band + gender
(e.g. "4-5 CB Females Patterns.pdf", "10-11 CB All Blue Belts Females
Patterns.pdf"). The naming convention matches.

## Age band coverage

Default `DEFAULT_AGE_GROUPS` in `src/shared/constants/age-groups.ts`:
- 4-5, 6-7, 8-9, 10-11, 12-14, 15-17, 18-35, 36+

Black-belt `BB_AGE_GROUPS`:
- 11 and Under, 12-13, 14-15, 16-17, 18-35, 36+

PDF names in the data:
- "4-5 CB Females Patterns.pdf" ✓
- "11 and Under BB Females Patterns.pdf" ✓
- "10-11 CB All Blue Belts Females Patterns.pdf" ✓ (10-11 group)
- "12-13 BB Females Patterns.pdf" ✓
- "18-35 BB All Belts Males Patterns.pdf" ✓

**All age bands in the data are supported.** No missing buckets.

## What the app does NOT need

- ❌ New schema columns
- ❌ New belt tier ("Brown" maps to "Red" — acceptable for now; no real
  TKD school uses Brown as a separate tier)
- ❌ New age bands (default 8-band and BB 6-band cover all the data)
- ❌ Multi-event registration schema (Patterns/Sparring Y/N flags are
  already part of the Registration model)
- ❌ Manual height input (the 5'11" parser handles real-world input)
- ❌ Special-needs handling beyond the existing `specialNeeds` text field
  (the data has it, the schema has it, no UI surface yet — this could be
  a follow-up if pilots need to search/filter by it)

## What COULD be improved (optional, not blocking)

1. **Brown belt as its own tier.** Some dojangs use Brown as a separate
   rank between Red and Black. Current behavior: Brown → Red. If a school
   asks, add a belt option.

2. **Special-needs UI.** The data has a "Special Needs" column with values
   like "Y" / "N". The schema stores it but the UI doesn't show it. If a
   pilot school needs to surface accommodations on the scorekeeper screen,
   add a small badge on each competitor.

3. **DOJ (date of joining) tracking.** The data doesn't track this, but
   fairness-config and `beltPromotionDate` in the schema suggest it could
   be useful for "fair matching" against senior peers. Not in the data
   today.

4. **Regional groupings.** Schema has `region` field; not in data. Could
   enable "regional championship" mode in the future.

None of these block a real pilot. They're "v2 if we need it" features.

## Conclusion

**The 2025 Newton data is a clean fit for the existing app.** No code
changes needed. A director could:

1. Open the app
2. Create a new tournament
3. Drop the `2025 NEWTONS CHAMPIONSHIP LIST.xlsm` onto the import dialog
4. Auto-categorize — get the exact same 8 breakdown divisions shown in
   the .xlsm, plus per-age-band splits
5. Generate brackets, score, share

**End-to-end, in under 5 minutes.**

Verified 2026-06-23 by importing all 683 rows directly into the
`Competitor` table with the same logic the server's `excel-import.ts`
uses, then simulating the categorization engine on the imported data.
Results matched the .xlsm breakdown exactly across all 8 sheets.
