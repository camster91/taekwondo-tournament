import type { PrismaClient } from '@prisma/client';

export interface TournamentWeightClassInput {
  name: string;
  gender?: string;
  ageMin?: number;
  ageMax?: number;
  weightMinLbs?: number;
  weightMaxLbs?: number;
  displayOrder?: number;
}

export const TOURNAMENT_RULE_KEYS = new Set(['version', 'beltGroups', 'ageBands', 'weights', 'divisions', 'brackets', 'events', 'overrides']);
export const RESERVED_OPERATION_SETTINGS_KEYS = new Set(['canonicalSchedule', 'scheduleOperations']);

export function stripReservedOperationSettings(incoming: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(incoming).filter(([key]) => !RESERVED_OPERATION_SETTINGS_KEYS.has(key)),
  );
}

export function stripReservedOperationSettingsFromRaw(settings: string | null): string | null {
  if (!settings) return null;
  const parsed = parseSettings(settings);
  const safe = stripReservedOperationSettings(parsed);
  return Object.keys(safe).length > 0 ? JSON.stringify(safe) : null;
}

function parseSettings(settings: string | null): Record<string, unknown> {
  if (!settings) return {};
  try {
    const value = JSON.parse(settings);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function mergeSetupSettings(current: string | null, incoming: Record<string, unknown>): Record<string, unknown> {
  const currentSettings = parseSettings(current);
  const setup = Object.fromEntries(Object.entries(stripReservedOperationSettings(incoming)).filter(([key]) => !TOURNAMENT_RULE_KEYS.has(key)));
  const rules = Object.fromEntries(Object.entries(currentSettings).filter(([key]) => TOURNAMENT_RULE_KEYS.has(key)));
  const reserved = Object.fromEntries(Object.entries(currentSettings).filter(([key]) => RESERVED_OPERATION_SETTINGS_KEYS.has(key)));
  return { ...setup, ...rules, ...reserved };
}

export function mergeRulesSettings(current: string | null, rules: Record<string, unknown>): Record<string, unknown> {
  const currentSettings = parseSettings(current);
  const setup = Object.fromEntries(Object.entries(currentSettings).filter(([key]) => !TOURNAMENT_RULE_KEYS.has(key)));
  const ruleSettings = Object.fromEntries(Object.entries(rules).filter(([key]) => TOURNAMENT_RULE_KEYS.has(key)));
  return { ...setup, ...ruleSettings };
}

export function mergeGeneralSettings(current: string | null, incoming: Record<string, unknown>): Record<string, unknown> {
  const currentSettings = parseSettings(current);
  const safeIncoming = stripReservedOperationSettings(incoming);
  const reserved = Object.fromEntries(Object.entries(currentSettings).filter(([key]) => RESERVED_OPERATION_SETTINGS_KEYS.has(key)));
  return { ...currentSettings, ...safeIncoming, ...reserved };
}

export async function saveTournamentSettingsAtomic(
  prisma: PrismaClient,
  tournamentId: string,
  settings: Record<string, unknown>,
  weightClasses: TournamentWeightClassInput[],
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { settings: true } });
    const tournament = await tx.tournament.update({
      where: { id: tournamentId },
      data: { settings: JSON.stringify(mergeSetupSettings(existing.settings, settings)) },
    });
    await tx.weightClass.deleteMany({ where: { tournamentId } });
    await tx.weightClass.createMany({
      data: weightClasses.map((weightClass, index) => ({
        tournamentId,
        name: weightClass.name,
        gender: weightClass.gender || null,
        ageMin: weightClass.ageMin ?? null,
        ageMax: weightClass.ageMax ?? null,
        weightMinLbs: weightClass.weightMinLbs ?? null,
        weightMaxLbs: weightClass.weightMaxLbs ?? null,
        displayOrder: weightClass.displayOrder ?? index,
      })),
    });
    return tournament;
  }, { isolationLevel: 'Serializable' });
}
