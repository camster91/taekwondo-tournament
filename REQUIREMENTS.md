# Taekwondo Tournament App - Requirements Document

This document outlines the features, improvements, and enhancements needed for the Tournament Management Application to fully replace the Excel-based workflow.

**See also:** [TOURNAMENT_PLAN.md](./TOURNAMENT_PLAN.md) for comprehensive feature specifications.

---

## Implementation Status

### Completed Features ✅

| Feature | Status | Notes |
|---------|--------|-------|
| Testing Framework | ✅ Done | Vitest with 69 unit tests |
| Authentication Backend | ✅ Done | JWT auth, roles, middleware |
| PDF Export | ✅ Done | Single, batch, results PDFs |
| Match Advancement | ✅ Done | Full double-elimination logic |
| Public Registration | ✅ Done | Self-service at /register |

---

## Table of Contents

1. [Immediate Priority - Tournament Operations](#immediate-priority---tournament-operations)
2. [High Priority - User Experience](#high-priority---user-experience)
3. [Medium Priority - Quality & Polish](#medium-priority---quality--polish)
4. [Nice-to-Have - Advanced Features](#nice-to-have---advanced-features)

---

## Immediate Priority - Tournament Operations

These features are required to run a complete tournament without Excel.

### 1. Scorekeeper Interface ✅

**Status:** Implemented

**Description:**
A dedicated interface for scorekeepers to record match results quickly during live tournaments.

**Requirements:**

**Division-Based View:**
- [x] Select division to see only that division's matches
- [x] Show current match prominently
- [x] Show match queue with navigation
- [x] Large touch-friendly buttons (tablet-optimized)
- [x] Ready match counter per division

**Match Entry:**
- [x] Display both competitor names and schools
- [x] Score entry fields (numeric)
- [x] Winner selection (tap card to select)
- [x] Quick actions: WIN, DQ, FORFEIT, INJURY
- [x] Notes field for special circumstances
- [x] Confirmation modal before submission
- [x] Auto-advance to next match after confirmation

**Flow:**
```
Select Division → Current Match → Enter Scores → Select Winner → Confirm → Auto-advance to Next
```

**UI Requirements:**
- [x] Works on 10" tablet (dark theme, large buttons)
- [x] Large touch targets
- [x] High contrast dark theme for visibility
- [ ] Works offline (queues submissions)

---

### 2. Tournament Check-In System ✅

**Status:** Implemented

**Description:**
Before tournament starts, competitors must check in. This confirms attendance and allows weight verification for sparring.

**Requirements:**

**Check-In Process:**
- [x] List all registered competitors
- [x] Search by name or school
- [x] Mark as "Checked In" with one tap
- [x] Optional: Record official weight
- [x] Undo check-in capability
- [ ] Flag no-shows after deadline

**Weight Verification:**
- [x] Compare check-in weight to registration weight
- [x] Auto-flag if weight differs by >2 lbs (warning displayed)
- [ ] Option to move to different weight class
- [ ] Option to DQ if over limit

**Reports:**
- [x] Checked-in count vs registered (stats bar)
- [x] Missing competitors list (filter by unchecked)
- [x] Weight discrepancy display

---

### 3. Schedule Management UI ✅

**Status:** Implemented

**Description:**
Visual interface for managing tournament schedule and ring assignments.

**Requirements:**

**Schedule View:**
- [x] Timeline view showing all rings (table view)
- [x] Divisions as blocks on timeline (ring cards)
- [x] Color-coded by event type (patterns/sparring)
- [ ] Current time indicator

**Schedule Editing:**
- [ ] Drag divisions to different times
- [ ] Drag divisions between rings
- [x] Adjust start/end times (via config)
- [x] Add breaks (configurable break duration)
- [x] Handle conflicts (overlap warning in generated schedule)

**Auto-Schedule:**
- [x] One-click schedule generation
- [x] Configurable: start time, end time, breaks
- [x] Patterns before sparring (automatic)
- [x] Balance rings evenly

**Export:**
- [x] Print-friendly schedule PDF
- [x] Per-ring schedule sheets (in PDF)
- [x] Master schedule display (timeline table)

---

### 4. Tournament Dashboard

**Status:** Basic Implementation Exists

**Description:**
Real-time overview of tournament progress for directors.

**Enhancements Needed:**

**Progress Tracking:**
- [ ] Divisions completed vs total
- [ ] Matches completed vs total
- [ ] Estimated time remaining
- [ ] Current ring status (active/idle)

**Alerts:**
- [ ] Divisions running behind schedule
- [ ] Rings with long gaps
- [ ] Competitors missing from division

**Quick Actions:**
- [ ] Jump to any division bracket
- [ ] View/print any bracket PDF
- [ ] Send announcements

---

### 5. Login/Auth Frontend ✅

**Status:** Implemented

**Description:**
Complete the authentication flow with frontend pages.

**Requirements:**

**Pages Needed:**
- [x] Login page (`/login`)
- [x] User Management page (`/admin/users` - admin creates/manages accounts)
- [ ] Password change page (backend exists)
- [ ] User profile page

**Protected Routes:**
- [x] Store token in localStorage
- [x] AuthContext for state management
- [ ] Redirect unauthenticated users to login (ready, disabled for now)
- [ ] Auto-logout on token expiry
- [ ] "Remember me" option

**Role-Based UI:**
- [x] Admin: Full sidebar, user management link
- [ ] Director: Tournament management only
- [ ] Scorekeeper: Ring view only
- [ ] Viewer: Read-only brackets

---

## High Priority - User Experience

### 6. Improved Division Management ✅

**Status:** Implemented

**Description:**
Better tools for managing auto-generated divisions.

**Enhancements:**

**Division Review:**
- [x] Preview divisions before creating (modal with full breakdown)
- [x] See competitor counts per division
- [x] Warnings for small (<3) or large (>8) divisions
- [x] Color-coded badges for division sizes
- [x] Stats summary (total, with brackets, small, large)

**Manual Adjustments:**
- [ ] Move competitor between divisions (drag-drop)
- [ ] Merge two divisions
- [x] Split one division (for large divisions)
- [ ] Create custom division
- [ ] Lock division (prevent auto-changes)

**Bulk Actions:**
- [x] Re-run auto-categorization
- [x] Clear all divisions
- [x] Generate all brackets at once

---

### 7. Enhanced Bracket Editor

**Status:** Basic Implementation Exists

**Description:**
Improve the visual bracket editor for better usability.

**Enhancements:**

**Visual Improvements:**
- [ ] Clearer winner/loser bracket separation
- [ ] Match status indicators (pending, ready, complete)
- [ ] Competitor photos (optional)
- [ ] School logos/colors (optional)

**Interactions:**
- [ ] Click match to enter results
- [ ] Hover to see competitor details
- [ ] Zoom in/out for large brackets
- [ ] Print-friendly view

**Match Details Panel:**
- [ ] Score history (if changed)
- [ ] Match notes
- [ ] Time played
- [ ] Audit trail (who entered result)

---

### 8. Results & Statistics ✅

**Status:** Implemented

**Description:**
Comprehensive results display and statistics.

**Requirements:**

**Results Display:**
- [x] Results by division (1st, 2nd, 3rd)
- [x] Results by competitor
- [x] Results by school

**Medal Standings:**
- [x] School rankings (gold/silver/bronze counts)
- [x] Total medals table
- [ ] Points system (optional: 3/2/1)

**Statistics:**
- [x] Total completed divisions count
- [x] Total matches count
- [x] Schools competing count
- [x] Total medals count
- [ ] Breakdown by belt level
- [ ] Breakdown by age group

**Exports:**
- [x] Results PDF (print-ready)
- [ ] Excel with all data
- [ ] CSV for data analysis
- [ ] School-specific reports

---

## Medium Priority - Quality & Polish

### 9. API Documentation

**Status:** Not Implemented

**Requirements:**
- [ ] OpenAPI/Swagger specification
- [ ] Interactive docs at /api/docs
- [ ] Request/response examples
- [ ] Error code reference

---

### 10. Input Validation (Zod)

**Status:** Basic Validation Exists

**Requirements:**
- [ ] Zod schemas for all API endpoints
- [ ] Consistent error response format
- [ ] Frontend form validation matching backend

---

### 11. Audit Logging

**Status:** Not Implemented

**Requirements:**
- [ ] Log all data changes
- [ ] Include user, timestamp, before/after
- [ ] Admin-viewable audit log page
- [ ] Export audit log

---

### 12. Error Handling

**Status:** Basic Implementation

**Requirements:**
- [ ] User-friendly error messages
- [ ] Toast notifications
- [ ] Network error retry logic
- [ ] Offline mode graceful degradation

---

## Nice-to-Have - Advanced Features

### 13. Real-time Updates (WebSocket)

**Description:** Live updates without page refresh.

**Requirements:**
- [ ] WebSocket server (Socket.io)
- [ ] Live bracket updates
- [ ] Live scoreboard
- [ ] Connection status indicator

---

### 14. Public Scoreboard Display ✅

**Description:** Large-screen display for spectators.

**Requirements:**
- [x] Full-screen mode at /display/:tournamentId
- [x] Current matches in progress display
- [x] Auto-cycling through divisions (15-second intervals)
- [x] Recent results ticker
- [x] Division status overview
- [ ] QR code for mobile bracket access

---

### 15. Notifications

**Description:** Alert competitors and coaches.

**Requirements:**
- [ ] Email confirmation on registration
- [ ] Email reminder before tournament
- [ ] Match notification (when match is next)
- [ ] Results notification

---

### 16. Mobile Optimization

**Description:** Full mobile support.

**Requirements:**
- [ ] Responsive design audit
- [ ] Touch-friendly interactions
- [ ] PWA support (installable)
- [ ] Offline bracket viewing

---

### 17. Certificate Generation

**Description:** Auto-generate winner certificates.

**Requirements:**
- [ ] Certificate templates
- [ ] Auto-fill competitor/placement
- [ ] PDF export
- [ ] Batch generation

---

### 18. Multi-Tournament Support

**Description:** Tournament series and historical data.

**Requirements:**
- [ ] Link tournaments to series
- [ ] Historical results lookup
- [ ] Competitor ranking across tournaments
- [ ] Year-over-year statistics

---

## Implementation Phases

### Phase 1: Tournament Ready (Next)
Complete these to run a tournament:
1. Scorekeeper Interface
2. Login/Auth Frontend
3. Tournament Dashboard Enhancements
4. Schedule Management UI
5. Check-In System

### Phase 2: Professional Polish
6. Division Management Improvements
7. Enhanced Bracket Editor
8. Results & Statistics
9. Input Validation

### Phase 3: Production Quality
10. API Documentation
11. Audit Logging
12. Error Handling
13. Mobile Optimization

### Phase 4: Advanced Features
14. Real-time Updates
15. Public Scoreboard
16. Notifications
17. Certificates
18. Multi-Tournament

---

## Technical Notes

### Recently Completed
- Vitest testing framework (69 tests passing)
- JWT authentication with roles
- Match advancement service
- PDF export (jsPDF)
- Public registration portal

### Database Ready
- User and UserTournamentAccess models added
- Schema supports all planned features

### Known Issues
- TypeScript strict mode disabled for server
- Large bundle size (needs code splitting)

---

*Last Updated: January 2026*
