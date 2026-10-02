// Filtering and sorting for the "Add competitors" picker on a tournament.
// Pure functions so the rules are unit-tested without React.
import { BELT_CATEGORIES, COLORED_BELTS, getSimpleBeltCategory, isBlackBelt, normalizeBelt } from '../../shared/constants/belts';

export interface PickerCompetitor {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  belt: string;
  danRank: number | null;
  weightLbs: number | null;
  schoolDojang: string | null;
  dateOfBirth?: string | null;
}

export interface PickerFilters {
  search: string;
  gender: '' | 'M' | 'F';
  ageMin: string;
  ageMax: string;
  belts: string[]; // simple belt categories, e.g. ["Yellow", "Green"]; empty = all
  weightMin: string;
  weightMax: string;
  school: string; // exact school name; '' = all
}

export const EMPTY_PICKER_FILTERS: PickerFilters = {
  search: '',
  gender: '',
  ageMin: '',
  ageMax: '',
  belts: [],
  weightMin: '',
  weightMax: '',
  school: '',
};

export type PickerSortKey = 'name' | 'age' | 'gender' | 'belt' | 'weight' | 'school';

/** Belt categories in order, for the belt filter chips. */
export const BELT_FILTER_OPTIONS = Object.keys(BELT_CATEGORIES);

/** Whole years old on `onDate` (the tournament day), or null without a valid birth date. */
export function ageOn(dateOfBirth: string | null | undefined, onDate: Date): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  let age = onDate.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = onDate.getUTCMonth() < dob.getUTCMonth()
    || (onDate.getUTCMonth() === dob.getUTCMonth() && onDate.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Sort position of a belt: colour belts by the stripe ladder, then black belts by dan. */
export function beltOrder(belt: string, danRank: number | null): number {
  if (isBlackBelt(normalizeBelt(belt))) return 1000 + (danRank ?? 0);
  const normalized = normalizeBelt(belt).toLowerCase();
  const exact = COLORED_BELTS.findIndex((b) => b.toLowerCase() === normalized);
  if (exact >= 0) return exact;
  const category = BELT_FILTER_OPTIONS.indexOf(getSimpleBeltCategory(belt));
  return category >= 0 ? category * 3 : 999;
}

const toNumber = (value: string): number | null => {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Competitors matching every filter that is set. Unknown age/weight never match an age/weight range. */
export function filterCompetitors<T extends PickerCompetitor>(list: readonly T[], filters: PickerFilters, onDate: Date): T[] {
  const query = filters.search.trim().toLowerCase();
  const ageMin = toNumber(filters.ageMin);
  const ageMax = toNumber(filters.ageMax);
  const weightMin = toNumber(filters.weightMin);
  const weightMax = toNumber(filters.weightMax);
  return list.filter((c) => {
    if (query) {
      const haystack = `${c.firstName} ${c.lastName} ${c.schoolDojang ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filters.gender && c.gender.toUpperCase().charAt(0) !== filters.gender) return false;
    if (ageMin !== null || ageMax !== null) {
      const age = ageOn(c.dateOfBirth, onDate);
      if (age === null) return false;
      if (ageMin !== null && age < ageMin) return false;
      if (ageMax !== null && age > ageMax) return false;
    }
    if (filters.belts.length > 0 && !filters.belts.includes(getSimpleBeltCategory(c.belt))) return false;
    if (weightMin !== null || weightMax !== null) {
      if (c.weightLbs == null) return false;
      if (weightMin !== null && c.weightLbs < weightMin) return false;
      if (weightMax !== null && c.weightLbs > weightMax) return false;
    }
    if (filters.school && (c.schoolDojang ?? '').trim() !== filters.school) return false;
    return true;
  });
}

/** A stable sort; missing values always go last. */
export function sortCompetitors<T extends PickerCompetitor>(
  list: readonly T[],
  key: PickerSortKey,
  direction: 'asc' | 'desc',
  onDate: Date,
): T[] {
  const value = (c: T): string | number | null => {
    switch (key) {
      case 'name': return `${c.lastName} ${c.firstName}`.toLowerCase();
      case 'age': return ageOn(c.dateOfBirth, onDate);
      case 'gender': return c.gender.toUpperCase();
      case 'belt': return beltOrder(c.belt, c.danRank);
      case 'weight': return c.weightLbs;
      case 'school': return c.schoolDojang?.trim().toLowerCase() || null;
    }
  };
  const sign = direction === 'asc' ? 1 : -1;
  return list
    .map((c, index) => ({ c, index, v: value(c) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.index - b.index;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const cmp = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
      return cmp !== 0 ? cmp * sign : a.index - b.index;
    })
    .map(({ c }) => c);
}

/** Distinct school names, alphabetical, for the school filter. */
export function schoolOptions(list: readonly PickerCompetitor[]): string[] {
  return [...new Set(list.map((c) => c.schoolDojang?.trim()).filter((s): s is string => Boolean(s)))]
    .sort((a, b) => a.localeCompare(b));
}
