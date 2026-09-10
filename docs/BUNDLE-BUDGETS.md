# Client Bundle Budgets

This document describes the client bundle size budgets, analysis workflow, and optimization strategy for Bowin Tournament OS.

## Overview

Bowin uses Vite with manual chunk splitting and lazy loading to ensure fast initial page loads and efficient code delivery. All heavyweight libraries (XLSX, jsPDF) are dynamically imported only when needed.

## Current Bundle Baseline (2026-09-10)

Established from a clean production build on commit `85e740e` (main).

### Initial Entry Point
- **File**: `assets/index-CYoUVJZC.js`
- **Raw**: 74.12 KB
- **Gzip**: 22.70 KB
- **Brotli**: 19.37 KB
- **Budget**: 150 KB gzip (✅ well within)

### Vendor Bundles (Lazily Loaded)
All vendor bundles are code-split and only loaded when needed:

| Vendor | Raw | Gzip | Brotli | Budget | Status |
|--------|-----|------|--------|--------|--------|
| vendor-react | 272.92 KB | 88.85 KB | 76.63 KB | 200 KB | ✅ |
| vendor-core | 472.04 KB | 139.39 KB | 117.65 KB | 150 KB | ✅ |
| vendor-xlsx | 487.84 KB | 159.14 KB | 132.10 KB | 170 KB | ✅ |
| vendor-jspdf | 331.05 KB | 108.15 KB | 90.26 KB | 130 KB | ✅ |

**Note**: vendor-xlsx and vendor-jspdf are **dynamically imported** only when users export Excel/PDF. They never block initial page load or critical user journeys.

### Page Chunks (Lazy Loaded)

All pages are lazy-loaded via React.lazy() in `App.tsx`:

| Page | Raw | Gzip | Brotli | Budget | Status |
|------|-----|------|--------|--------|--------|
| PublicRegister | 34.53 KB | 8.71 KB | 7.57 KB | 60 KB | ✅ |
| PublicScoreboard | 17.32 KB | 5.12 KB | 4.50 KB | 60 KB | ✅ |
| Scorekeeper | 50.88 KB | 13.45 KB | 11.84 KB | 70 KB | ✅ |
| Divisions | 52.48 KB | 13.33 KB | 11.80 KB | 80 KB | ✅ |
| Dashboard | 24.65 KB | 7.26 KB | 6.29 KB | 60 KB | ✅ |
| Results | 25.92 KB | 6.00 KB | 5.35 KB | 40 KB | ✅ |
| Competitors | 32.26 KB | 8.61 KB | 7.54 KB | 40 KB | ✅ |
| Schedule | 44.15 KB | 11.04 KB | 9.72 KB | 50 KB | ✅ |

## Budget Thresholds

Budgets are set based on target user experience on 3G networks:

- **Initial entry**: 150 KB gzip — Must load in <3s on 3G (slow 3G = ~50 KB/s)
- **Public pages**: 60 KB gzip — Parents/spectators on mobile, often on venue WiFi
- **Authenticated pages**: 40-80 KB gzip — Staff have better devices, but still mobile-first
- **Report/export features**: No strict budget — dynamically loaded only when used

## Analysis Workflow

### Local Development

```bash
# Build and analyze (generates dist/stats.html treemap)
npm run bundle:analyze

# Check budgets against current baseline (CI-friendly, exits 1 on violation)
npm run bundle:check

# Update baseline after intentional changes
npm run bundle:baseline
```

### Visual Analysis

After `npm run bundle:analyze`, open `dist/stats.html` in your browser to see:
- Treemap of all chunks and their dependencies
- Duplicate dependencies (if any)
- Largest modules within each chunk

### CI Integration (Advisory Only)

**IMPORTANT**: GitHub Actions is **NOT** a ship gate for Bowin due to billing/image constraints. The bundle budget check is **advisory-only** in CI.

For actual release verification:
1. Run `npm run bundle:check` locally or on the VPS
2. If budgets are exceeded, investigate with `npm run bundle:analyze`
3. Fix violations before deploying to production

CI failures on Actions should be investigated but do NOT block merge.

## Optimization Strategies

### Already Implemented

1. **Lazy loading**: All pages use `React.lazy()` — only load code for visited routes
2. **Dynamic imports**: XLSX and jsPDF are loaded on-demand via `await import()`
3. **Manual chunk splitting**: React, core vendors, and heavy libraries are separate bundles
4. **Code splitting**: Vite automatically splits large page components

### Current State

✅ All chunks are within budget (largest is vendor-xlsx at 159 KB gzip, well under 170 KB limit)  
✅ No duplicate vendor code detected  
✅ Initial entry is only 22.70 KB gzip (critical for mobile/venue displays)  
✅ Public pages (registration, scoreboard) are tiny (<10 KB gzip each)

### Future Optimization Opportunities (Not Needed Now)

If budgets are exceeded in the future:

1. **Split large page components**: If any page chunk exceeds 80 KB gzip
2. **Lazy load UI libraries**: If lucide-react icons become too large
3. **Remove unused dependencies**: Run `npm run bundle:analyze` to identify bloat
4. **Tree-shaking audit**: Ensure imports use named imports, not `import *`

## Monitoring

### Before Each Release

1. Run `npm run bundle:check` locally
2. If violations exist:
   - Run `npm run bundle:analyze` to investigate
   - Open `dist/stats.html` to find the culprit
   - Fix by splitting, lazy-loading, or removing dependencies
3. Update baseline with `npm run bundle:baseline` after fixes

### Performance Budget Philosophy

**Measured, not guessed**: Budgets are set based on actual build output + 10-20% headroom, not arbitrary numbers.

**Critical paths first**: Public registration and scoreboard have the strictest budgets — they're used by parents on mobile in venues with poor WiFi.

**VPS-first verification**: Local/VPS bundle checks are authoritative. GitHub Actions is advisory due to billing constraints.

## Technical Details

### Vite Configuration

See `vite.config.ts` for:
- Manual chunk splitting strategy
- Rollup output configuration
- Bundle visualizer plugin integration

### Analysis Script

See `scripts/analyze-bundle.mjs` for:
- Chunk discovery and size calculation (raw, gzip, brotli)
- Budget comparison logic
- Baseline persistence

## Troubleshooting

### "Missing chunk: X" warning

The analysis script couldn't find a chunk it expected to see. Possible causes:
- Chunk was renamed by Vite (hash changed)
- Page was removed
- Build failed partially

**Fix**: Check the manifest to confirm the chunk exists, or remove it from `BUDGETS` if the page was deleted.

### Budget violated after dependency update

**Workflow**:
1. Run `npm run bundle:analyze`
2. Open `dist/stats.html`
3. Find the new/bloated dependency in the treemap
4. Consider alternatives, lazy-loading, or increasing the budget with justification
5. Update baseline with `npm run bundle:baseline`

### Duplicate vendor code

If the treemap shows the same library in multiple chunks:
1. Add explicit `manualChunks()` entry in `vite.config.ts`
2. Rebuild and verify with `npm run bundle:analyze`

## References

- **Lazy loading**: `src/client/App.tsx` (all page imports)
- **Dynamic imports**: Search for `await import('xlsx')` in the codebase
- **Bundle config**: `vite.config.ts`
- **Analysis script**: `scripts/analyze-bundle.mjs`
- **Baseline**: `bundle-baseline.json` (git-tracked)

---

**Last updated**: 2026-09-10 (baseline established at commit `85e740e`)
