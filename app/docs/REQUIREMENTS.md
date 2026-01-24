# Taekwondo Tournament Management System - Requirements Specification

## 1. Overview

This document defines the functional and non-functional requirements for the Taekwondo Tournament Management System. The system manages competitor registration, division categorization, bracket generation, and results tracking for Taekwondo tournaments.

---

## 2. Functional Requirements

### 2.1 Competitor Management (FR-COMP)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-COMP-001 | System shall maintain a persistent competitor registry across tournaments | High |
| FR-COMP-002 | System shall support importing competitors from Excel files (.xlsx, .xlsm) | High |
| FR-COMP-003 | System shall validate competitor data on import (name, DOB, belt, school) | High |
| FR-COMP-004 | System shall support manual CRUD operations for competitors | High |
| FR-COMP-005 | System shall detect and prevent duplicate competitor entries | Medium |
| FR-COMP-006 | System shall support search and filter on competitor list | Medium |
| FR-COMP-007 | System shall track competitor belt promotions over time | Low |
| FR-COMP-008 | System shall calculate competitor age dynamically based on DOB | High |

#### 2.1.1 Competitor Data Model

Required fields:
- First Name (string, required)
- Last Name (string, required)
- Date of Birth (date, required)
- Belt Rank (enum: White, Yellow, Green, Blue, Red, Black)
- Dan Rank (integer 1-9, required if Black belt)
- School/Dojang (string, required)
- Gender (enum: M, F)

Optional fields:
- Weight (decimal, kg or lbs)
- Height (decimal, cm or inches)
- Email
- Phone
- Special Needs flag
- Years Training (integer)

### 2.2 Tournament Management (FR-TOURN)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-TOURN-001 | System shall support creating tournaments with name, date, and location | High |
| FR-TOURN-002 | System shall manage tournament status (draft, open, active, completed) | High |
| FR-TOURN-003 | System shall support bulk registration of competitors to tournaments | High |
| FR-TOURN-004 | System shall allow specifying events per registration (patterns, sparring, both) | High |
| FR-TOURN-005 | System shall prevent modifications to completed tournaments | Medium |
| FR-TOURN-006 | System shall support tournament archiving | Low |

#### 2.2.1 Tournament Status Transitions

Valid transitions:
- `draft` → `open` (registration opens)
- `open` → `active` (competition begins)
- `active` → `completed` (all matches finished)
- Any state → `cancelled`

### 2.3 Registration Management (FR-REG)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-REG-001 | System shall register competitors for specific events | High |
| FR-REG-002 | System shall capture weight at registration time for sparring events | High |
| FR-REG-003 | System shall prevent duplicate registrations (same competitor, tournament, event) | High |
| FR-REG-004 | System shall support bulk registration via API | High |
| FR-REG-005 | System shall validate registration eligibility (age, belt requirements) | Medium |
| FR-REG-006 | System shall track registration timestamps | Medium |

### 2.4 Division Categorization (FR-DIV)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-DIV-001 | System shall automatically generate divisions based on categorization rules | High |
| FR-DIV-002 | System shall separate competitors by belt level (CB/BB) | High |
| FR-DIV-003 | System shall separate competitors by gender | High |
| FR-DIV-004 | System shall group competitors by age brackets | High |
| FR-DIV-005 | System shall group sparring competitors by weight class | High |
| FR-DIV-006 | System shall automatically split divisions exceeding 8 competitors | High |
| FR-DIV-007 | System shall support manual division adjustments | Medium |
| FR-DIV-008 | System shall merge small divisions when appropriate | Medium |
| FR-DIV-009 | System shall support special needs division handling | Low |

#### 2.4.1 Categorization Rules

**Belt Levels:**
- Colored Belt (CB): White, Yellow, Green, Blue, Red
- Black Belt (BB): 1st Dan and above

**Age Groups (Standard):**
| Age Range | Group Name |
|-----------|------------|
| 4-5 | Tiny Tigers |
| 6-7 | Youth A |
| 8-9 | Youth B |
| 10-11 | Junior A |
| 12-13 | Junior B |
| 14-15 | Cadet |
| 16-17 | Junior |
| 18-32 | Senior |
| 33-39 | Ultra |
| 40-49 | Master A |
| 50-59 | Master B |
| 60+ | Grand Master |

**Weight Classes (Sparring):**
| Class | Male (kg) | Female (kg) |
|-------|-----------|-------------|
| Fin | <54 | <46 |
| Fly | 54-58 | 46-49 |
| Bantam | 58-63 | 49-53 |
| Feather | 63-68 | 53-57 |
| Light | 68-74 | 57-62 |
| Welter | 74-80 | 62-67 |
| Middle | 80-87 | 67-73 |
| Heavy | >87 | >73 |

### 2.5 Bracket Generation (FR-BRKT)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-BRKT-001 | System shall generate double-elimination brackets for divisions | High |
| FR-BRKT-002 | System shall support up to 8 competitors per bracket | High |
| FR-BRKT-003 | System shall implement school-spread seeding to avoid same-school first-round matches | High |
| FR-BRKT-004 | System shall generate correct match structure with winner/loser brackets | High |
| FR-BRKT-005 | System shall support manual seeding adjustments | Medium |
| FR-BRKT-006 | System shall support bye assignments for non-power-of-2 divisions | High |
| FR-BRKT-007 | System shall support skill-based seeding | Medium |
| FR-BRKT-008 | System shall calculate match difficulty ratings | Low |

#### 2.5.1 Seeding Strategies

| Strategy | Description |
|----------|-------------|
| random | Random assignment |
| school_spread | Maximize school distribution to avoid same-school matches |
| skill_based | Seed by competitor skill rating |
| balanced | Balance skill levels across bracket regions |
| fairness_optimized | Optimize for matchup fairness using simulated annealing |

### 2.6 Match Management (FR-MATCH)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-MATCH-001 | System shall track match status (pending, in_progress, completed) | High |
| FR-MATCH-002 | System shall record match results with scores | High |
| FR-MATCH-003 | System shall automatically advance winners to next round | High |
| FR-MATCH-004 | System shall track match timing (scheduled, started, ended) | Medium |
| FR-MATCH-005 | System shall support match result corrections with audit trail | Medium |
| FR-MATCH-006 | System shall prevent invalid score entries | High |

### 2.7 Fairness & Skill Rating (FR-FAIR)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-FAIR-001 | System shall maintain ELO-style skill ratings for competitors | Medium |
| FR-FAIR-002 | System shall track head-to-head matchup history | Medium |
| FR-FAIR-003 | System shall calculate matchup fairness scores | Medium |
| FR-FAIR-004 | System shall avoid repeated matchups when possible | Low |
| FR-FAIR-005 | System shall apply rating decay for inactive competitors | Low |
| FR-FAIR-006 | System shall estimate initial skill based on belt/experience | Medium |

### 2.8 Reporting & Export (FR-RPT)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-RPT-001 | System shall export brackets to PDF format | High |
| FR-RPT-002 | System shall export tournament results to Excel | Medium |
| FR-RPT-003 | System shall generate certificates for medal winners | Medium |
| FR-RPT-004 | System shall generate school-specific reports | Medium |
| FR-RPT-005 | System shall support batch export of all divisions | Medium |

### 2.9 Data Integrity (FR-DATA)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-DATA-001 | System shall warn before destructive operations | High |
| FR-DATA-002 | System shall create backups before regenerating divisions | High |
| FR-DATA-003 | System shall support state restoration from backups | Medium |
| FR-DATA-004 | System shall validate all API inputs with schemas | High |
| FR-DATA-005 | System shall prevent data loss without user confirmation | High |

---

## 3. Non-Functional Requirements

### 3.1 Performance (NFR-PERF)

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-PERF-001 | Page load time | < 2 seconds |
| NFR-PERF-002 | API response time (simple queries) | < 200ms |
| NFR-PERF-003 | API response time (complex operations) | < 5 seconds |
| NFR-PERF-004 | Division generation (100 competitors) | < 3 seconds |
| NFR-PERF-005 | Division generation (1000 competitors) | < 30 seconds |
| NFR-PERF-006 | Excel import (1000 rows) | < 10 seconds |
| NFR-PERF-007 | Concurrent users supported | 50+ |

### 3.2 Reliability (NFR-REL)

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-REL-001 | System availability | 99.5% |
| NFR-REL-002 | Data backup frequency | Before each destructive operation |
| NFR-REL-003 | Error recovery time | < 5 minutes |
| NFR-REL-004 | Data consistency | ACID transactions |

### 3.3 Security (NFR-SEC)

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-SEC-001 | All API inputs must be validated | High |
| NFR-SEC-002 | Authentication required for admin operations | High |
| NFR-SEC-003 | Audit logging for sensitive operations | Medium |
| NFR-SEC-004 | HTTPS for production deployment | High |
| NFR-SEC-005 | SQL injection prevention via ORM | High |

### 3.4 Usability (NFR-USE)

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-USE-001 | Responsive design for mobile/tablet use | High |
| NFR-USE-002 | Clear error messages with suggestions | High |
| NFR-USE-003 | Confirmation dialogs for destructive actions | High |
| NFR-USE-004 | Progress indicators for long operations | Medium |
| NFR-USE-005 | Keyboard navigation support | Low |

### 3.5 Maintainability (NFR-MAINT)

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-MAINT-001 | TypeScript for type safety | High |
| NFR-MAINT-002 | Centralized error handling | High |
| NFR-MAINT-003 | Modular service architecture | High |
| NFR-MAINT-004 | API versioning support | Low |
| NFR-MAINT-005 | Comprehensive logging | Medium |

### 3.6 Scalability (NFR-SCALE)

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-SCALE-001 | Competitors per tournament | 2,000+ |
| NFR-SCALE-002 | Divisions per tournament | 500+ |
| NFR-SCALE-003 | Concurrent tournaments | 10+ |
| NFR-SCALE-004 | Database growth | 100,000+ records |

---

## 4. API Contract Requirements

### 4.1 General API Requirements

| ID | Requirement |
|----|-------------|
| API-001 | All endpoints return JSON |
| API-002 | Error responses include: error, code, recoverable, suggestion |
| API-003 | Successful operations return 2xx status codes |
| API-004 | Client errors return 4xx status codes |
| API-005 | Server errors return 5xx status codes |
| API-006 | Long-running operations return progress indicators |

### 4.2 Error Response Format

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE",
  "recoverable": true,
  "suggestion": "What the user should try",
  "details": []
}
```

### 4.3 Standard Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Input validation failed |
| NOT_FOUND | 404 | Resource not found |
| DUPLICATE_ENTRY | 409 | Unique constraint violation |
| TOURNAMENT_NOT_FOUND | 404 | Tournament does not exist |
| COMPETITOR_NOT_FOUND | 404 | Competitor does not exist |
| COMPETITOR_ALREADY_REGISTERED | 409 | Duplicate registration |
| DIVISION_NOT_FOUND | 404 | Division does not exist |
| DIVISION_HAS_BRACKET | 409 | Cannot modify division with bracket |
| NO_REGISTRATIONS | 400 | No competitors registered |
| BRACKET_NOT_FOUND | 404 | Bracket does not exist |
| BRACKET_ALREADY_EXISTS | 409 | Bracket already generated |
| BRACKET_IN_PROGRESS | 409 | Matches in progress |
| INVALID_MATCH_UPDATE | 400 | Invalid match result |
| DATA_LOSS_WARNING | 409 | Operation would cause data loss |
| IMPORT_FAILED | 207 | Import completed with errors |
| TIMEOUT_ERROR | 504 | Operation timed out |
| INTERNAL_ERROR | 500 | Unexpected server error |

### 4.4 API Endpoints

#### Competitors
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/competitors | List all competitors |
| GET | /api/competitors/:id | Get competitor by ID |
| POST | /api/competitors | Create competitor |
| PUT | /api/competitors/:id | Update competitor |
| DELETE | /api/competitors/:id | Delete competitor |
| POST | /api/competitors/import | Import from Excel |

#### Tournaments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/tournaments | List tournaments |
| GET | /api/tournaments/:id | Get tournament details |
| POST | /api/tournaments | Create tournament |
| PUT | /api/tournaments/:id | Update tournament |
| DELETE | /api/tournaments/:id | Delete tournament |
| POST | /api/tournaments/:id/registrations | Register competitor |
| POST | /api/tournaments/:id/registrations/bulk | Bulk register |
| GET | /api/tournaments/:id/export/excel | Export results to Excel |
| GET | /api/tournaments/:id/export/certificates | Generate certificates |
| GET | /api/tournaments/:id/export/school-reports | School PDF reports |

#### Divisions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/divisions/tournament/:id | List divisions for tournament |
| GET | /api/divisions/:id | Get division with competitors |
| POST | /api/divisions | Create manual division |
| PUT | /api/divisions/:id | Update division |
| DELETE | /api/divisions/:id | Delete division |
| POST | /api/divisions/tournament/:id/preview | Preview categorization |
| POST | /api/divisions/tournament/:id/auto-generate | Auto-generate divisions |
| GET | /api/divisions/tournament/:id/check-data-loss | Check before regenerate |
| DELETE | /api/divisions/tournament/:id/all | Delete all divisions |
| POST | /api/divisions/:id/assign | Assign competitor |
| DELETE | /api/divisions/:id/assign/:assignmentId | Remove assignment |
| POST | /api/divisions/:id/move | Move competitor |
| POST | /api/divisions/:id/split | Split division |

#### Brackets
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/brackets/:id | Get bracket with matches |
| POST | /api/brackets/division/:id/generate | Generate bracket |
| DELETE | /api/brackets/:id | Delete bracket |
| PUT | /api/brackets/matches/:id | Update match result |
| GET | /api/brackets/:id/export/pdf | Export bracket PDF |
| POST | /api/brackets/tournament/:id/export-all | Batch export PDFs |

#### Fairness
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/fairness/division/:id/report | Division fairness report |
| POST | /api/fairness/matchup/check | Check matchup fairness |
| GET | /api/fairness/bracket/:id/analysis | Bracket fairness analysis |
| GET | /api/fairness/competitor/:id/rating | Competitor skill rating |
| GET | /api/fairness/head-to-head/:id1/:id2 | Head-to-head history |

---

## 5. Glossary

| Term | Definition |
|------|------------|
| BB | Black Belt - 1st Dan and above |
| CB | Colored Belt - White through Red |
| Dan | Black belt degree/rank (1st through 9th) |
| Division | A competitive category grouping similar competitors |
| Dojang | Taekwondo training school |
| Bracket | Tournament elimination structure |
| Patterns | Forms/poomsae competition (individual) |
| Sparring | Fighting competition (1v1) |
| Seeding | Initial placement of competitors in bracket |
| Bye | Automatic advancement when odd number of competitors |

---

## 6. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-24 | System | Initial requirements definition |
