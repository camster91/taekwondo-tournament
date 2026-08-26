# Bowin Brand Kit

## Brand idea

**Tournament Control Room**

Bowin gives tournament directors one operational view from registration through final results. The brand should feel composed under pressure: precise enough for officials, clear enough for volunteers, and energetic enough for competition day.

## Positioning

- **Category:** Tournament operations software
- **Primary audience:** Tournament directors and organizing teams
- **Secondary audience:** Check-in staff, ring operators, scorekeepers, coaches, competitors, and families
- **Brand promise:** Keep the event moving with one connected operating system
- **Tone:** Direct, calm, capable, and specific
- **Avoid:** Martial-arts cliches, aggressive language, generic technology claims, invented customer proof, or unsupported performance claims

## Core message

**Run the floor, not the spreadsheet.**

Supporting copy should describe observable product capabilities rather than promises the product cannot prove. Prefer “Manage registration, divisions, brackets, scoring, and results in one workflow” over “The world’s best tournament platform.”

## Logo

Use the existing Bowin mark and wordmark without redrawing, stretching, rotating, outlining, or adding effects. Preserve clear space equal to the height of the mark’s inner counter on every side. Use the light lockup on Ink backgrounds and the Ink lockup on Ivory backgrounds.

Do not create event-specific logo variants. Campaign expression comes from ring geometry, bracket paths, score ticks, color, and layout.

## Color system

| Token | Hex | RGB | Role |
| --- | --- | --- | --- |
| Ink 950 | `#0B1220` | 11, 18, 32 | Primary brand field, headings, navigation |
| Ivory 050 | `#F8F5EC` | 248, 245, 236 | Primary light field, editorial warmth |
| Competition Red 600 | `#E11D48` | 225, 29, 72 | Primary action, live-state emphasis |
| Signal Gold 500 | `#F6B93B` | 246, 185, 59 | Attention, bracket paths, highlights |
| Scoreboard Blue 400 | `#52B6EC` | 82, 182, 236 | Information, secondary data signal |
| Operations Green 700 | `#21845C` | 33, 132, 92 | Confirmed, ready, completed |
| Slate 600 | `#556070` | 85, 96, 112 | Supporting copy |
| Line 200 | `#D9D5C9` | 217, 213, 201 | Dividers and quiet borders |

### Color rules

- Ink and Ivory are the dominant pair.
- Red is reserved for primary conversion actions and live competition moments.
- Gold identifies attention and pathways, not warnings.
- Green is used only for confirmed states.
- Never communicate state through color alone.
- Body copy should meet WCAG AA contrast. Use Ink or Slate on Ivory, and Ivory on Ink.

## Typography

The production site uses local-first fonts so rendering does not depend on third-party font hosts.

- **Display:** `Century Gothic`, `Avenir Next`, sans-serif
- **Body and UI:** `Avenir Next`, `Segoe UI`, sans-serif
- **Data and timing:** `Consolas`, `SFMono-Regular`, monospace

### Type behavior

- Display headings are compact, declarative, and sentence case.
- Use tabular numerals for scores, times, counts, and ring numbers.
- Keep body measures between 55 and 72 characters when possible.
- Avoid all-caps paragraphs. Small labels may use uppercase with increased tracking.

## Graphic language

- **Ring geometry:** Cropped octagons and concentric boundaries establish the competition space.
- **Bracket paths:** Thin orthogonal lines show progression and connected workflow.
- **Score ticks:** Repeated short marks add cadence without decorative noise.
- **Control grid:** A restrained technical grid anchors operational content.
- **Signal blocks:** Small red, gold, blue, and ivory blocks identify key moments.

Use one dominant motif per composition. Do not layer every motif into every surface.

## Photography and generated imagery

- Product UI is the primary proof and should appear before lifestyle imagery.
- Generated campaign images must remain abstract and cannot imply real venues, competitors, customers, or outcomes.
- Do not use generic kicking silhouettes, belt close-ups, smoke, flames, or combat-game aesthetics.
- Product captures must use synthetic fixtures and display the label `SAMPLE DATA - NOT A LIVE EVENT`.
- Never place private client, minor, support, billing, or production-account information in marketing captures.

## UI screenshot treatment

- Capture at `1440 x 960` with a clean browserless frame.
- Use a 16:10 crop when placing screenshots on the marketing site.
- Preserve readable UI. Do not blur synthetic fixtures to imitate a real client.
- Add a visible sample-data badge in the top-right corner.
- Use Ink frames, a 1px Ivory/20% border, and a restrained shadow.
- Pair one wide operational screen with one focused detail screen.

## Voice

### Use

- “Registration is open.”
- “Three divisions need brackets.”
- “Review before applying.”
- “Move from check-in to results in one connected workflow.”

### Avoid

- “Revolutionary AI-powered domination.”
- “Zero mistakes, guaranteed.”
- “Trusted by thousands” without verified evidence.
- “Set it and forget it.”

## Motion

- Use one staged page reveal and one purposeful operational motion per section.
- Bracket lines may draw from left to right.
- Status blocks may step in at 80-120ms intervals.
- Respect `prefers-reduced-motion` and remove non-essential transforms.
- Do not animate scores, alerts, or status changes in a way that delays comprehension.

## Asset manifest

- `public/brand-kit/bowin-control-room-hero.png`: generated abstract campaign hero
- `public/brand-kit/bowin-control-grid.svg`: reusable vector motif
- `public/brand-kit/bowin-social-launch.svg`: editable social launch template
- `public/brand-kit/sample-organizer-dashboard.png`: synthetic organizer overview
- `public/brand-kit/sample-tournament-operations.png`: synthetic tournament operations view
- `public/brand-kit/sample-divisions-brackets.png`: synthetic division and bracket view
- `public/brand-kit/sample-public-registration.png`: synthetic public registration view
- `public/brand-kit/sample-support-ai.png`: synthetic support assistant view

## Source and review

- Marketing design: https://www.figma.com/design/yoY9pya5h97sUWe0S5Arsz
- Screenshot generator: `tests/e2e/brand-screenshots.spec.ts`
- The fixtures are demonstrative product data, not customer evidence.

