# Taekwondo Tournament App - Requirements Document

This document outlines the features, improvements, and enhancements needed for the Tournament Management Application.

---

## Table of Contents

1. [High Priority](#high-priority)
   - [Testing Framework](#1-testing-framework)
   - [Authentication & Authorization](#2-authentication--authorization)
   - [PDF Export](#3-pdf-export)
   - [Match Advancement Logic](#4-match-advancement-logic)
2. [Medium Priority](#medium-priority)
   - [API Documentation](#5-api-documentation)
   - [Error Handling & Validation](#6-error-handling--validation)
   - [Audit Logging](#7-audit-logging)
   - [Results Export](#8-results-export)
3. [Nice-to-Have](#nice-to-have)
   - [Real-time Updates](#9-real-time-updates)
   - [Notifications System](#10-notifications-system)
   - [Results Display / Scoreboard](#11-results-display--scoreboard)
   - [Mobile UI Optimization](#12-mobile-ui-optimization)

---

## High Priority

### 1. Testing Framework

**Status:** Not Implemented

**Description:**
The application currently has no automated tests. A comprehensive testing strategy is needed to ensure reliability and enable confident refactoring.

**Requirements:**

- [ ] Set up testing framework (Vitest recommended for Vite projects)
- [ ] Configure test environment with database mocking/seeding
- [ ] Add test scripts to package.json

**Unit Tests Required:**
- [ ] Categorization engine logic
  - Belt level separation (BB/CB)
  - Gender separation
  - Age group assignment
  - Weight class assignment
  - Division splitting (>8 competitors)
  - Small group combining (<3 competitors)
- [ ] Bracket generator logic
  - Correct bracket structure for 2, 4, 8 competitors
  - BYE handling for odd numbers
  - School-spread seeding algorithm
  - Double-elimination progression
- [ ] Schedule generator logic
  - Time slot calculation
  - Ring assignment
  - Conflict detection
- [ ] Excel import service
  - Column mapping
  - Data normalization (belt names, gender)
  - Duplicate detection
  - Validation errors

**Integration Tests Required:**
- [ ] API endpoint tests for all routes
  - Competitors CRUD
  - Tournaments CRUD
  - Registrations
  - Divisions auto-generation
  - Bracket generation
- [ ] Database operations
  - Cascade deletes
  - Relationship integrity

**End-to-End Tests (Optional):**
- [ ] Full tournament workflow
  - Create tournament → Import competitors → Register → Generate divisions → Generate brackets → Record results

**Acceptance Criteria:**
- Minimum 80% code coverage on business logic
- All API endpoints have at least one happy path and one error case test
- Tests run in CI pipeline before merge

---

### 2. Authentication & Authorization

**Status:** Not Implemented

**Description:**
Currently, the application has no access control. Anyone can view, create, modify, or delete any data. A proper authentication system is needed for production use.

**Requirements:**

**Authentication:**
- [ ] User registration with email/password
- [ ] User login with session or JWT tokens
- [ ] Password hashing (bcrypt)
- [ ] Password reset functionality
- [ ] Session management (logout, expiry)

**Authorization Roles:**
- [ ] **Admin**: Full access to all features
  - Manage users
  - Configure system settings
  - Access all tournaments
- [ ] **Tournament Director**: Manage assigned tournaments
  - Create/edit tournaments
  - Manage registrations
  - Generate brackets
  - Record results
- [ ] **Scorekeeper**: Limited access during events
  - View brackets
  - Record match results only
- [ ] **Viewer** (Public): Read-only access
  - View published brackets
  - View results

**Database Changes:**
- [ ] Add User model (id, email, passwordHash, role, createdAt)
- [ ] Add UserTournament relation for tournament-specific access
- [ ] Add createdBy/updatedBy fields to relevant models

**API Changes:**
- [ ] Add /api/auth routes (register, login, logout, me, reset-password)
- [ ] Add authentication middleware
- [ ] Add authorization middleware (role-based)
- [ ] Protect all existing routes

**Frontend Changes:**
- [ ] Login page
- [ ] Registration page
- [ ] Protected route wrapper
- [ ] User menu with logout
- [ ] Role-based UI visibility

**Acceptance Criteria:**
- Users cannot access protected routes without authentication
- Users can only perform actions allowed by their role
- Passwords are never stored in plain text
- Sessions expire after configurable period of inactivity

---

### 3. PDF Export

**Status:** Partially Implemented (jsPDF imported but not fully integrated)

**Description:**
The bracket editor has PDF export UI elements, but the actual PDF generation is incomplete. Users need to export brackets in the same format as the existing tournament PDFs.

**Requirements:**

**Single Bracket Export:**
- [ ] Export individual division bracket to PDF
- [ ] Match existing PDF format from repository samples
- [ ] Include:
  - Division name (age, belt, gender, weight class)
  - Tournament name and date
  - Competitor names with school
  - Bracket structure (8-person double elimination)
  - Match numbers
  - Score entry boxes (blank for printing)

**Batch Export:**
- [ ] Export all brackets for a tournament
- [ ] Option: Single PDF with all brackets
- [ ] Option: ZIP file with individual PDFs
- [ ] Organize by category (BB/CB, Patterns/Sparring)

**Results PDF:**
- [ ] Export completed bracket with results
- [ ] Show final placements (1st, 2nd, 3rd)
- [ ] Include match scores

**Technical Implementation:**
- [ ] Use jsPDF with proper page sizing (Letter/A4)
- [ ] Implement bracket drawing with proper spacing
- [ ] Handle long competitor names (truncation/wrapping)
- [ ] Add tournament logo placeholder

**Acceptance Criteria:**
- Exported PDFs match the format of existing tournament brackets
- PDFs are print-ready at standard paper sizes
- Batch export completes within reasonable time (<30 seconds for 50 brackets)

---

### 4. Match Advancement Logic

**Status:** Simplified implementation exists

**Description:**
The current bracket system stores match structure but doesn't fully automate winner advancement through the double-elimination bracket. When a match result is recorded, the winner should automatically advance to the next appropriate match.

**Requirements:**

**Winners Bracket Advancement:**
- [ ] When match result is recorded, identify winner
- [ ] Automatically place winner in next winners bracket match
- [ ] Handle BYE advancement (auto-advance to next round)

**Losers Bracket Advancement:**
- [ ] Move loser to appropriate losers bracket match
- [ ] Maintain correct losers bracket progression
- [ ] Handle losers bracket BYEs

**Finals Logic:**
- [ ] Winners bracket champion enters finals
- [ ] Losers bracket champion enters finals
- [ ] If losers bracket winner wins finals, trigger reset match
- [ ] Determine final placements (1st, 2nd, 3rd, 3rd)

**Edge Cases:**
- [ ] Handle disqualifications (DQ)
- [ ] Handle no-shows / forfeits
- [ ] Handle injuries (medical forfeit)
- [ ] Allow manual override of advancement

**UI Updates:**
- [ ] Show advancement path visually
- [ ] Highlight next pending matches
- [ ] Display bracket completion percentage
- [ ] Show final standings when bracket complete

**Acceptance Criteria:**
- Recording a match result automatically updates the next match
- Double-elimination rules are correctly followed
- Finals reset scenario works correctly
- All edge cases (DQ, forfeit, injury) are handled

---

## Medium Priority

### 5. API Documentation

**Status:** Not Implemented

**Description:**
The API has no formal documentation. Developers and potential integrators need clear documentation of all endpoints, request/response formats, and error codes.

**Requirements:**

**OpenAPI/Swagger Specification:**
- [ ] Document all API endpoints
- [ ] Define request body schemas
- [ ] Define response schemas
- [ ] Document error responses
- [ ] Add example requests/responses

**Endpoints to Document:**
- [ ] /api/competitors (GET, POST, PUT, DELETE, /import, /meta/*)
- [ ] /api/tournaments (GET, POST, PUT, DELETE, /registrations, /schedule)
- [ ] /api/divisions (GET, POST, PUT, DELETE, /assign, /split, /auto-generate)
- [ ] /api/brackets (GET, POST, PUT, /generate, /reset)

**Interactive Documentation:**
- [ ] Integrate Swagger UI at /api/docs
- [ ] Allow testing endpoints from documentation
- [ ] Support authentication in Swagger UI

**Additional Documentation:**
- [ ] Error code reference
- [ ] Rate limiting information (if implemented)
- [ ] Webhook documentation (if implemented)

**Acceptance Criteria:**
- All endpoints are documented with schemas
- Swagger UI is accessible at /api/docs
- Documentation stays in sync with implementation

---

### 6. Error Handling & Validation

**Status:** Basic implementation exists

**Description:**
The application has basic error handling but needs more comprehensive validation and user-friendly error messages.

**Requirements:**

**Input Validation:**
- [ ] Validate all API request bodies with Zod schemas
- [ ] Validate query parameters
- [ ] Validate path parameters (IDs exist)
- [ ] Return structured validation errors

**Validation Rules:**
- [ ] Competitor
  - Name: required, min 2 characters
  - Gender: required, enum (M/F)
  - Belt: required, must match known belts
  - DOB: required, valid date, not in future
  - Weight/Height: positive numbers if provided
- [ ] Tournament
  - Name: required, min 3 characters
  - Date: required, valid date
  - Location: optional, max 200 characters
- [ ] Registration
  - Competitor must exist
  - Tournament must exist
  - At least one event (patterns/sparring) selected
  - No duplicate registrations

**Error Response Format:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

**Error Categories:**
- [ ] 400 - Validation errors
- [ ] 401 - Authentication required
- [ ] 403 - Authorization denied
- [ ] 404 - Resource not found
- [ ] 409 - Conflict (duplicate, constraint violation)
- [ ] 500 - Internal server error (with sanitized message)

**Frontend Error Handling:**
- [ ] Display validation errors inline on forms
- [ ] Show toast notifications for API errors
- [ ] Graceful handling of network errors
- [ ] Retry logic for transient failures

**Acceptance Criteria:**
- All API inputs are validated before processing
- Error responses follow consistent format
- Frontend displays errors in user-friendly manner
- No stack traces or sensitive info in production errors

---

### 7. Audit Logging

**Status:** Not Implemented

**Description:**
There is no tracking of who made changes and when. For tournament integrity, an audit trail is essential.

**Requirements:**

**Events to Log:**
- [ ] Competitor changes (create, update, delete)
- [ ] Tournament changes (create, update, delete)
- [ ] Registration changes (add, remove, modify)
- [ ] Division changes (create, delete, reassign competitors)
- [ ] Bracket changes (generate, reset, modify seeds)
- [ ] Match results (score entry, modifications)
- [ ] User actions (login, logout, failed attempts)

**Log Entry Format:**
```json
{
  "id": "uuid",
  "timestamp": "2025-01-23T10:30:00Z",
  "userId": "user-uuid",
  "action": "UPDATE",
  "resource": "match",
  "resourceId": "match-uuid",
  "changes": {
    "before": { "score1": null, "score2": null },
    "after": { "score1": 3, "score2": 1 }
  },
  "ipAddress": "192.168.1.1",
  "userAgent": "Mozilla/5.0..."
}
```

**Database Changes:**
- [ ] Add AuditLog model
- [ ] Index by timestamp, userId, resource

**API Endpoints:**
- [ ] GET /api/audit-logs (admin only)
- [ ] Filter by date range, user, resource type
- [ ] Pagination support

**UI:**
- [ ] Audit log viewer page (admin)
- [ ] Filter and search functionality
- [ ] Export audit logs to CSV

**Acceptance Criteria:**
- All data modifications are logged
- Logs include before/after values
- Logs are tamper-proof (append-only)
- Admins can search and filter logs

---

### 8. Results Export

**Status:** Not Implemented

**Description:**
After a tournament, directors need to export final results for record-keeping and distribution.

**Requirements:**

**Export Formats:**
- [ ] PDF - Formatted results document
- [ ] Excel - Spreadsheet with all results
- [ ] CSV - Simple data export

**Results Data:**
- [ ] Division placements (1st, 2nd, 3rd, 3rd)
- [ ] Competitor names and schools
- [ ] Match scores
- [ ] Medal count by school

**PDF Results Report:**
- [ ] Tournament header (name, date, location)
- [ ] Results by division
- [ ] Medal summary table
- [ ] School standings

**Excel Export:**
- [ ] Sheet 1: Individual results (competitor, division, place, points)
- [ ] Sheet 2: Division summary
- [ ] Sheet 3: School medal counts
- [ ] Sheet 4: Raw match data

**Statistics:**
- [ ] Total competitors
- [ ] Competitors per school
- [ ] Division breakdown
- [ ] Match statistics

**Acceptance Criteria:**
- Results can be exported in all three formats
- PDF is print-ready for distribution
- Excel contains all data for further analysis
- Export includes all completed divisions

---

## Nice-to-Have

### 9. Real-time Updates

**Status:** Not Implemented

**Description:**
Currently, users must refresh the page to see updates. Real-time updates would improve the user experience during live tournaments.

**Requirements:**

**WebSocket Integration:**
- [ ] Set up WebSocket server (Socket.io or ws)
- [ ] Client-side WebSocket connection
- [ ] Automatic reconnection on disconnect
- [ ] Fallback to polling if WebSockets unavailable

**Real-time Events:**
- [ ] Match result updates
- [ ] Bracket progression
- [ ] Schedule changes
- [ ] Division modifications
- [ ] New registrations

**Room-based Subscriptions:**
- [ ] Subscribe to specific tournament
- [ ] Subscribe to specific division
- [ ] Unsubscribe on navigation

**UI Updates:**
- [ ] Live bracket updates without refresh
- [ ] Notification badges for changes
- [ ] "Live" indicator when connected
- [ ] Visual highlight on updated elements

**Acceptance Criteria:**
- Changes made by one user appear for others within 2 seconds
- Connection status is visible to user
- No data loss on reconnection
- Works on mobile devices

---

### 10. Notifications System

**Status:** Not Implemented

**Description:**
Competitors and coaches need to be notified about their matches, schedule changes, and results.

**Requirements:**

**Notification Channels:**
- [ ] Email notifications
- [ ] SMS notifications (optional, requires provider)
- [ ] In-app notifications
- [ ] Push notifications (PWA)

**Notification Events:**
- [ ] Registration confirmation
- [ ] Division assignment
- [ ] Upcoming match reminder (configurable time before)
- [ ] Match result
- [ ] Schedule change
- [ ] Tournament announcements

**Email Integration:**
- [ ] Email service provider integration (SendGrid, AWS SES, etc.)
- [ ] HTML email templates
- [ ] Unsubscribe functionality
- [ ] Bounce handling

**Notification Preferences:**
- [ ] Per-user notification settings
- [ ] Channel preferences (email, SMS, push)
- [ ] Event type preferences
- [ ] Quiet hours

**Database Changes:**
- [ ] Add Notification model
- [ ] Add NotificationPreference model
- [ ] Add email/phone to Competitor model

**Acceptance Criteria:**
- Users can configure notification preferences
- Emails are delivered within 1 minute of event
- Unsubscribe links work correctly
- No duplicate notifications

---

### 11. Results Display / Scoreboard

**Status:** Not Implemented

**Description:**
Tournaments need a public-facing display for showing live brackets, current matches, and results to spectators.

**Requirements:**

**Public Display Mode:**
- [ ] Full-screen scoreboard view
- [ ] No navigation/controls visible
- [ ] Auto-cycling through active divisions
- [ ] Large, readable fonts

**Display Content:**
- [ ] Current match (competitors, ring, time)
- [ ] Up next queue
- [ ] Recent results
- [ ] Live bracket view
- [ ] Medal standings

**Configuration:**
- [ ] Select divisions to display
- [ ] Cycle timing between views
- [ ] Color scheme / branding
- [ ] Show/hide specific elements

**Technical:**
- [ ] Dedicated /display route
- [ ] Real-time updates (WebSocket)
- [ ] Works on TV/projector resolution
- [ ] Keyboard controls for manual override

**Multi-Display Support:**
- [ ] Different content per display
- [ ] Ring-specific displays
- [ ] Central results display
- [ ] QR code for mobile bracket access

**Acceptance Criteria:**
- Display is readable from 20+ feet away
- Updates automatically without interaction
- Runs continuously without issues
- Supports common display resolutions

---

### 12. Mobile UI Optimization

**Status:** Not Verified

**Description:**
The application uses Tailwind CSS but has not been explicitly tested and optimized for mobile devices. Tournament staff often use tablets and phones.

**Requirements:**

**Responsive Design Audit:**
- [ ] Test all pages on mobile viewport sizes
- [ ] Identify and fix layout issues
- [ ] Ensure touch targets are adequate (44x44px minimum)
- [ ] Test on actual devices (iOS Safari, Android Chrome)

**Mobile-Specific Improvements:**
- [ ] Collapsible navigation menu
- [ ] Swipe gestures for bracket navigation
- [ ] Touch-friendly score entry
- [ ] Optimized table views (horizontal scroll or card layout)

**Pages to Optimize:**
- [ ] Dashboard
- [ ] Competitor list (search, filters)
- [ ] Tournament detail
- [ ] Division list
- [ ] Bracket editor (most complex)
- [ ] Schedule view

**Performance:**
- [ ] Lazy loading for images
- [ ] Efficient re-renders
- [ ] Reduced bundle size for mobile
- [ ] Offline capability (PWA)

**PWA Features:**
- [ ] Service worker for offline access
- [ ] App manifest for home screen install
- [ ] Offline bracket viewing
- [ ] Background sync for score updates

**Acceptance Criteria:**
- All features usable on 375px width screen
- No horizontal scrolling on main content
- Touch interactions work smoothly
- Page load under 3 seconds on 3G

---

## Implementation Priority

### Phase 1: Foundation (High Priority)
1. Testing Framework - Ensures stability for future development
2. Authentication - Required for production use
3. Match Advancement - Core functionality completion
4. PDF Export - High user demand

### Phase 2: Quality (Medium Priority)
5. Error Handling - Better user experience
6. API Documentation - Developer enablement
7. Audit Logging - Data integrity
8. Results Export - Post-tournament workflow

### Phase 3: Enhancement (Nice-to-Have)
9. Real-time Updates - Live tournament experience
10. Mobile Optimization - Accessibility
11. Notifications - Communication
12. Scoreboard Display - Spectator experience

---

## Technical Debt Notes

- Bracket progression logic in `brackets.ts` is marked as "simplified version"
- No database migrations versioning (using Prisma push)
- TypeScript strict mode disabled for server build
- Some type conflicts between Express and Fetch API resolved with workarounds

---

## Contributing

When implementing any requirement:

1. Create a feature branch from main
2. Implement with tests (if testing framework exists)
3. Update this document to mark items complete
4. Submit PR with description referencing this document

---

*Last Updated: January 2025*
