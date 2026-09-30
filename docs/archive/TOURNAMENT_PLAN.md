# Tournament Management System - Comprehensive Feature Plan

This document outlines the complete feature set needed to build a self-contained tournament management system that fully replaces the Excel-based workflow.

---

## Table of Contents

1. [Core Principles](#core-principles)
2. [Tournament Lifecycle](#tournament-lifecycle)
3. [Competitor Management](#competitor-management)
4. [Smart Registration](#smart-registration)
5. [Auto-Categorization Engine](#auto-categorization-engine)
6. [Fairness & Competition Rules](#fairness--competition-rules)
7. [Bracket Management](#bracket-management)
8. [Scheduling System](#scheduling-system)
9. [Live Tournament Operations](#live-tournament-operations)
10. [Results & Reporting](#results--reporting)
11. [Admin Features](#admin-features)
12. [Implementation Phases](#implementation-phases)

---

## Core Principles

### Minimize User Input
- **Auto-calculate** all derived fields (age, weight class, division)
- **Smart defaults** based on tournament type and historical data
- **Bulk operations** for common tasks
- **Import from Excel** as migration path from legacy system

### Enforce Fairness
- **Mandatory school spreading** to prevent same-school first-round matchups
- **Weight verification** at check-in for sparring
- **Age verification** against date of birth
- **Random seeding within constraints** to prevent manipulation

### Maintain Flexibility
- **Override capabilities** for tournament directors
- **Manual division adjustments** when auto-categorization doesn't fit
- **Custom age groups and weight classes** per tournament

---

## Tournament Lifecycle

### Status Flow
```
┌─────────┐    ┌──────────────┐    ┌──────────┐    ┌─────────────┐    ┌───────────┐
│  DRAFT  │ →  │ REGISTRATION │ →  │ BRACKETS │ →  │ IN_PROGRESS │ →  │ COMPLETED │
└─────────┘    └──────────────┘    └──────────┘    └─────────────┘    └───────────┘
     │                │                  │                 │                 │
     │                │                  │                 │                 │
  Configure        Accept            Generate          Run matches       Archive
  settings       registrations       divisions          & record         results
```

### Phase: DRAFT
**Admin Actions:**
- [ ] Set tournament name, date, location
- [ ] Configure age groups (or use defaults)
- [ ] Configure weight classes (or use defaults)
- [ ] Set division threshold (default: 8)
- [ ] Enable/disable event types (patterns, sparring)
- [ ] Set registration deadline
- [ ] Generate shareable registration link

**Auto-Actions:**
- Tournament created with sensible defaults
- Default age groups pre-populated
- Default weight classes pre-populated

### Phase: REGISTRATION
**Admin Actions:**
- [ ] Monitor incoming registrations
- [ ] Bulk import from Excel (migration)
- [ ] Manual add/edit competitors
- [ ] View registration statistics

**Public Actions:**
- [ ] Self-registration via public portal
- [ ] View open tournaments
- [ ] Check registration status

**Auto-Actions:**
- Age calculated from DOB and tournament date
- Duplicate detection (name + DOB match)
- Validation of required fields

### Phase: BRACKETS
**Admin Actions:**
- [ ] Review auto-generated divisions
- [ ] Adjust divisions manually if needed
- [ ] Move competitors between divisions
- [ ] Split/merge divisions
- [ ] Generate brackets with one click
- [ ] Review seeding (school spread applied)
- [ ] Export bracket PDFs
- [ ] Generate tournament schedule

**Auto-Actions:**
- Divisions created based on 6-factor categorization
- Large divisions (>8) automatically split
- Small groups (<3) flagged for review
- School-spread seeding applied
- BYE matches auto-advanced

### Phase: IN_PROGRESS
**Admin/Scorekeeper Actions:**
- [ ] Record match results
- [ ] Handle disputes (DQ, injury, no-show)
- [ ] View live bracket updates
- [ ] Announce upcoming matches
- [ ] Display public scoreboard

**Auto-Actions:**
- Winners automatically advance to next match
- Losers advance to losers bracket
- Match status updates in real-time
- Placements calculated when bracket completes

### Phase: COMPLETED
**Admin Actions:**
- [ ] Review final results
- [ ] Export results PDF/Excel
- [ ] Generate certificates (future)
- [ ] Archive tournament

---

## Competitor Management

### Persistent Registry
Competitors are stored permanently and reused across tournaments.

**Fields:**
| Field | Required | Description | Auto-Calculated |
|-------|----------|-------------|-----------------|
| First Name | Yes | Legal first name | No |
| Last Name | Yes | Legal last name | No |
| Gender | Yes | M or F | No |
| Date of Birth | Yes | For age calculation | No |
| Belt | Yes | Current belt rank | No |
| Belt Stripe | No | e.g., "Single Yellow Stripe" | No |
| Dan Rank | If BB | 1-6 for black belts | No |
| Height (inches) | No | Physical measurement | No |
| Weight (lbs) | If sparring | For weight class | No |
| School/Dojang | Recommended | For seeding/reporting | No |
| Special Needs | No | Accommodations needed | No |
| Age | - | At tournament date | Yes |
| Belt Level | - | BB or CB | Yes |
| Weight Class | - | Based on age/gender/weight | Yes |

### Duplicate Detection
- Match on: First Name + Last Name + DOB
- If match found: Update existing record
- If no match: Create new record

### Belt Normalization
```
Input → Normalized
─────────────────────────
"W" → "White"
"WHITE" → "White"
"BL" → "Black"
"BB" → "Black"
"1st Dan" → Belt: "Black", DanRank: 1
"White / Single Yellow Stripe" → Belt: "White", Stripe: "Single Yellow"
```

---

## Smart Registration

### Public Registration Portal (`/register`)

**Minimal Required Fields:**
1. Tournament selection (dropdown of open tournaments)
2. First name
3. Last name
4. Gender
5. Date of birth
6. Belt level
7. Event selection (patterns and/or sparring)
8. Weight (required if sparring selected)

**Optional Fields:**
- Height
- School/Dojang
- Special needs
- Parent/Guardian contact

**Smart Features:**
- [ ] Auto-complete school name from existing schools
- [ ] Belt dropdown with visual colors
- [ ] Age displayed after DOB entered (confirmation)
- [ ] Weight class shown after weight entered
- [ ] Duplicate warning if similar name exists
- [ ] Success email confirmation (future)

### Bulk Import (Admin)
- Import from Excel file matching legacy format
- Column mapping interface for flexibility
- Preview before import
- Error report for invalid rows
- Skip duplicates option

---

## Auto-Categorization Engine

### 6-Factor Division Creation

Divisions are automatically created based on:

```
Division = f(Belt Level, Gender, Event Type, Age Group, Belt Color, Weight Class)
```

**Factor 1: Belt Level**
- BB (Black Belt) - dan ranks 1-6
- CB (Colored Belt) - white through red

**Factor 2: Gender**
- Males
- Females
- (No mixed-gender divisions)

**Factor 3: Event Type**
- Patterns (Forms/Poomsae)
- Sparring (Fighting)

**Factor 4: Age Group**
| Colored Belt | Black Belt |
|--------------|------------|
| 4-5 | 11 and Under |
| 6-7 | 12-13 |
| 8-9 | 14-15 |
| 10-11 | 16-17 |
| 12-14 | 18-35 |
| 15-17 | 36+ |
| 18-35 | |
| 36+ | |

**Factor 5: Belt Grouping (CB Patterns only)**
- Individual belts (White, Yellow, Green, Blue, Red)
- Combined groups for small populations

**Factor 6: Weight Class (Sparring only)**
| Age | Classes |
|-----|---------|
| 4-5 | None (combined) |
| 6-7 | Light, Middle, Heavy |
| 8-9 | Light, Middle, Heavy |
| 10-11 | Light, Middle, Heavy |
| 12-14 | Feather, Light, Middle, Heavy |
| 15-17 | Light, Middle, Heavy |
| 18-35 | Light, Middle, Heavy |
| 36+ | Light, Middle, Heavy |

### Division Splitting Rules

```
IF competitors > 8:
  Split into ceil(competitors / 8) divisions
  Name: "[Original Name] DIV1", "DIV2", etc.
  Distribute competitors using school interleaving

IF competitors < 3:
  Flag for manual review
  Suggest: Combine with adjacent age/belt group
```

### Division Naming Convention

```
Patterns:
  "[Age Range] [Belt Level]-[Belt Desc] [Gender] Patterns"
  Example: "10-11 CB-All Green Belts Males Patterns"

Sparring:
  "[Age Range] [Belt Level]-[Belt Desc] [Gender] Sparring [Weight]"
  Example: "12-14 CB-All Blue Belts Females Sparring Middle"

Black Belt:
  "[Age Range] BB [Dan Range] [Gender] [Event] [Weight?]"
  Example: "18-35 BB 1st-2nd Dan Males Sparring Heavy"
```

---

## Fairness & Competition Rules

### School Spreading Algorithm

**Goal:** Minimize same-school matchups in first round.

**Algorithm:**
```
1. Group competitors by school
2. Sort schools by size (largest first)
3. Assign to bracket positions using spread pattern:
   Position order: [0, 4, 2, 6, 1, 5, 3, 7]
4. This ensures same-school competitors land in different bracket quadrants
```

**Example (8 competitors, 2 schools):**
```
School A: Alice, Bob, Charlie, David
School B: Eve, Frank, Grace, Henry

Spread assignment:
  Pos 0: Alice (A)    Pos 4: Bob (A)
  Pos 2: Charlie (A)  Pos 6: David (A)
  Pos 1: Eve (B)      Pos 5: Frank (B)
  Pos 3: Grace (B)    Pos 7: Henry (B)

First round matchups:
  Match 1: Alice (A) vs Henry (B) ✓ Different schools
  Match 2: David (A) vs Eve (B) ✓ Different schools
  Match 3: Bob (A) vs Grace (B) ✓ Different schools
  Match 4: Charlie (A) vs Frank (B) ✓ Different schools
```

### Weight Verification

**At Registration:**
- Self-reported weight accepted
- Weight class auto-assigned

**At Check-In (Future Feature):**
- Official weigh-in
- Weight recorded and compared to registration
- If >2 lbs over class limit: Move to higher class
- If >5 lbs over: Disqualification option

### Age Verification

**Automatic:**
- Age calculated from DOB on tournament date
- No manual override of age

**Edge Cases:**
- Birthday ON tournament date: New age used
- Competitors must be 4+ years old

### Match Result Rules

**Valid Outcomes:**
| Result | Description |
|--------|-------------|
| WIN | Normal victory (points) |
| DQ | Disqualification (rules violation) |
| FORFEIT | No-show or withdrawal |
| INJURY | Medical stoppage |
| BYE | Auto-advance (no opponent) |

**Scoring:**
- Points recorded for both competitors
- Winner must be selected to advance
- Notes field for special circumstances

---

## Bracket Management

### Double-Elimination Structure

**For 8 competitors:**
```
Winners Bracket (7 matches):
  Round 1: 4 matches (quarterfinals)
  Round 2: 2 matches (semifinals)
  Round 3: 1 match (winners final)

Losers Bracket (6 matches):
  Round 1: 2 matches (losers from R1)
  Round 2: 1 match
  Round 3: 2 matches
  Round 4: 1 match (losers final)

Finals (1-2 matches):
  Grand Finals: Winners champ vs Losers champ
  Reset: If losers champ wins, one more match
```

**Match Progression:**
```
Winners R1 Winner → Winners R2
Winners R1 Loser → Losers R1
Winners R2 Loser → Losers R3
Winners Final Loser → Losers Final
```

### BYE Handling

- BYEs placed for odd competitor counts
- Auto-advance BYE winner immediately
- BYE matches marked as "completed" with status "bye"

### Seeding Options

| Strategy | Description |
|----------|-------------|
| school_spread | Minimize same-school first round (default) |
| random | Pure random assignment |
| manual | Tournament director sets positions |

---

## Scheduling System

### Automatic Schedule Generation

**Inputs:**
- List of divisions with competitor counts
- Number of available rings
- Start time, end time
- Match duration estimates:
  - Patterns: 5 minutes per match
  - Sparring: 8 minutes per match
- Break between divisions: 5 minutes

**Algorithm:**
```
1. Estimate total time per division:
   duration = (matches * match_time) + break_time

2. Sort divisions by event type (patterns first)

3. Assign to rings using greedy scheduling:
   For each division:
     Find ring with earliest available slot
     Assign division to that ring/time

4. Generate warnings for:
   - Schedule extends past end time
   - Ring imbalance (one ring much busier)
```

**Output:**
- Division → Ring assignment
- Division → Start time
- Match → Scheduled time
- Master schedule PDF

### Manual Adjustments
- Drag-drop divisions between rings
- Adjust start times
- Add breaks
- Lock specific assignments

---

## Live Tournament Operations

### Scorekeeper Interface

**Per-Ring View:**
- Current match details
- Both competitors displayed
- Score entry fields
- Winner selection buttons
- Quick actions: DQ, Forfeit, Injury
- Auto-advance to next match

**Features:**
- [ ] Large touch-friendly buttons
- [ ] Confirmation before submit
- [ ] Undo last result (with permission)
- [ ] Timer integration (future)

### Public Scoreboard

**Display Modes:**
1. **Current Match** - Full screen showing active match
2. **Up Next** - Queue of upcoming matches
3. **Bracket View** - Live bracket with results
4. **Results** - Recent completed matches

**Auto-Refresh:**
- WebSocket updates (real-time)
- Fallback: 5-second polling

### Announcer View

- List of matches by status:
  - On Deck (next 3 matches)
  - In Progress (current matches)
  - Just Completed (last 5 results)
- Ring-specific filtering
- Competitor names and schools for announcements

---

## Results & Reporting

### Placements

**Per Division:**
- 1st Place: Winner of grand finals
- 2nd Place: Loser of grand finals
- 3rd Place: Two competitors (losers semifinal and losers final)

### Export Formats

**PDF Exports:**
- [ ] Individual bracket (blank for printing)
- [ ] Individual bracket (with results)
- [ ] All brackets (batch PDF)
- [ ] Tournament results summary
- [ ] Medal count by school

**Excel Exports:**
- [ ] Complete results spreadsheet
- [ ] Competitor list with placements
- [ ] School standings

### Statistics

**Tournament Stats:**
- Total competitors
- Competitors per event (patterns/sparring)
- Division count
- Match count
- Average matches per competitor

**School Stats:**
- Medal counts (gold/silver/bronze)
- Participation counts
- Win percentages

---

## Admin Features

### User Roles

| Role | Permissions |
|------|-------------|
| Admin | Full access, user management |
| Director | Tournament config, divisions, brackets |
| Scorekeeper | Record results only |
| Viewer | Read-only access |

### Tournament Configuration

**Customizable Settings:**
```json
{
  "divisionThreshold": 8,
  "minDivisionSize": 1,
  "warningThreshold": 3,
  "allowSameSchoolFirstRound": false,
  "requireWeightForSparring": true,
  "allowLateRegistration": false,
  "autoAdvanceByes": true,
  "patterns": {
    "enabled": true,
    "matchDuration": 5
  },
  "sparring": {
    "enabled": true,
    "matchDuration": 8,
    "roundDuration": 2,
    "rounds": 3
  }
}
```

### Audit Trail
- All changes logged with user and timestamp
- Match result history (before/after)
- Division assignment changes

---

## Implementation Phases

### Phase 1: Core Workflow (Current)
- [x] Competitor CRUD
- [x] Tournament CRUD
- [x] Registration system
- [x] Auto-categorization engine
- [x] Bracket generation
- [x] PDF export
- [x] Public registration portal

### Phase 2: Enhanced Operations
- [ ] Match advancement logic (in progress)
- [ ] Live bracket updates
- [ ] Scorekeeper interface
- [ ] Schedule generation
- [ ] Check-in system

### Phase 3: Public Features
- [ ] Public scoreboard/display
- [ ] Real-time WebSocket updates
- [ ] Mobile-optimized views
- [ ] QR code bracket access

### Phase 4: Advanced Features
- [ ] Email notifications
- [ ] Certificate generation
- [ ] Historical statistics
- [ ] Multi-tournament series
- [ ] Team competitions

### Phase 5: Polish
- [ ] Offline mode (PWA)
- [ ] Accessibility improvements
- [ ] Performance optimization
- [ ] Comprehensive documentation

---

## Technical Implementation Notes

### Database Considerations
- Use transactions for bracket generation
- Index on commonly queried fields
- Consider caching for bracket structures

### API Design
- RESTful endpoints for CRUD
- Batch endpoints for bulk operations
- WebSocket for real-time updates

### Frontend Priorities
- Mobile-first for scorekeeper views
- Desktop-optimized for admin/director
- Large touch targets for tournament use
- Offline capability for unreliable venues

---

## Success Metrics

**Replace Excel When:**
- [ ] Can import legacy Excel data
- [ ] Generates same 196 division types
- [ ] PDFs match original format
- [ ] No Excel needed during tournament day
- [ ] Results export back to Excel format

**Improve Over Excel When:**
- [ ] Real-time results (no manual collection)
- [ ] Automatic bracket advancement
- [ ] Public self-registration
- [ ] Live scoreboards
- [ ] Audit trail of all changes

---

*This document serves as the master plan for tournament management system development.*
