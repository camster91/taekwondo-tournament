# Bowin device and accessibility acceptance record

**Status:** physical-device and assistive-technology execution required

Use fabricated participant data. Record model, OS/browser version, network, tester, timestamp, screenshot/video reference, and issue link for every row. A pass requires completion without clipped controls, horizontal scrolling, lost focus, inaccessible status, duplicate submission, or unrecoverable state.

| Environment | Required workflows | Result | Evidence / issue |
|---|---|---|---|
| Current Chrome on desktop | Sign-in, create tournament, registration, check-in, scoring/correction, display, export/delete | | |
| Current Edge on Windows | Same critical workflow | | |
| Current Firefox on desktop | Same critical workflow | | |
| iPhone Safari | Parent registration/management, operator check-in, offline/reconnect | | |
| Android Chrome | Parent registration/management, operator check-in, offline/reconnect | | |
| Venue TV/browser at 1080p | Multi-ring display, director mode, 60-minute refresh/cycle | | |
| NVDA + Chrome/Firefox | Sign-in, registration, scorekeeper dialogs/shortcuts, deletion confirmations | | |
| VoiceOver + Safari | Registration, management, check-in, dialogs, announcements | | |
| Keyboard only | Every operator workflow, focus order/trap/restore, no shortcut leakage | | |
| 200% zoom and high contrast | Critical workflows remain readable and operable | | |

## Acceptance

- [ ] No open severity-one or severity-two accessibility/device defect.
- [ ] All destructive actions remain clearly identified and keyboard operable.
- [ ] Live regions announce validation, offline queue, sync, and result state.
- [ ] Physical venue display remains current for 60 minutes without manual recovery.

Tester: ____________________  Date: __________

Product owner acceptance: ____________________  Date: __________
