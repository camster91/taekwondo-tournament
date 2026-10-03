// School names for fairness checks.
//
// Registrations type the school by hand, so one club shows up as
// "Newton's TKD", "newtons tkd" and "Newtons TKD (Markham)". For fairness
// (spreading a school across divisions and brackets, warning when one
// school fills a division) those must count as one school.
//
// Two layers:
//   1. normalizeSchoolName — case, accent, space and punctuation
//      insensitive ("Newton's  T.K.D." -> "newtons tkd").
//   2. Organizer aliases — "Newtons TKD (Markham)" is "Newtons TKD".
//      Stored on Tournament.settings (rules.fairness.schoolAliases).

export interface SchoolAlias {
  /** The name as it appears on registrations, e.g. "Newtons TKD (Markham)". */
  alias: string;
  /** The school it belongs to, e.g. "Newtons TKD". */
  school: string;
}

/**
 * Comparison key for a school name: lower case, accents removed,
 * apostrophes dropped, other punctuation treated as a space, spaces
 * collapsed. Returns '' for a missing or blank name.
 */
export function normalizeSchoolName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’`.]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface SchoolResolver {
  /** Key shared by every spelling and alias of one school ('' = no school). */
  key(name: string | null | undefined): string;
  /** Name to show for that school (the alias target, else the name as typed). */
  label(name: string | null | undefined): string;
}

/**
 * Build a resolver from organizer aliases. Aliases may chain
 * (A -> B, B -> C); a loop stops at the first repeat.
 */
export function createSchoolResolver(aliases: readonly SchoolAlias[] | null | undefined): SchoolResolver {
  const target = new Map<string, { key: string; label: string }>();
  for (const entry of aliases ?? []) {
    const from = normalizeSchoolName(entry?.alias);
    const to = normalizeSchoolName(entry?.school);
    if (!from || !to || from === to) continue;
    target.set(from, { key: to, label: entry.school.trim() });
  }

  const resolve = (name: string | null | undefined): { key: string; label: string } => {
    let key = normalizeSchoolName(name);
    let label = (name ?? '').trim();
    const seen = new Set<string>();
    while (target.has(key) && !seen.has(key)) {
      seen.add(key);
      const next = target.get(key)!;
      key = next.key;
      label = next.label;
    }
    return { key, label };
  };

  return {
    key: (name) => resolve(name).key,
    label: (name) => resolve(name).label,
  };
}

/** Same school after normalisation and aliases? Blank names never match. */
export function isSameSchool(
  a: string | null | undefined,
  b: string | null | undefined,
  resolver: SchoolResolver = createSchoolResolver(null),
): boolean {
  const keyA = resolver.key(a);
  return keyA !== '' && keyA === resolver.key(b);
}

/**
 * The school with the most people in a list, if it holds at least
 * `minShare` (0-1) of them. Blank schools are not counted as a school
 * but do count towards the total.
 */
export function dominantSchool(
  schools: ReadonlyArray<string | null | undefined>,
  minShare: number,
  resolver: SchoolResolver = createSchoolResolver(null),
): { label: string; count: number; total: number } | null {
  const counts = new Map<string, { label: string; count: number }>();
  for (const name of schools) {
    const key = resolver.key(name);
    if (!key) continue;
    const entry = counts.get(key) ?? { label: resolver.label(name), count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  let best: { label: string; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  const total = schools.length;
  if (!best || total === 0 || best.count / total < minShare) return null;
  return { ...best, total };
}
