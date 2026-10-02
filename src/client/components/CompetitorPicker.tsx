// Full-screen slide-out for adding registry competitors to a tournament.
// Directors narrow the list (gender, age on the tournament day, belt,
// weight, school), sort it, then "select all shown" to build smaller
// age/belt groups quickly. Filter and sort rules live in
// utils/competitor-picker.ts.
import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Filter, Search, X } from 'lucide-react';
import AccessibleDialog from './ui/AccessibleDialog';
import { Button, Input, Select } from './ui';
import {
  BELT_FILTER_OPTIONS,
  EMPTY_PICKER_FILTERS,
  ageOn,
  filterCompetitors,
  schoolOptions,
  sortCompetitors,
  type PickerCompetitor,
  type PickerFilters,
  type PickerSortKey,
} from '../utils/competitor-picker';

interface CompetitorPickerProps {
  competitors: PickerCompetitor[];
  /** All registry competitors were already loaded (false while fetching). */
  loaded: boolean;
  tournamentDate: Date;
  eventLabels: { patterns: string; sparring: string };
  pending: boolean;
  /** Shown above the footer when adding failed. */
  error?: ReactNode;
  onAdd: (selection: { competitorIds: string[]; patterns: boolean; sparring: boolean }) => void;
  onClose: () => void;
}

const COLUMNS: { key: PickerSortKey; label: string; className?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'age', label: 'Age', className: 'w-16' },
  { key: 'gender', label: 'Gender', className: 'w-20' },
  { key: 'belt', label: 'Belt', className: 'w-48' },
  { key: 'weight', label: 'Weight', className: 'w-20' },
  { key: 'school', label: 'School', className: 'w-48' },
];

const fieldClass = 'grid gap-1 text-xs font-medium text-surface-600 dark:text-surface-300';

export default function CompetitorPicker({
  competitors,
  loaded,
  tournamentDate,
  eventLabels,
  pending,
  error,
  onAdd,
  onClose,
}: CompetitorPickerProps) {
  const [filters, setFilters] = useState<PickerFilters>(EMPTY_PICKER_FILTERS);
  const [sortKey, setSortKey] = useState<PickerSortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [patterns, setPatterns] = useState(true);
  const [sparring, setSparring] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const schools = useMemo(() => schoolOptions(competitors), [competitors]);
  const shown = useMemo(
    () => sortCompetitors(filterCompetitors(competitors, filters, tournamentDate), sortKey, sortDir, tournamentDate),
    [competitors, filters, sortKey, sortDir, tournamentDate],
  );
  const activeFilterCount = [
    filters.gender, filters.ageMin, filters.ageMax, filters.weightMin, filters.weightMax, filters.school,
  ].filter(Boolean).length + (filters.belts.length > 0 ? 1 : 0);
  const allShownSelected = shown.length > 0 && shown.every((c) => selected.has(c.id));

  const set = <K extends keyof PickerFilters>(key: K, value: PickerFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllShown = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allShownSelected) shown.forEach((c) => next.delete(c.id));
    else shown.forEach((c) => next.add(c.id));
    return next;
  });
  const sortBy = (key: PickerSortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const close = () => { if (!pending) onClose(); };

  // Rendered into <body> so it sits above the app sidebar and isn't
  // positioned inside the page's animated wrapper.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-surface-950/40" onClick={close}>
      <AccessibleDialog
        label="Add competitors"
        onClose={close}
        className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-white shadow-2xl dark:bg-surface-900 animate-slide-in-right"
      >
        <div className="flex h-full min-h-0 flex-col" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-surface-200 px-4 py-3 dark:border-surface-700 lg:px-6">
            <h2 className="flex-1 text-lg font-semibold text-surface-900 dark:text-white">Add competitors</h2>
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="rounded-md p-2 text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800"
              aria-label="Close add competitors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Search + filters */}
          <div className="space-y-3 border-b border-surface-200 px-4 py-3 dark:border-surface-700 lg:px-6">
            <div className="flex min-w-0 gap-2">
              <Input
                aria-label="Search competitors by name or school"
                placeholder="Search name or school"
                value={filters.search}
                onChange={(e) => set('search', e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
                className="flex-1"
              />
              <Button
                variant="secondary"
                className="lg:hidden"
                aria-expanded={showFilters}
                aria-controls="picker-filters"
                onClick={() => setShowFilters((v) => !v)}
              >
                <Filter className="mr-1.5 h-4 w-4" /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
              </Button>
            </div>
            <div id="picker-filters" className={`${showFilters ? 'grid' : 'hidden'} gap-3 sm:grid-cols-2 lg:grid lg:grid-cols-6`}>
              <div className={fieldClass}>
                <label htmlFor="picker-gender">Gender</label>
                <Select id="picker-gender" value={filters.gender} onChange={(e) => set('gender', e.target.value as PickerFilters['gender'])}>
                  <option value="">All</option>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                </Select>
              </div>
              <div className={fieldClass}>
                <span id="picker-age-label">Age on tournament day</span>
                <div className="flex items-center gap-2" role="group" aria-labelledby="picker-age-label">
                  <Input aria-label="Youngest age" inputMode="numeric" placeholder="From" value={filters.ageMin} onChange={(e) => set('ageMin', e.target.value)} />
                  <span aria-hidden="true">–</span>
                  <Input aria-label="Oldest age" inputMode="numeric" placeholder="To" value={filters.ageMax} onChange={(e) => set('ageMax', e.target.value)} />
                </div>
              </div>
              <div className={fieldClass}>
                <span id="picker-weight-label">Weight (lbs)</span>
                <div className="flex items-center gap-2" role="group" aria-labelledby="picker-weight-label">
                  <Input aria-label="Lightest weight" inputMode="decimal" placeholder="From" value={filters.weightMin} onChange={(e) => set('weightMin', e.target.value)} />
                  <span aria-hidden="true">–</span>
                  <Input aria-label="Heaviest weight" inputMode="decimal" placeholder="To" value={filters.weightMax} onChange={(e) => set('weightMax', e.target.value)} />
                </div>
              </div>
              <div className={fieldClass}>
                <label htmlFor="picker-school">School</label>
                <Select id="picker-school" value={filters.school} onChange={(e) => set('school', e.target.value)}>
                  <option value="">All schools</option>
                  {schools.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <div className={`${fieldClass} sm:col-span-2`}>
                <span id="picker-belt-label">Belts</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="picker-belt-label">
                  {BELT_FILTER_OPTIONS.map((belt) => {
                    const on = filters.belts.includes(belt);
                    return (
                      <button
                        key={belt}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set('belts', on ? filters.belts.filter((b) => b !== belt) : [...filters.belts, belt])}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium ${on
                          ? 'border-primary-500 bg-primary-600 text-white'
                          : 'border-surface-300 text-surface-700 hover:border-primary-400 dark:border-surface-600 dark:text-surface-200'}`}
                      >
                        {belt}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-surface-600 dark:text-surface-300" aria-live="polite">
                Showing {shown.length} of {competitors.length}
              </span>
              {shown.length > 0 && (
                <button type="button" onClick={toggleAllShown} className="font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
                  {allShownSelected ? `Unselect these ${shown.length}` : `Select all ${shown.length} shown`}
                </button>
              )}
              {(activeFilterCount > 0 || filters.search) && (
                <button type="button" onClick={() => setFilters(EMPTY_PICKER_FILTERS)} className="text-surface-600 underline hover:text-surface-900 dark:text-surface-300">
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="min-h-0 flex-1 overflow-y-auto bg-surface-50 dark:bg-surface-950/50">
            {!loaded ? (
              <p className="p-6 text-sm text-surface-600 dark:text-surface-300">Loading competitors…</p>
            ) : competitors.length === 0 ? (
              <p className="p-6 text-sm text-surface-600 dark:text-surface-300">
                No competitors to add. Import competitors first, or everyone is already registered.
              </p>
            ) : shown.length === 0 ? (
              <p className="p-6 text-sm text-surface-600 dark:text-surface-300">Nobody matches these filters.</p>
            ) : (
              <table className="block w-full text-sm md:table [overflow-wrap:anywhere]">
                <caption className="sr-only">Competitors you can add. Column headings sort the list.</caption>
                <thead className="sticky top-0 z-10 hidden bg-white text-left text-xs uppercase tracking-wide text-surface-600 shadow-sm dark:bg-surface-900 dark:text-surface-300 md:table-header-group">
                  <tr>
                    <th className="w-12 px-4 py-2"><span className="sr-only">Selected</span></th>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={`px-2 py-2 ${col.className ?? ''}`}
                        aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <button type="button" onClick={() => sortBy(col.key)} className="inline-flex items-center gap-1 font-semibold uppercase hover:text-surface-900 dark:hover:text-white">
                          {col.label}
                          {sortKey === col.key && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="block md:table-row-group">
                  {shown.map((c) => {
                    const age = ageOn(c.dateOfBirth, tournamentDate);
                    const isSelected = selected.has(c.id);
                    const name = `${c.firstName} ${c.lastName}`;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => toggle(c.id)}
                        className={`cursor-pointer border-b border-surface-200 dark:border-surface-800 ${isSelected ? 'bg-primary-50 dark:bg-primary-900/30' : 'bg-white hover:bg-surface-50 dark:bg-surface-900 dark:hover:bg-surface-800'} block md:table-row`}
                      >
                        <td className="px-4 py-3 align-middle md:w-12 inline-block md:table-cell">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggle(c.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select ${name}`}
                            className="h-5 w-5 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                        <td className="px-2 py-3 font-medium text-surface-900 dark:text-white inline-block max-w-[calc(100%-3.5rem)] align-middle [overflow-wrap:anywhere] md:max-w-none md:table-cell">{name}</td>
                        <td className="hidden px-2 py-3 md:table-cell">{age ?? '—'}</td>
                        <td className="hidden px-2 py-3 md:table-cell">{c.gender}</td>
                        <td className="hidden px-2 py-3 md:table-cell">{c.belt}{c.danRank ? ` (${c.danRank} dan)` : ''}</td>
                        <td className="hidden px-2 py-3 md:table-cell">{c.weightLbs ?? '—'}</td>
                        <td className="hidden px-2 py-3 md:table-cell">{c.schoolDojang ?? '—'}</td>
                        {/* Phone: one summary line under the name */}
                        <td className="block px-4 pb-3 text-xs text-surface-600 dark:text-surface-300 [overflow-wrap:anywhere] md:hidden">
                          {[age != null ? `${age} yrs` : null, c.gender, c.belt, c.weightLbs != null ? `${c.weightLbs} lbs` : null, c.schoolDojang]
                            .filter(Boolean).join(' · ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="space-y-3 border-t border-surface-200 bg-white px-4 py-3 dark:border-surface-700 dark:bg-surface-900 lg:px-6">
            {error}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <fieldset className="flex flex-wrap items-center gap-4">
                <legend className="sr-only">Register selected competitors for</legend>
                <span className="text-sm text-surface-600 dark:text-surface-300">Enter in:</span>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={patterns} onChange={(e) => setPatterns(e.target.checked)} disabled={pending} className="rounded border-surface-300 text-primary-600" />
                  {eventLabels.patterns}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sparring} onChange={(e) => setSparring(e.target.checked)} disabled={pending} className="rounded border-surface-300 text-primary-600" />
                  {eventLabels.sparring}
                </label>
              </fieldset>
              <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
                <span className="mr-auto text-sm text-surface-600 dark:text-surface-300 sm:mr-0">
                  <span className="font-semibold text-surface-900 dark:text-white">{selected.size}</span> selected
                </span>
                <Button variant="secondary" onClick={close} disabled={pending}>Cancel</Button>
                <Button
                  variant="primary"
                  loading={pending}
                  disabled={pending || selected.size === 0 || (!patterns && !sparring)}
                  onClick={() => onAdd({ competitorIds: [...selected], patterns, sparring })}
                >
                  {pending ? 'Adding…' : `Add ${selected.size} competitor${selected.size === 1 ? '' : 's'}`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </AccessibleDialog>
    </div>,
    document.body,
  );
}
