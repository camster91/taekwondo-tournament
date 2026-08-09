import { createHash } from 'node:crypto';
import type { ScheduledDivision, TournamentSchedule } from './schedule-generator.js';

export interface CanonicalScheduleRow {
  divisionId: string;
  ring: number;
  startMinutes: number;
  durationMinutes: number;
  locked: boolean;
}

export interface CanonicalScheduleSnapshot {
  version: 1;
  rows: CanonicalScheduleRow[];
}

function parseSettings(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error('Tournament settings require repair before reading the canonical schedule');
  }
}

const assertInteger = (value: unknown, label: string, minimum: number) => {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new Error(`Canonical schedule ${label} is invalid`);
};

function normalize(snapshot: CanonicalScheduleSnapshot): CanonicalScheduleSnapshot {
  if (snapshot.version !== 1) throw new Error('Unsupported canonical schedule version');
  if (!Array.isArray(snapshot.rows)) throw new Error('Canonical schedule rows are invalid');
  const ids = new Set<string>();
  const rows = snapshot.rows.map((row) => {
    if (!row || typeof row !== 'object' || typeof row.divisionId !== 'string' || !row.divisionId.trim()) {
      throw new Error('Canonical schedule division identity is invalid');
    }
    if (ids.has(row.divisionId)) throw new Error('Canonical schedule contains a duplicate division');
    ids.add(row.divisionId);
    assertInteger(row.ring, 'ring', 1);
    assertInteger(row.startMinutes, 'start time', 0);
    assertInteger(row.durationMinutes, 'duration', 1);
    if (typeof row.locked !== 'boolean') throw new Error('Canonical schedule lock state is invalid');
    return { ...row };
  }).sort((a, b) => a.divisionId.localeCompare(b.divisionId));
  return { version: 1, rows };
}

export function readCanonicalSchedule(raw: string | null): CanonicalScheduleSnapshot | null {
  const settings = parseSettings(raw);
  if (settings.canonicalSchedule === undefined) return null;
  const candidate = settings.canonicalSchedule as CanonicalScheduleSnapshot;
  if (!candidate || typeof candidate !== 'object') throw new Error('Canonical schedule is invalid');
  return normalize(candidate);
}

export function mergeCanonicalScheduleSettings(raw: string | null, snapshot: CanonicalScheduleSnapshot): string {
  const settings = parseSettings(raw);
  return JSON.stringify({ ...settings, canonicalSchedule: normalize(snapshot) });
}

export function canonicalScheduleVersion(snapshot: CanonicalScheduleSnapshot): string {
  return createHash('sha256').update(JSON.stringify(normalize(snapshot))).digest('hex');
}

export function assertCanonicalLocksPreserved(
  before: CanonicalScheduleSnapshot,
  after: CanonicalScheduleSnapshot,
): void {
  const prior = normalize(before);
  const next = normalize(after);
  const nextById = new Map(next.rows.map((row) => [row.divisionId, row]));
  for (const row of prior.rows) {
    if (!row.locked) continue;
    const candidate = nextById.get(row.divisionId);
    if (!candidate || candidate.ring !== row.ring || candidate.startMinutes !== row.startMinutes
      || candidate.durationMinutes !== row.durationMinutes || !candidate.locked) {
      throw new Error(`Canonical schedule locked position changed for ${row.divisionId}`);
    }
  }
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function applyCanonicalSchedule(
  generated: ScheduledDivision[],
  snapshot: CanonicalScheduleSnapshot,
): ScheduledDivision[] {
  const canonical = normalize(snapshot);
  const generatedById = new Map(generated.map((row) => [row.divisionId, row]));
  if (generatedById.size !== generated.length || canonical.rows.length !== generated.length
    || canonical.rows.some((row) => !generatedById.has(row.divisionId))) {
    throw new Error('Canonical schedule coverage does not match active divisions');
  }
  return canonical.rows.map((row) => {
    const source = generatedById.get(row.divisionId)!;
    if (source.estimatedDurationMinutes !== row.durationMinutes) {
      throw new Error(`Canonical schedule duration changed for ${source.divisionName}`);
    }
    return {
      ...source,
      ring: row.ring,
      startTime: minutesToTime(row.startMinutes),
      endTime: minutesToTime(row.startMinutes + row.durationMinutes),
    };
  }).sort((a, b) => a.startTime.localeCompare(b.startTime) || a.ring - b.ring || a.divisionId.localeCompare(b.divisionId));
}

export function materializeCanonicalTournamentSchedule(
  generated: TournamentSchedule,
  rawSettings: string | null,
): TournamentSchedule & { canonicalScheduleVersion?: string } {
  const snapshot = readCanonicalSchedule(rawSettings);
  if (!snapshot) return generated;
  return {
    ...generated,
    schedule: applyCanonicalSchedule(generated.schedule, snapshot),
    canonicalScheduleVersion: canonicalScheduleVersion(snapshot),
  };
}
