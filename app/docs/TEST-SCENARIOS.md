# Test Scenarios for Requirements Validation

This document provides test scenarios to validate the functional and non-functional requirements defined in REQUIREMENTS.md.

---

## 1. Competitor Management Tests

### TC-COMP-001: Import Competitors from Excel
**Requirement:** FR-COMP-002, FR-COMP-003

**Preconditions:**
- Excel file with competitor data available
- System is running

**Steps:**
1. Navigate to Competitors page
2. Click "Import from Excel"
3. Select Excel file with 100+ competitors
4. Review import preview
5. Confirm import

**Expected Results:**
- All valid competitors imported
- Invalid entries reported with specific errors
- Duplicate detection warns user
- Import completes within 10 seconds

### TC-COMP-002: Competitor CRUD Operations
**Requirement:** FR-COMP-004

**Steps:**
1. Create new competitor with all required fields
2. Verify competitor appears in list
3. Edit competitor details (change belt)
4. Verify changes persisted
5. Delete competitor
6. Verify competitor removed

**Expected Results:**
- Create returns 201 with competitor data
- Update returns 200 with updated data
- Delete returns 200 with confirmation
- All operations reflected in UI

### TC-COMP-003: Duplicate Detection
**Requirement:** FR-COMP-005

**Steps:**
1. Create competitor "John Smith" from "Tiger Dojang"
2. Attempt to create same competitor again
3. Verify duplicate warning displayed

**Expected Results:**
- System detects potential duplicate
- Warning shown with option to proceed or cancel
- If proceeding, competitor created with unique ID

---

## 2. Tournament Management Tests

### TC-TOURN-001: Tournament Lifecycle
**Requirement:** FR-TOURN-002

**Steps:**
1. Create tournament in draft status
2. Transition to "open"
3. Add registrations
4. Transition to "active"
5. Complete all matches
6. Transition to "completed"

**Expected Results:**
- Each transition succeeds with correct status
- Invalid transitions rejected with error
- Status history maintained

### TC-TOURN-002: Bulk Registration
**Requirement:** FR-TOURN-003, FR-REG-004

**Steps:**
1. Create tournament
2. Prepare list of 500 competitor IDs
3. Execute bulk registration API call
4. Verify all registrations created

**Expected Results:**
- All 500 registrations created
- Response indicates count of successful registrations
- Operation completes within 30 seconds
- No duplicates created

---

## 3. Division Categorization Tests

### TC-DIV-001: Auto-Generate Divisions
**Requirement:** FR-DIV-001 through FR-DIV-006

**Preconditions:**
- Tournament with 100+ registrations
- Mix of BB/CB, M/F, various ages and weights

**Steps:**
1. Navigate to division generation
2. Click "Preview" to see proposed divisions
3. Review division breakdown
4. Click "Generate" to create divisions

**Expected Results:**
- Divisions separated by belt level (CB/BB)
- Divisions separated by gender
- Divisions grouped by age brackets
- Sparring divisions include weight classes
- No division exceeds 8 competitors
- All competitors assigned to appropriate divisions

### TC-DIV-002: Division Splitting
**Requirement:** FR-DIV-006

**Preconditions:**
- Division with 12 competitors

**Steps:**
1. Observe auto-split during generation
2. Verify two divisions created (8 + 4 or 6 + 6)
3. Check competitor distribution

**Expected Results:**
- Division split into manageable sizes
- Each split division has meaningful competition
- Division names indicate split (DIV1, DIV2)

### TC-DIV-003: Manual Division Adjustment
**Requirement:** FR-DIV-007

**Steps:**
1. Generate divisions automatically
2. Select competitor in Division A
3. Move competitor to Division B
4. Verify assignment updated

**Expected Results:**
- Competitor removed from Division A
- Competitor added to Division B
- Manual override flag set
- Change persists after refresh

### TC-DIV-004: Data Loss Prevention
**Requirement:** FR-DATA-001, FR-DATA-002

**Preconditions:**
- Tournament with generated divisions
- Some divisions have brackets with results

**Steps:**
1. Attempt to regenerate divisions
2. Verify warning displayed
3. Cancel operation
4. Force regenerate with confirmation

**Expected Results:**
- Warning clearly states what will be lost
- Affected item count displayed
- Cancel prevents any changes
- Force creates backup before proceeding
- Backup available for recovery

---

## 4. Bracket Generation Tests

### TC-BRKT-001: Generate Double-Elimination Bracket
**Requirement:** FR-BRKT-001, FR-BRKT-002

**Preconditions:**
- Division with 8 competitors

**Steps:**
1. Navigate to division
2. Click "Generate Bracket"
3. Verify bracket structure

**Expected Results:**
- Winners bracket created with proper matches
- Losers bracket created
- Grand finals match configured
- All 8 competitors seeded

### TC-BRKT-002: School-Spread Seeding
**Requirement:** FR-BRKT-003

**Preconditions:**
- Division with 8 competitors
- 4 from School A, 4 from School B

**Steps:**
1. Generate bracket with school_spread seeding
2. Check first-round matchups

**Expected Results:**
- No first-round match has same-school opponents
- Schools distributed across bracket regions
- Seeding positions alternate schools

### TC-BRKT-003: Bye Handling
**Requirement:** FR-BRKT-006

**Preconditions:**
- Division with 6 competitors

**Steps:**
1. Generate bracket
2. Verify bye assignments

**Expected Results:**
- 2 byes assigned to round 1
- Higher seeds receive byes
- Bracket structure remains valid

### TC-BRKT-004: Skill-Based Seeding
**Requirement:** FR-BRKT-007

**Preconditions:**
- Division with rated competitors
- Various skill ratings available

**Steps:**
1. Generate bracket with skill_based seeding
2. Verify seed positions

**Expected Results:**
- Highest rated competitor is #1 seed
- Ratings inversely correlate with seed number
- Top seeds placed at bracket extremes

---

## 5. Match Management Tests

### TC-MATCH-001: Record Match Result
**Requirement:** FR-MATCH-001, FR-MATCH-002

**Steps:**
1. Select pending match
2. Enter scores (3-1 for competitor A)
3. Submit result
4. Verify match completed

**Expected Results:**
- Status changed to "completed"
- Scores recorded correctly
- Winner identified
- Timestamp captured

### TC-MATCH-002: Automatic Advancement
**Requirement:** FR-MATCH-003

**Steps:**
1. Complete Round 1 Match 1
2. Verify winner advanced to Round 2
3. Verify loser moved to losers bracket

**Expected Results:**
- Winner appears in next winners bracket match
- Loser appears in appropriate losers bracket match
- Bracket visualization updated

### TC-MATCH-003: Invalid Score Prevention
**Requirement:** FR-MATCH-006

**Steps:**
1. Attempt to submit negative score
2. Attempt to submit tie score
3. Attempt to submit without winner

**Expected Results:**
- Negative scores rejected
- Tie scores rejected (unless allowed by config)
- Submission requires clear winner
- Error messages explain issue

---

## 6. Fairness Tests

### TC-FAIR-001: Skill Rating Calculation
**Requirement:** FR-FAIR-001

**Steps:**
1. Record match with known competitors
2. Check rating changes
3. Verify ELO formula applied

**Expected Results:**
- Winner rating increases
- Loser rating decreases
- Amount depends on rating difference
- K-factor applied correctly

### TC-FAIR-002: Matchup History
**Requirement:** FR-FAIR-002, FR-FAIR-004

**Steps:**
1. Record match between A and B
2. Check head-to-head API
3. Generate new bracket including both

**Expected Results:**
- Head-to-head shows 1 match
- New bracket attempts to avoid early rematch
- If rematch unavoidable, system logs it

---

## 7. Reporting Tests

### TC-RPT-001: Export Bracket PDF
**Requirement:** FR-RPT-001

**Steps:**
1. Select division with completed bracket
2. Click "Export PDF"
3. Verify PDF content

**Expected Results:**
- PDF generated successfully
- Bracket structure visible
- Competitor names correct
- Match results shown
- File downloads properly

### TC-RPT-002: School Reports
**Requirement:** FR-RPT-004

**Steps:**
1. Complete tournament
2. Generate school reports
3. Review report for specific school

**Expected Results:**
- Report shows all school's competitors
- Division results listed
- Medal counts accurate
- PDF format readable

### TC-RPT-003: Certificate Generation
**Requirement:** FR-RPT-003

**Steps:**
1. Complete tournament
2. Generate certificates
3. Review gold/silver/bronze certificates

**Expected Results:**
- Certificates generated for top 3 per division
- Competitor name displayed
- Division name correct
- Medal type (gold/silver/bronze) indicated

---

## 8. Performance Tests

### TC-PERF-001: Large Import Performance
**Requirement:** NFR-PERF-006

**Steps:**
1. Prepare Excel file with 1000 competitors
2. Import file
3. Measure completion time

**Expected Results:**
- Import completes in < 10 seconds
- UI remains responsive
- Progress indicator shown

### TC-PERF-002: Division Generation Performance
**Requirement:** NFR-PERF-004, NFR-PERF-005

**Steps:**
1. Tournament with 100 registrations: Generate divisions
2. Tournament with 1000 registrations: Generate divisions
3. Measure completion times

**Expected Results:**
- 100 registrations: < 3 seconds
- 1000 registrations: < 30 seconds
- No timeout errors

### TC-PERF-003: Concurrent User Load
**Requirement:** NFR-PERF-007

**Steps:**
1. Simulate 50 concurrent users
2. Each user performs read operations
3. Some users perform write operations
4. Measure response times

**Expected Results:**
- Average response time < 500ms
- No request failures
- No data corruption

---

## 9. Error Handling Tests

### TC-ERR-001: Not Found Errors
**Requirement:** API-004

**Steps:**
1. Request non-existent tournament: GET /api/tournaments/invalid-id
2. Request non-existent competitor: GET /api/competitors/invalid-id
3. Request non-existent division: GET /api/divisions/invalid-id

**Expected Results:**
- All return 404 status
- Response includes appropriate error code
- recoverable: false in response

### TC-ERR-002: Validation Errors
**Requirement:** NFR-SEC-001, API-003

**Steps:**
1. POST /api/competitors with missing required fields
2. POST /api/tournaments with invalid date
3. PUT /api/divisions with negative age

**Expected Results:**
- All return 400 status
- VALIDATION_ERROR code returned
- Details array lists specific field errors
- suggestion field provides guidance

### TC-ERR-003: Conflict Errors
**Requirement:** API-004

**Steps:**
1. Register same competitor twice
2. Generate bracket for division with existing bracket
3. Delete division with in-progress matches

**Expected Results:**
- All return 409 status
- Appropriate conflict code returned
- Clear message explaining conflict
- suggestion for resolution

### TC-ERR-004: Network Error Recovery
**Requirement:** NFR-REL-003

**Steps:**
1. Start long operation
2. Simulate network interruption
3. Reconnect and retry

**Expected Results:**
- Operation can be safely retried
- No data corruption from partial operation
- Clear error message on failure

---

## 10. Security Tests

### TC-SEC-001: Input Validation
**Requirement:** NFR-SEC-001, NFR-SEC-005

**Steps:**
1. Attempt SQL injection in name field
2. Attempt XSS in school name
3. Attempt path traversal in file import

**Expected Results:**
- All malicious inputs sanitized
- No SQL errors returned
- No script execution
- Safe error responses only

### TC-SEC-002: Authentication Required
**Requirement:** NFR-SEC-002

**Steps:**
1. Attempt admin operations without auth
2. Attempt with invalid credentials
3. Attempt with valid credentials

**Expected Results:**
- Unauthorized returns 401
- Invalid credentials returns 401
- Valid credentials allows operation

---

## Test Execution Checklist

| Test ID | Status | Date | Notes |
|---------|--------|------|-------|
| TC-COMP-001 | | | |
| TC-COMP-002 | | | |
| TC-COMP-003 | | | |
| TC-TOURN-001 | | | |
| TC-TOURN-002 | | | |
| TC-DIV-001 | | | |
| TC-DIV-002 | | | |
| TC-DIV-003 | | | |
| TC-DIV-004 | | | |
| TC-BRKT-001 | | | |
| TC-BRKT-002 | | | |
| TC-BRKT-003 | | | |
| TC-BRKT-004 | | | |
| TC-MATCH-001 | | | |
| TC-MATCH-002 | | | |
| TC-MATCH-003 | | | |
| TC-FAIR-001 | | | |
| TC-FAIR-002 | | | |
| TC-RPT-001 | | | |
| TC-RPT-002 | | | |
| TC-RPT-003 | | | |
| TC-PERF-001 | | | |
| TC-PERF-002 | | | |
| TC-PERF-003 | | | |
| TC-ERR-001 | | | |
| TC-ERR-002 | | | |
| TC-ERR-003 | | | |
| TC-ERR-004 | | | |
| TC-SEC-001 | | | |
| TC-SEC-002 | | | |
