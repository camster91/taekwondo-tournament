# Bowin brand guidelines

## Brand idea

Bowin is the tournament operating system that keeps the whole venue moving. The brand should feel composed under pressure: precise enough for directors, clear enough for volunteers, and energetic enough for live sport.

**Name:** Bowin  
**Descriptor:** Tournament OS  
**Tagline:** Tournaments, run like a black belt.  
**Product promise:** Registration, divisions, brackets, scorekeeping, and live displays in one operational system.

Use `Bowin` in prose and headings. The lowercase `bowin` treatment is reserved for the visual wordmark.

## Logo system

| Asset | Use |
| --- | --- |
| `/public/brand/bowin-mark.svg` | App icon, favicon, compact navigation |
| `/public/brand/bowin-wordmark-dark.svg` | Light backgrounds |
| `/public/brand/bowin-wordmark-light.svg` | Dark backgrounds |
| `BowinLogo.tsx` | Canonical in-product identity component |

The converging strokes communicate brackets, focus, and progression. The red finishing point represents the decisive match. Keep clear space equal to one quarter of the mark width. Do not rotate, stretch, recolor, outline, add effects, or separate the red point.

Minimum sizes: 20 px for the mark and 96 px wide for the wordmark. At smaller sizes use only the mark.

## Colour

| Token | Hex | RGB | CMYK approximation | Purpose |
| --- | --- | --- | --- | --- |
| Arena Ink | `#0B1220` | 11, 18, 32 | 66, 44, 0, 87 | Primary identity, navigation, headings |
| Belt Red | `#E11D48` | 225, 29, 72 | 0, 87, 68, 12 | Brand moments and active emphasis |
| Victory Rose | `#FB7185` | 251, 113, 133 | 0, 55, 47, 2 | Dark-background highlights |
| Medal Gold | `#F59E0B` | 245, 158, 11 | 0, 36, 96, 4 | Awards and celebration only |
| Dobok White | `#F8FAFC` | 248, 250, 252 | 2, 1, 0, 1 | Main canvas |

Red never communicates ordinary destructive actions by itself; destructive controls retain the semantic danger system and a text label. Ensure text and interface states meet WCAG AA contrast.

## Typography

Use the system-first sans stack defined in `index.css`: SF Pro where available, then Inter, Segoe UI, Roboto, and system sans-serif. This avoids a render-blocking font dependency at venues.

- Display: 700, tight tracking
- Headings: 600–700
- Body: 400–500
- Operational labels: 600 with restrained uppercase tracking
- Scores and codes: the product monospace stack

## Voice

Bowin is direct, calm, and operational. Prefer short verbs and concrete outcomes.

- Say: “Ready for Ring 2”, “Result saved”, “3 competitors need review”.
- Avoid hype, combat clichés beyond the approved tagline, unsupported security claims, federation approval claims, and “fully offline”.
- Use “tournament director”, “scorekeeper”, “competitor”, and “ring” consistently.

## Metadata and sharing

`index.html` owns the canonical title, description, Open Graph, and X card metadata. `/public/brand/bowin-social-card.png` is the 1200 × 630 sharing image. Update the SVG source first, then regenerate the PNG.

## Domain migration

Until a Bowin domain is purchased and configured, production remains on `tkd.ashbi.ca`. After acquisition, use the public site at the apex, the application at `app.<domain>`, and redirect legacy URLs only after authentication, email, CORS, cookies, monitoring, and public scoreboard links are verified on the new domain.
