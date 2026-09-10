# Bowin Design Tokens

**Created:** 2026-09-10  
**Owner:** Bowin Product Team  
**Purpose:** Canonical design token layer for Bowin Tournament OS visual identity  
**Status:** Foundation complete (#150 partial delivery)

---

## Overview

This document defines the design token system for Bowin's world-class organizer SaaS. Tokens establish visual consistency, maintainability, and brand identity across the application.

**Design Philosophy:**
- **Adult gym-tool density:** Precise, fast, confident. No soft baby UI.
- **Operational trust:** Arena ink (`#0b1220`) for surfaces; belt red (`#e11d48`) for identity.
- **Professional instrument:** Clean hierarchy, readable type, purposeful motion.

---

## Token Architecture

Tokens are defined in two layers:

1. **CSS Custom Properties** (`src/client/index.css` → `@theme` block)
   - Source of truth for all design values
   - Dark mode variants handled via `.dark` class
   - Semantic naming (e.g., `--color-surface-200`, not `--gray-200`)

2. **Tailwind Theme Extension** (`tailwind.config.js`)
   - Maps CSS variables to Tailwind utilities (e.g., `bg-surface-200`)
   - Enables IntelliSense and autocomplete
   - Preserves utility-first workflow

---

## Color System

### Brand Colors

**Identity colors for logos, wordmarks, and hero moments.**

| Token | Tailwind | Value | Usage |
|-------|----------|-------|-------|
| `--color-brand-ink` | `brand-ink` | `#0b1220` | Wordmark, lockup, footer |
| `--color-brand-red` | `brand-red` | `#e11d48` | Primary brand accent, CTA backgrounds |
| `--color-brand-rose` | `brand-rose` | `#fb7185` | Lighter brand accent, hover states |
| `--color-brand-gold` | `brand-gold` | `#f59e0b` | Trophy icon, achievement highlights |

**Usage:**
```tsx
<div className="bg-brand-red text-white">Sign Up</div>
<h1 className="text-brand-ink dark:text-white">Bowin</h1>
```

---

### Primary Scale (Deep Blue-Gray)

**Neutral scale for text hierarchy, borders, disabled states.**

| Token | Tailwind | Light | Dark |
|-------|----------|-------|------|
| `--color-primary-50` | `primary-50` | `#f1f5f9` | Backgrounds |
| `--color-primary-100` | `primary-100` | `#e2e8f0` | Hover states |
| `--color-primary-200` | `primary-200` | `#cbd5e1` | Borders |
| `--color-primary-300` | `primary-300` | `#94a3b8` | Placeholders |
| `--color-primary-400` | `primary-400` | `#64748b` | Muted text |
| `--color-primary-500` | `primary-500` | `#334155` | Body text (light) |
| `--color-primary-600` | `primary-600` | `#1e293b` | Buttons, headings |
| `--color-primary-700` | `primary-700` | `#172033` | Hover states |
| `--color-primary-800` | `primary-800` | `#111827` | Dark surfaces |
| `--color-primary-900` | `primary-900` | `#0b1220` | Darkest surfaces |
| `--color-primary-950` | `primary-950` | `#080d17` | Absolute black |

**Default button:**
```tsx
<Button variant="primary" /> // bg-primary-600 hover:bg-primary-700
```

---

### Accent Scale (Rose-Red)

**Interactive elements, CTAs, active states, selection.**

| Token | Tailwind | Value | Usage |
|-------|----------|-------|-------|
| `--color-accent-50` | `accent-50` | `#fff1f2` | Badge backgrounds |
| `--color-accent-100` | `accent-100` | `#ffe4e6` | Hover backgrounds |
| `--color-accent-200` | `accent-200` | `#fecdd3` | Light borders |
| `--color-accent-300` | `accent-300` | `#fda4af` | Icon tints |
| `--color-accent-400` | `accent-400` | `#fb7185` | Active icons |
| `--color-accent-500` | `accent-500` | `#e11d48` | Primary accent |
| `--color-accent-600` | `accent-600` | `#be123c` | Pressed states |
| `--color-accent-700` | `accent-700` | `#9f1239` | Dark text |
| `--color-accent-800` | `accent-800` | `#881337` | Deeper pressed |
| `--color-accent-900` | `accent-900` | `#4c0519` | Very dark |
| `--color-accent-950` | `accent-950` | `#2a0612` | Absolute dark |

**Gradient button:**
```tsx
<Button variant="gradient" /> // Uses btn-gradient CSS class
```

---

### Surface Scale (Cool Neutral)

**Backgrounds, cards, dividers, borders.**

| Token | Tailwind | Value | Light Usage | Dark Usage |
|-------|----------|-------|-------------|------------|
| `--color-surface-0` | `surface-0` | `#ffffff` | Pure white | — |
| `--color-surface-50` | `surface-50` | `#fafbfc` | Page background | — |
| `--color-surface-100` | `surface-100` | `#f4f5f7` | Card backgrounds | Heading text |
| `--color-surface-200` | `surface-200` | `#e8eaee` | Borders | — |
| `--color-surface-300` | `surface-300` | `#d4d7de` | Dividers | Muted text |
| `--color-surface-400` | `surface-400` | `#9ca0aa` | Placeholders | Icon color |
| `--color-surface-500` | `surface-500` | `#6b7280` | Labels | — |
| `--color-surface-600` | `surface-600` | `#4b5563` | Body text | — |
| `--color-surface-700` | `surface-700` | `#374151` | Headings | Borders |
| `--color-surface-800` | `surface-800` | `#1f2937` | — | Card backgrounds |
| `--color-surface-900` | `surface-900` | `#111827` | Headings | Dark surfaces |
| `--color-surface-950` | `surface-950` | `#0a0e1a` | — | Page background |

**Usage:**
```tsx
// Light mode: white card on surface-50 page
// Dark mode: surface-900 card on surface-950 page
<Card className="bg-white dark:bg-surface-900" />
<div className="border-surface-200 dark:border-surface-700" />
```

---

### Semantic State Colors

**Success, warning, danger, info indicators.**

| Token | Tailwind | Value | Usage |
|-------|----------|-------|-------|
| `--color-success` | `success` | `#10b981` | Completed, saved, valid |
| `--color-warning` | `warning` | `#f59e0b` | Pending, in-progress, caution |
| `--color-danger` | `danger` | `#ef4444` | Error, destructive, invalid |
| `--color-info` | `info` | `#3b82f6` | Informational, neutral alerts |

**Badge usage:**
```tsx
<Badge variant="success">Saved</Badge>
<Badge variant="danger">Failed</Badge>
```

**OperationStatus:**
```tsx
<OperationStatus state="saved" message="Changes saved" />
// Uses success/10 background, success text
```

---

## Spacing & Layout

### Border Radius

**Soft, consistent radii. No sharp edges.**

| Token | Tailwind | Value | Usage |
|-------|----------|-------|-------|
| `--radius-xs` | `rounded-xs` | `4px` | Tiny pills, dot indicators |
| `--radius-sm` | `rounded-sm` | `6px` | Small badges |
| `--radius-md` | `rounded-md` | `8px` | Buttons, inputs, select |
| `--radius-lg` | `rounded-lg` | `12px` | Cards, modals, major containers |
| `--radius-xl` | `rounded-xl` | `16px` | Feature cards, large panels |
| `--radius-2xl` | `rounded-2xl` | `20px` | Hero sections |
| `--radius-3xl` | `rounded-3xl` | `28px` | Very large containers |

**Default components:**
- Button, Input, Select, Textarea: `rounded-lg` (8px)
- Card, Modal: `rounded-lg` (12px)
- Badge: `rounded-full` (pill)

---

### Shadow Scale

**Soft, multi-layer shadows. No hard edges.**

| Token | Tailwind | Usage |
|-------|----------|-------|
| `--shadow-xs` | `shadow-xs` | Subtle lift (1px) |
| `--shadow-sm` | `shadow-sm` | Cards at rest |
| `--shadow-md` | `shadow-md` | Hover cards |
| `--shadow-lg` | `shadow-lg` | Modals, dropdowns |
| `--shadow-xl` | `shadow-xl` | Command palette, popovers |
| `--shadow-glow` | `shadow-glow` | Focus ring (0 0 0 4px) |

**Usage:**
```tsx
<Card className="shadow-sm hover:shadow-lg" />
```

---

## Typography

### Font Families

| Token | Tailwind | Value |
|-------|----------|-------|
| `--font-sans` | `font-sans` | SF Pro Display, Inter, system-ui |
| `--font-mono` | `font-mono` | SF Mono, JetBrains Mono, Menlo |

**Font smoothing:**
- `-webkit-font-smoothing: antialiased`
- `-moz-osx-font-smoothing: grayscale`
- `letter-spacing: -0.011em` (body), `-0.022em` (headings)

### Type Scale

Defined in global CSS (`h1`–`h4` elements):

| Element | Size | Weight | Tracking | Usage |
|---------|------|--------|----------|-------|
| `h1` | `1.875rem` (30px) | 700 | `-0.028em` | Page titles |
| `h2` | `1.375rem` (22px) | 600 | `-0.022em` | Section headings |
| `h3` | `1.125rem` (18px) | 600 | `-0.022em` | Subsections |
| `h4` | `1rem` (16px) | 600 | `-0.022em` | Labels, card titles |

**Body text:** `font-size: 1rem` (16px), `line-height: 1.5`, `font-weight: 400`

---

## Motion & Transitions

### Duration

| Token | Tailwind | Value | Usage |
|-------|----------|-------|-------|
| `--duration-fast` | `duration-fast` | `150ms` | Button hover, badge fade |
| `--duration-base` | `duration-base` | `220ms` | Card hover, modal open |
| `--duration-slow` | `duration-slow` | `360ms` | Page transitions |

### Easing

| Token | Tailwind | Value | Usage |
|-------|----------|-------|-------|
| `--ease-out-quart` | `ease-out-quart` | `cubic-bezier(0.25, 1, 0.5, 1)` | Button press |
| `--ease-out-expo` | `ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | Modal slide-up |
| `--ease-in-out-quart` | `ease-in-out-quart` | `cubic-bezier(0.76, 0, 0.24, 1)` | Smooth bidirectional |

**Button transitions:**
```css
transition: all var(--duration-fast) var(--ease-out-quart);
```

---

## Component Patterns

### Button Variants

```tsx
// Primary action (bg-primary-600)
<Button variant="primary">Save</Button>

// Secondary (surface-100, bordered)
<Button variant="secondary">Cancel</Button>

// Ghost (transparent, hover surface-100)
<Button variant="ghost">Skip</Button>

// Danger (bg-danger)
<Button variant="danger">Delete</Button>

// Success (bg-success)
<Button variant="success">Approve</Button>

// Gradient (brand red gradient)
<Button variant="gradient">Get Started</Button>
```

### Card Elevation

```tsx
// Rest state (shadow-sm)
<Card className="shadow-sm" />

// Hover (shadow-lg, lift -2px)
<Card interactive className="shadow-sm hover:shadow-lg hover:-translate-y-0.5" />
```

### Input States

```tsx
// Default
<Input placeholder="Enter name" />

// Error (border-danger, focus:ring-danger/30)
<Input error="Required field" />

// With icon
<Input leftIcon={<Search />} placeholder="Search..." />
```

### Badge States

```tsx
<Badge variant="default">Draft</Badge>
<Badge variant="success" dot>Saved</Badge>
<Badge variant="warning">In Progress</Badge>
<Badge variant="danger">Failed</Badge>
<Badge variant="info">Pending</Badge>
```

---

## Dark Mode

**Activation:** Add `dark` class to `<html>` or any ancestor.

**Color mappings:**

| Light | Dark | Usage |
|-------|------|-------|
| `surface-50` (page bg) | `surface-950` | Page background |
| `white` (card bg) | `surface-900` | Card background |
| `surface-200` (border) | `surface-700` | Borders |
| `surface-900` (heading) | `surface-100` | Heading text |
| `surface-600` (body) | `surface-400` | Body text |
| `primary-600` (button) | `primary-600` | Buttons (same) |
| `accent-500` (CTA) | `accent-500` | CTAs (same) |

**Semantic colors are invariant:**
- `success`, `warning`, `danger`, `info` use opacity/alpha layers in dark mode
- Example: `bg-success/10 dark:bg-success/20` (10% opacity light, 20% dark)

---

## Migration Status

### ✅ Complete

- CSS token definitions (`src/client/index.css`)
- Tailwind theme extension (`tailwind.config.js`)
- UI primitives migrated:
  - `Button.tsx`
  - `Card.tsx`
  - `Input.tsx`
  - `Select.tsx`
  - `Textarea.tsx`
  - `Badge.tsx`
  - `Modal.tsx`
  - `EmptyState.tsx`
  - `OperationStatus.tsx`
  - `Spinner.tsx` (no changes, already token-aware)

### 🚧 Partial

- Page-level components (Dashboard, Tournaments, Scorekeeper, etc.)
- Legacy hardcoded colors (`slate-*`, `gray-*`, `red-*`, `blue-*`) still exist in pages
- Print styles (bracket layouts use old color names)

### ⏳ Future Work (Not #150 Scope)

**Full app migration:**
- Replace all `slate-*` → `surface-*`
- Replace all `gray-*` → `surface-*`
- Replace `red-*` → `danger`
- Replace `emerald-*`/`green-*` → `success`
- Replace `amber-*`/`yellow-*` → `warning`
- Replace `blue-*` → `info` or `primary-*`

**Pages to migrate:**
- `Dashboard.tsx`
- `Tournaments.tsx`
- `Scorekeeper.tsx`
- `DirectorDashboard.tsx`
- `CheckIn.tsx`
- `Divisions.tsx`
- `BracketEditor.tsx`
- `Results.tsx`
- `Profile.tsx`
- `OrganizationSettings.tsx`
- `UserManagement.tsx`
- `PublicRegister.tsx`
- `PublicScoreboard.tsx`

**Estimate:** 20–30 component files, ~50 color replacements per file → 2–3 days of careful migration + visual regression testing.

---

## Usage Guidelines

### DO ✅

- Use semantic tokens: `bg-surface-100`, `text-surface-900`, `border-surface-200`
- Use state colors for indicators: `bg-success/10 text-success`
- Use `duration-fast` and `ease-out-quart` for transitions
- Use `rounded-lg` for cards, buttons, inputs
- Use `shadow-sm` for card rest states

### DON'T ❌

- Use hardcoded Tailwind colors: `bg-slate-100`, `text-gray-900`, `border-red-500`
- Use arbitrary values: `bg-[#f4f5f7]`, `rounded-[13px]`
- Use multiple shadow utilities: `shadow-sm shadow-lg` (pick one)
- Use inconsistent radii: `rounded-xl` on buttons, `rounded-sm` on cards

### Exceptions

**Print styles:** Bracket PDFs use hardcoded light colors to ensure black ink on white paper. This is intentional.

**Org branding:** `OrganizationSettings` allows custom primary color upload. Override tokens via inline styles or CSS variables scoped to tenant pages.

---

## Testing

**Visual regression:**
- Check light mode + dark mode for every updated component
- Test focus states (keyboard navigation)
- Verify hover transitions (duration-fast, ease-out-quart)
- Test on 1920×1080 (desktop) and 375×667 (mobile)

**Automated:**
```bash
npm run typecheck  # Verify Tailwind class names
npm test           # Unit tests (no visual regression yet)
```

---

## References

- **CLAUDE.md**: Full codebase architecture
- **COMPONENT_CONTRACTS.md**: Shared component behavioral contracts
- **END_TO_END_SHIP_PLAN.md**: #150 status tracking
- **src/client/index.css**: CSS token definitions
- **tailwind.config.js**: Tailwind theme extension

---

## Changelog

**2026-09-10 (#150 partial delivery):**
- Established canonical token layer (brand, primary, accent, surface, semantic)
- Migrated 9 UI primitives to use tokens
- Documented full system in DESIGN_TOKENS.md
- **Next:** Full app migration (est. 2–3 days)
