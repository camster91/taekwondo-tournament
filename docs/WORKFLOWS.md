# Tournament Management Workflows

This document describes the key workflows in the tournament management system and potential issues that could arise.

## Table of Contents
1. [Pre-Tournament Setup](#pre-tournament-setup)
2. [Registration Day](#registration-day)
3. [Division Generation](#division-generation)
4. [Bracket Creation & Competition](#bracket-creation--competition)
5. [Results & Reporting](#results--reporting)

---

## 1. Pre-Tournament Setup

### Workflow Steps:
1. **Create Tournament** - Set name, date, location
2. **Import Competitors** - Upload Excel file with competitor data
3. **Review/Edit Competitors** - Fix any data issues
4. **Configure Weight Classes** - Optional custom weight classes

### Potential Issues:

| Issue | Cause | Solution |
|-------|-------|----------|
| Excel import fails | Incorrect column names | Provide template + clear error messages |
| Duplicate competitors | Same person imported twice | Dedupe by name+DOB, show merge option |
| Invalid dates | DOB in wrong format | Multiple date format support, validation |
| Missing required fields | Incomplete Excel data | Highlight missing fields, allow partial import |
| Large file timeout | 1000+ competitors | Batch processing with progress indicator |

### Error Handling:
- Show row-by-row import results
- Allow retry of failed rows
- Save partial imports (don't lose successful rows if some fail)

---

## 2. Registration Day

### Workflow Steps:
1. **Bulk Register** - Add competitors to tournament
2. **Individual Registration** - Late registrations
3. **Check-in** - Verify attendance
4. **Weigh-in** - Record actual weight (sparring)

### Potential Issues:

| Issue | Cause | Solution |
|-------|-------|----------|
| Competitor not found | Name misspelling | Fuzzy search, suggest similar names |
| Wrong weight class | Weight changed since registration | Allow weight update before divisions |
| Double registration | Staff confusion | Clear registration status indicators |
| Network timeout | Many concurrent registrations | Queue requests, offline mode |
| Age miscalculation | Timezone issues | Use tournament date for age calc |

### Error Handling:
- Confirmation dialogs for destructive actions
- Undo recent registrations
- Show registration count/status dashboard
- Handle duplicate registration attempts gracefully

---

## 3. Division Generation

### Workflow Steps:
1. **Preview Divisions** - See proposed divisions before committing
2. **Adjust Parameters** - Change threshold, enable smart splitting
3. **Generate Divisions** - Create divisions and assignments
4. **Manual Adjustments** - Move competitors between divisions

### Potential Issues:

| Issue | Cause | Solution |
|-------|-------|----------|
| Timeout on large tournaments | 500+ registrations | Batched processing, progress bar |
| Unbalanced divisions | Poor algorithm parameters | Preview mode, parameter tuning |
| Empty divisions | Too strict criteria | Smart merging, warnings |
| Too many divisions | Low threshold | Minimum division size warnings |
| Lost manual changes | Regeneration | Confirm before regenerating |

### Error Handling:
- **CRITICAL**: Never lose division data without confirmation
- Show diff when regenerating (what will change)
- Backup current state before regeneration
- Rollback option if results are bad

---

## 4. Bracket Creation & Competition

### Workflow Steps:
1. **Generate Brackets** - Create bracket structure
2. **Seed Competitors** - Apply seeding strategy
3. **Record Results** - Enter match winners
4. **Handle Issues** - Byes, withdrawals, disputes

### Potential Issues:

| Issue | Cause | Solution |
|-------|-------|----------|
| Wrong winner entered | User error | Edit/undo match result |
| Competitor withdrawal | Injury, no-show | Mark as withdrawal, advance opponent |
| Bracket corruption | Concurrent edits | Optimistic locking, refresh |
| Lost bracket state | Browser crash | Auto-save, local storage backup |
| Seeding errors | Bad data | Fairness preview before commit |

### Error Handling:
- Match result editing with audit trail
- Withdrawal handling (BYE advancement)
- Auto-save every action
- Conflict detection for concurrent edits
- Clear visual indication of bracket status

---

## 5. Results & Reporting

### Workflow Steps:
1. **View Results** - See placements by division
2. **Generate Certificates** - PDF certificates for winners
3. **Export Reports** - School reports, Excel exports
4. **Record History** - Update competitor records

### Potential Issues:

| Issue | Cause | Solution |
|-------|-------|----------|
| Missing placements | Incomplete brackets | Require bracket completion |
| PDF generation fails | Font/template issues | Fallback templates, error handling |
| Large PDF timeout | Many certificates | Generate in batches, show progress |
| Wrong medal count | Bracket inconsistency | Validate bracket before reporting |

### Error Handling:
- Progress indicator for bulk operations
- Retry failed PDF generations
- Export partial results (don't fail completely)
- Validation before finalizing tournament

---

## Workflow State Machine

```
DRAFT -> REGISTRATION -> DIVISIONS -> BRACKETS -> IN_PROGRESS -> COMPLETED
          ↑                 ↑           ↑
          └─────────────────┴───────────┘ (can go back with confirmation)
```

### Status Transitions:
- **DRAFT → REGISTRATION**: Tournament details complete
- **REGISTRATION → DIVISIONS**: At least 1 registration
- **DIVISIONS → BRACKETS**: All divisions have brackets
- **BRACKETS → IN_PROGRESS**: Competition starts
- **IN_PROGRESS → COMPLETED**: All brackets complete

---

## Global Error Handling Strategy

### 1. API Error Responses
```json
{
  "error": "Human-readable message",
  "code": "ERROR_CODE",
  "details": [...],
  "recoverable": true,
  "suggestion": "Try this..."
}
```

### 2. Client-Side Error Handling
- Toast notifications for transient errors
- Modal dialogs for critical errors
- Form validation before submission
- Loading states and progress indicators

### 3. Data Integrity
- Database transactions for multi-step operations
- Foreign key constraints
- Soft deletes for recovery
- Audit logging for changes

### 4. Recovery Mechanisms
- Auto-save to local storage
- Undo/redo for recent actions
- Export current state before destructive operations
- Rollback endpoints for admin recovery

---

## Testing Checklist

### Pre-Tournament
- [ ] Import 1000+ competitors (stress test)
- [ ] Import with missing fields
- [ ] Import with duplicates
- [ ] Edit competitor after import

### Registration
- [ ] Bulk register all competitors
- [ ] Register individual late entry
- [ ] Un-register competitor
- [ ] Check-in workflow

### Divisions
- [ ] Generate with default settings
- [ ] Preview before generating
- [ ] Regenerate (should warn)
- [ ] Manual competitor moves

### Brackets
- [ ] Generate all brackets
- [ ] Enter all match results
- [ ] Handle withdrawal
- [ ] Edit incorrect result

### Reporting
- [ ] Export all certificates
- [ ] School report generation
- [ ] Excel export
- [ ] View results by division
