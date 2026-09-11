# Decision 0127: Supported browser, device, a11y, and venue-display matrix

> GitHub: camster91/taekwondo-tournament#127
> Status: Accepted (with #128 Slice 1+2 in production; Slice 3+ pending).
> Date: 2026-09-10

## Context

The product is used at venues on a variety of devices and assistive tech. Without a declared support matrix, "works on my machine" is a common failure mode.

## Decision

| Class | Supported |
|---|---|
| **Desktop browsers** | Chrome, Safari, Firefox, Edge (latest 2 versions of each) |
| **Mobile browsers** | Safari iOS (15+), Chrome Android (latest 2) |
| **Screen readers** | NVDA on Windows, VoiceOver on macOS and iOS |
| **Viewport width** | 320px – 2560px (mobile portrait through 4K venue displays) |
| **Touch targets** | ≥ 44×44 CSS pixels |
| **Color contrast** | WCAG 2.2 AA (4.5:1 normal text, 3:1 large text and UI components) |
| **A11y standard** | WCAG 2.2 AA on all key user journeys |
| **Venue displays** | 1080p and 4K, landscape orientation, full-screen bracket view |
| **Offline** | Limited (offline-operation-queue for pending score submissions) |

The product does NOT support:
- Internet Explorer (any version).
- Pre-2020 mobile browsers.
- TalkBack on Android (best-effort only — venue staff use iOS / Windows).

## Trade-offs

- Limits the addressable market slightly (IE users are essentially gone, but TalkBack on Android users are a non-zero cohort).
- Clearer product story and clearer test matrix.
- Smaller CI test matrix = faster CI.

## Rationale

Industry standard for the use case. The a11y work already done (#128 Slice 1+2) covers this. The matrix matches the Bowin pilot venue's actual devices.

## Implications

- CI runs Playwright on Chrome, Firefox, Safari, Edge (desktop) and Chrome Android + Safari iOS (mobile).
- Each PR adds to the test matrix; the matrix is a single source of truth.
- A11y tests run on NVDA (Windows CI) and VoiceOver (macOS CI).
- New features MUST declare which matrix cells they support.
- The README has a "Supported browsers and devices" section.

## Action items

- [ ] Add the matrix to `README.md` and `docs/`.
- [ ] Update CI to run on the matrix.
- [ ] Add a "device matrix" entry per new feature in the PR template.
- [ ] Cameron does the Slice 3+ manual matrix test (#128).

## Related

- #128 (a11y, including the matrix and Slice 3+)
- `tests/e2e/` Playwright config
