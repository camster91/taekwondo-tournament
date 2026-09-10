# Shared Component Contracts

**Created:** 2026-09-10  
**Owner:** Bowin Product Team  
**Purpose:** Enforce consistent loading, empty, error, and success states across day-of surfaces  
**See also:** [DESIGN_TOKENS.md](./DESIGN_TOKENS.md) for visual token system

---

## Overview

This document defines the behavioral contracts for shared UI components used in critical event surfaces (CheckIn, Scorekeeper, Divisions, DirectorDashboard, Tournaments). Consistency in loading, error, and empty states builds trust and reduces cognitive load for organizers running live events.

**Scope:** Components in `src/client/components/ui/` and utilities in `src/client/utils/async-state.ts`.

**Hard constraints:**
- Adult terse copy (no emoji, no marketing fluff)
- ARIA attributes for screen readers
- Dark mode support via Tailwind `dark:` variants
- Loading states must be interruptible (cancel-first focus)
- Error states must offer retry where applicable
- **Use semantic design tokens** (see DESIGN_TOKENS.md): `surface-*`, `primary-*`, `accent-*`, `success`, `warning`, `danger`, `info`

---

## Async State Utilities (`src/client/utils/async-state.ts`)

### AsyncState Type

```typescript
export type AsyncState = 'idle' | 'loading' | 'success' | 'error' | 'offline' | 'retrying';

export interface AsyncOperationState {
  state: AsyncState;
  error?: string;
  retryCount?: number;
  lastSuccessAt?: Date;
}
```

**Contract:**
- `idle`: No operation started or explicitly reset
- `loading`: Initial load or refresh in progress
- `success`: Operation completed successfully (data available)
- `error`: Operation failed (network, validation, server error)
- `offline`: Operation blocked by offline state (navigator.onLine === false)
- `retrying`: Retry attempt in progress after error/offline

**State transitions:**
- `idle` → `loading` (user action or mount)
- `loading` → `success` | `error` | `offline`
- `error` → `retrying` (user clicks retry)
- `retrying` → `success` | `error`
- `offline` → `retrying` (connection restored)

**Helpers:**
- `getAsyncStateLabel(state)`: Returns human-readable label ("Loading...", "Failed to load", etc.)
- `getAsyncStateVariant(state)`: Returns visual variant for badges/alerts (`success`, `error`, `warning`, `info`, `default`)
- `canRetry(state)`: Returns `true` if retry action should be available
- `isOperationInProgress(state)`: Returns `true` for `loading` or `retrying`
- `getAsyncStateMessage(state, context?)`: Returns contextual user message with resource name and action

**Usage pattern:**
```typescript
const [asyncState, setAsyncState] = useState<AsyncOperationState>({ state: 'idle' });

async function loadData() {
  setAsyncState({ state: 'loading' });
  try {
    const data = await api.get('/resource');
    setAsyncState({ state: 'success', lastSuccessAt: new Date() });
  } catch (error) {
    setAsyncState({ 
      state: 'error', 
      error: error instanceof Error ? error.message : 'Failed to load' 
    });
  }
}

function retry() {
  setAsyncState(prev => ({ ...prev, state: 'retrying', retryCount: (prev.retryCount || 0) + 1 }));
  loadData();
}
```

### MutationState Type

```typescript
export type MutationState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'retrying';

export interface MutationOperationState {
  state: MutationState;
  error?: string;
  retryCount?: number;
}
```

**Contract:**
- `idle`: No changes, clean slate
- `dirty`: Unsaved changes present (triggers beforeunload warning)
- `saving`: Save operation in progress
- `saved`: Save completed successfully (auto-fade after 3s recommended)
- `error`: Save failed
- `offline`: Save blocked by offline state (queue locally if applicable)
- `retrying`: Retry save in progress

**State transitions:**
- `idle` → `dirty` (user edits)
- `dirty` → `saving` (user clicks save)
- `saving` → `saved` | `error` | `offline`
- `error` → `retrying` (user clicks retry)
- `saved` → `idle` (after fade timer or next edit)

**Helpers:**
- `getMutationStateLabel(state)`: Returns label ("Saving...", "Saved", "Save failed", etc.)
- `getMutationStateVariant(state)`: Returns visual variant
- `shouldBlockNavigationForMutation(state)`: Returns `true` if `dirty`, `saving`, or `retrying` (attach to beforeunload)
- `canRetryMutation(state)`: Returns `true` if retry available
- `getMutationBeforeUnloadMessage(state)`: Returns warning message for beforeunload event

**Usage pattern:**
```typescript
const [mutationState, setMutationState] = useState<MutationOperationState>({ state: 'idle' });

useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    const message = getMutationBeforeUnloadMessage(mutationState.state);
    if (message) {
      e.preventDefault();
      e.returnValue = message;
    }
  };
  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [mutationState.state]);
```

### ListState Type

```typescript
export interface ListState {
  loading: boolean;
  error?: string;
  retrying: boolean;
  isEmpty: boolean;
  isFiltered: boolean;
}
```

**Contract:**
- `loading`: Initial list load in progress
- `error`: List load failed
- `retrying`: Retry attempt in progress
- `isEmpty`: List has zero items (after successful load)
- `isFiltered`: Active filters applied (affects empty state message)

**Helpers:**
- `getEmptyStateMessage(state, context)`: Returns contextual empty message (filtered vs unfiltered)
- `getListErrorMessage(error, resourceName)`: Returns error message with resource context

---

## Component Contracts

### `<Spinner />`

**Purpose:** Inline loading indicator for operations in progress.

**Props:**
```typescript
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string; // ARIA label for screen readers
  className?: string;
}
```

**Contract:**
- Always include `role="status"` and `aria-live="polite"`
- Default label is "Loading"
- Never use standalone without context (wrap in container or use label prop)
- Size guidelines:
  - `sm` (16px): Inline button/badge indicators
  - `md` (24px): Default, card/section loading
  - `lg` (48px): Full-page/modal loading

**Usage pattern:**
```tsx
{isLoading && <Spinner size="md" label="Loading competitors" />}
```

**Anti-patterns:**
- ❌ Raw `<div>Loading...</div>` text
- ❌ Inline SVG spinners without ARIA labels
- ❌ Using Spinner without checking loading state

---

### `<EmptyState />`

**Purpose:** Display when a list or collection has zero items.

**Props:**
```typescript
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}
```

**Contract:**
- Always provide a clear `title` (e.g., "No competitors yet")
- `description` should explain next steps or context
- `action` is optional but recommended for primary creation flows
- Never show EmptyState while loading (check `loading === false` first)
- Use `isFiltered` context to differentiate:
  - Filtered: "No results match your filters. Try adjusting search criteria."
  - Unfiltered: "No [resource] yet. Create your first one to get started."

**Usage pattern:**
```tsx
{!loading && isEmpty && (
  <EmptyState
    icon={<UsersIcon className="h-12 w-12 text-gray-400" />}
    title="No competitors registered"
    description="Import from Excel or add competitors manually to get started."
    action={{
      label: 'Import Competitors',
      onClick: () => navigate('/competitors?import=true')
    }}
  />
)}
```

**Anti-patterns:**
- ❌ Showing EmptyState while `loading === true`
- ❌ Generic "No data" without context
- ❌ Missing action button for primary creation flow

---

### `<OperationStatus />`

**Purpose:** Display async operation state (saving, saved, error, offline) with optional retry action.

**Props:**
```typescript
interface OperationStatusProps {
  state: OperationState;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  children?: ReactNode;
}

type OperationState = 'pending' | 'saved' | 'queued' | 'retrying' | 'rejected' | 'resolved';
```

**Contract:**
- Always provide contextual `message` (not just state label)
- `actionLabel` and `onAction` required together for retry/resolve actions
- Icons animate for `pending` and `retrying` states
- `role="alert"` for `rejected`, `role="status"` otherwise
- Auto-fade `saved` state after 3s (caller's responsibility)
- Colors follow semantic mapping:
  - `pending`/`retrying`: Blue (info)
  - `saved`/`resolved`: Green (success)
  - `queued`: Amber (warning)
  - `rejected`: Red (error)

**Usage pattern:**
```tsx
{mutationState.state !== 'idle' && (
  <OperationStatus
    state={mapMutationToOperationState(mutationState.state)}
    message={getMutationStateMessage(mutationState)}
    actionLabel={canRetryMutation(mutationState.state) ? 'Retry' : undefined}
    onAction={canRetryMutation(mutationState.state) ? handleRetry : undefined}
  />
)}
```

**Helper mapping:**
```typescript
function mapMutationToOperationState(mutation: MutationState): OperationState {
  switch (mutation) {
    case 'saving': return 'pending';
    case 'saved': return 'saved';
    case 'offline': return 'queued';
    case 'retrying': return 'retrying';
    case 'error': return 'rejected';
    default: return 'saved'; // idle/dirty not mapped
  }
}
```

**Anti-patterns:**
- ❌ Hardcoded "Saving..." text instead of using `OperationStatus`
- ❌ Missing retry action for `rejected` state
- ❌ Showing OperationStatus for `idle` state (hide component instead)

---

### `<Button />`

**Purpose:** Primary interactive element with loading and disabled states.

**Props:**
```typescript
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}
```

**Contract:**
- `loading={true}` shows inline Spinner and sets `disabled`
- `disabled` attr disables interaction and reduces opacity
- Always include `type="button"` or `type="submit"` (never rely on default)
- Loading state:
  - Shows Spinner to the left of text
  - Original icon (if any) is hidden
  - Text remains visible (not just spinner)
  - ARIA label includes loading context
- Focus styles are always visible (outline + offset)
- Danger variant actions require ConfirmDialog (contract below)

**Usage pattern:**
```tsx
<Button
  variant="primary"
  loading={isSubmitting}
  disabled={!hasChanges || isSubmitting}
  onClick={handleSubmit}
>
  Save Changes
</Button>
```

**Anti-patterns:**
- ❌ Manually disabling button during loading (use `loading` prop)
- ❌ Replacing button text with "Loading..." (keep original text + spinner)
- ❌ Danger actions without confirmation dialog

---

### `<ConfirmDialog />`

**Purpose:** Block dangerous actions with explicit user confirmation.

**Props:**
```typescript
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}
```

**Contract:**
- Always open ConfirmDialog before irreversible actions (delete, reset, revoke)
- `title` states the action (e.g., "Delete competitor?")
- `description` explains consequences (e.g., "This will permanently remove... This cannot be undone.")
- `confirmLabel` defaults to "Confirm" but should be action-specific ("Delete", "Reset", "Revoke")
- `cancelLabel` defaults to "Cancel"
- `variant`:
  - `danger`: Red confirm button (delete, purge, revoke)
  - `warning`: Amber confirm button (reset, discard)
- Cancel button has autofocus (cancel-first pattern)
- Confirm button shows loading state during async operation
- Escape key closes dialog (cancel action)
- Backdrop click closes dialog (cancel action)

**Usage pattern:**
```tsx
const [showConfirm, setShowConfirm] = useState(false);
const [isDeleting, setIsDeleting] = useState(false);

async function handleDelete() {
  setIsDeleting(true);
  try {
    await api.delete(`/competitors/${id}`);
    navigate('/competitors');
  } catch (error) {
    toast.error('Failed to delete competitor');
  } finally {
    setIsDeleting(false);
    setShowConfirm(false);
  }
}

<ConfirmDialog
  open={showConfirm}
  onOpenChange={setShowConfirm}
  title="Delete competitor?"
  description="This will permanently remove this competitor and all registration history. This cannot be undone."
  confirmLabel="Delete"
  variant="danger"
  onConfirm={handleDelete}
  loading={isDeleting}
/>
```

**Anti-patterns:**
- ❌ Skipping confirmation for destructive actions
- ❌ Generic "Are you sure?" without explaining consequences
- ❌ Confirm button has autofocus (should be Cancel)

---

### `<Modal />`

**Purpose:** Display content in a focus-trapped overlay with backdrop.

**Props:**
```typescript
interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  preventClose?: boolean; // Blocks backdrop/ESC close
}
```

**Contract:**
- Always provide `title` (rendered as `<h2>` with `aria-labelledby`)
- `description` is optional but recommended for context
- `children` contains the modal body content
- `footer` should contain action buttons (Cancel, Save, etc.)
- Escape key closes modal unless `preventClose={true}`
- Backdrop click closes modal unless `preventClose={true}`
- Body scroll is locked while modal is open
- Focus trap prevents tabbing outside modal
- Close button in header (X icon) always visible
- `size`:
  - `sm` (400px): Confirm dialogs, simple forms
  - `md` (600px): Default, standard forms
  - `lg` (800px): Multi-section forms
  - `xl` (1000px): Wide tables/lists
  - `full`: Full-screen overlay (use sparingly)

**Usage pattern:**
```tsx
<Modal
  open={showEditModal}
  onOpenChange={setShowEditModal}
  title="Edit competitor"
  description="Update competitor details below."
  size="md"
  footer={
    <>
      <Button variant="secondary" onClick={() => setShowEditModal(false)}>
        Cancel
      </Button>
      <Button
        variant="primary"
        loading={isSaving}
        onClick={handleSave}
      >
        Save Changes
      </Button>
    </>
  }
>
  <form>{/* form fields */}</form>
</Modal>
```

**Anti-patterns:**
- ❌ Missing title or using generic "Modal" title
- ❌ Not providing close mechanisms (backdrop, ESC, X button)
- ❌ Nested modals (find alternative UX)
- ❌ Using modal for non-blocking notifications (use toast instead)

---

### `<Input />` and `<Select />`

**Purpose:** Form controls with consistent validation and error display.

**Props:**
```typescript
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helpText?: string;
  required?: boolean;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  helpText?: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
}
```

**Contract:**
- Always provide `label` (rendered as `<label>` with `htmlFor`)
- `error` displays below input in red (with error icon)
- `helpText` displays below input in gray (guidance text)
- `required` adds visual indicator (*) and `aria-required="true"`
- Error state:
  - Input border turns red
  - Error message has `role="alert"`
  - Error icon appears
- Disabled state reduces opacity and sets `cursor: not-allowed`
- Focus styles are always visible (ring + offset)

**Usage pattern:**
```tsx
<Input
  label="Competitor name"
  name="name"
  value={formData.name}
  onChange={handleChange}
  error={validationErrors.name}
  helpText="First and last name required"
  required
/>

<Select
  label="Belt level"
  name="belt"
  value={formData.belt}
  onChange={handleChange}
  error={validationErrors.belt}
  required
  options={[
    { value: 'white', label: 'White Belt' },
    { value: 'yellow', label: 'Yellow Belt' },
    // ...
  ]}
/>
```

**Anti-patterns:**
- ❌ Missing label (never use placeholder as label)
- ❌ Generic error message ("Invalid input")
- ❌ Showing error before user interaction (wait for blur or submit)

---

### `<Card />`, `<CardHeader />`, `<CardBody />`

**Purpose:** Container for grouped content with consistent padding and borders.

**Props:**
```typescript
interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'bordered' | 'elevated';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

interface CardBodyProps {
  children: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}
```

**Contract:**
- `Card` is the container (border, background, shadow)
- `CardHeader` contains title, optional subtitle, optional action (button/link)
- `CardBody` contains the main content with consistent padding
- `variant`:
  - `default`: Plain background, no border
  - `bordered`: Border, no shadow
  - `elevated`: Border + subtle shadow (default)
- `padding` overrides default spacing (default is `md`)
- Dark mode support via Tailwind dark: variants

**Usage pattern:**
```tsx
<Card variant="elevated">
  <CardHeader
    title="Registered competitors"
    subtitle="50 registered, 12 checked in"
    action={
      <Button variant="secondary" size="sm" onClick={handleExport}>
        Export CSV
      </Button>
    }
  />
  <CardBody>
    {/* table or list content */}
  </CardBody>
</Card>
```

**Anti-patterns:**
- ❌ Inconsistent padding (use Card's padding prop)
- ❌ Missing CardHeader when title is present
- ❌ Nesting Cards without semantic reason

---

## Migration Checklist

For each surface being migrated to shared component contracts:

### Before Migration
- [ ] Identify ad-hoc loading indicators (raw "Loading..." text, inline SVGs)
- [ ] Identify custom error banners (not using OperationStatus)
- [ ] Identify empty state markup (not using EmptyState)
- [ ] Identify duplicate async state logic (replace with async-state helpers)
- [ ] Note any retry actions missing

### During Migration
- [ ] Replace ad-hoc spinners with `<Spinner />` component
- [ ] Replace error banners with `<OperationStatus />` + retry action
- [ ] Replace empty state markup with `<EmptyState />` + contextual message
- [ ] Introduce `AsyncOperationState` or `MutationOperationState` where applicable
- [ ] Use `getAsyncStateMessage()` and related helpers for consistent copy
- [ ] Ensure all dangerous actions have `<ConfirmDialog />` gate
- [ ] Verify ARIA labels present on all interactive elements
- [ ] Test dark mode rendering

### After Migration
- [ ] Verify loading states render correctly
- [ ] Verify error states show retry button where applicable
- [ ] Verify empty states show correct message (filtered vs unfiltered)
- [ ] Test keyboard navigation (Tab, Enter, Escape)
- [ ] Test screen reader announcements (role, aria-live, aria-label)
- [ ] Smoke test: page compiles, no console errors, basic flow works
- [ ] Unit tests added for any new pure helpers

---

## Acceptance Criteria for Issue #147

### Component Contract Documentation
- [x] `COMPONENT_CONTRACTS.md` created with contracts for:
  - [x] AsyncState and MutationState utilities
  - [x] Spinner, EmptyState, OperationStatus components
  - [x] Button loading states
  - [x] ConfirmDialog cancel-first pattern
  - [x] Modal size and close behavior
  - [x] Input/Select error display
  - [x] Card structure

### Critical Surface Migrations
Target: 2-3 highest-traffic day-of surfaces with inconsistent patterns.

**Candidates (identified by subagent analysis):**
1. CheckIn - Ad-hoc loading/error states
2. Scorekeeper - Custom status banners
3. Divisions - Duplicate empty state logic
4. DirectorDashboard - Missing retry actions
5. Tournaments - Partially migrated in #262

**Requirements:**
- [ ] Migrate at least 2 surfaces to use:
  - [ ] Shared Spinner component (replace ad-hoc indicators)
  - [ ] OperationStatus for errors (with retry where applicable)
  - [ ] EmptyState for zero-item lists
  - [ ] async-state helpers (AsyncOperationState or MutationOperationState)
- [ ] Adult terse copy (no emoji, action-focused)
- [ ] ARIA labels present
- [ ] Dark mode verified
- [ ] Unit tests for new pure helpers (if any)
- [ ] Smoke test: migrated surfaces compile and basic flow works

### Ship Plan Update
- [ ] `docs/END_TO_END_SHIP_PLAN.md` updated with:
  - [ ] #147 status (met acceptance criteria vs leftovers)
  - [ ] Technical decisions made (which surfaces migrated, why)
  - [ ] Known gaps (surfaces not yet migrated, future work)

### Draft PR
- [ ] PR opened with `draft: true`
- [ ] Summary explains contract enforcement + migration scope
- [ ] Test plan covers changed surfaces
- [ ] Acceptance checklist matches issue #147
- [ ] No #150 design-token refactor scope creep

---

## Out of Scope for Issue #147

These items are explicitly NOT part of #147 contract work:

- ❌ **Design token unification** (#150) - Only touch tokens if required for contract consistency
- ❌ **Full migration of all surfaces** - Target 2-3 critical surfaces, not comprehensive sweep
- ❌ **New component creation** - Use existing components, extend only if required for contract
- ❌ **Performance optimization** - Focus on consistency, not speed
- ❌ **Comprehensive E2E testing** - Smoke test only, full E2E is separate effort
- ❌ **Accessibility audit** - Ensure ARIA labels present, but not full audit
- ❌ **Mobile responsive polish** - Verify it works, don't redesign
- ❌ **Offline mode enhancement** - Use existing offline utilities, don't rebuild

Keep scope tight. #147 is about **consistent contracts**, not a UX redesign.
