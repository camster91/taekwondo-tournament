import { Prisma, PrismaClient } from '@prisma/client';
import { getBeltLevel, getSimpleBeltCategory, isBlackBelt } from '../../shared/constants/belts.js';
import { getAgeGroup, DEFAULT_AGE_GROUPS, BB_AGE_GROUPS, type AgeGroup } from '../../shared/constants/age-groups.js';
import { findWeightClass, DEFAULT_WEIGHT_CLASSES } from '../../shared/constants/weight-classes.js';
import {
  DIVISION_SIZE_CONFIG,
  AGE_BOUNDARY_CONFIG,
  getInitialSkillEstimate,
} from '../../shared/constants/fairness-config.js';
import {
  type TournamentRules,
  DEFAULT_TOURNAMENT_RULES,
  getBeltGroup,
  getEffectiveAgeBand,
  getWeightClasses,
} from '../../shared/constants/tournament-rules.js';
import { createSchoolResolver, dominantSchool, type SchoolResolver } from '../../shared/utils/school.js';

export interface CategorizationConfig {
  divisionThreshold: number;
  useBlackBeltAgeGroups?: boolean;
  customAgeGroups?: AgeGroup[];
  // Sport-aware event type labels (e.g. {patterns: 'Kata', sparring: 'Kumite'} for Karate)
  eventTypeLabels?: { patterns: string; sparring: string };
  // Custom weight classes from the DB (overrides DEFAULT_WEIGHT_CLASSES when present)
  customWeightClasses?: Array<{ name: string; gender: string | null; ageMin: number | null; ageMax: number | null; weightMinLbs: number | null; weightMaxLbs: number | null }>;
  // Enhanced options for smart categorization
  enableSmartSplitting?: boolean;      // Balance skill when splitting divisions
  enableSmartMerging?: boolean;        // Merge small adjacent divisions
  enableAgeBoundaryFlex?: boolean;     // Allow age boundary flexibility
  ageBoundaryTolerance?: number;       // Months tolerance at boundaries
  preferWeightProximity?: boolean;     // Optimize weight matching in sparring
  balanceByExperience?: boolean;       // Consider experience in splits
  // v2: full tournament rules (overrides the individual flags when present)
  rules?: TournamentRules;
  // Tournament date; with each competitor's dateOfBirth it gives the
  // exact age in months used by the "compete with older" allowance.
  tournamentDate?: Date | string;
  // Smallest division smart merging tries to avoid (the rules'
  // minDivisionSize). Falls back to rules, then DIVISION_SIZE_CONFIG.
  minDivisionSize?: number;
  // Event type of each division a registration is pinned to
  // (manualDivisionId -> eventType). A pinned registration is excluded
  // only from that event; an unknown pin excludes it from both.
  pinnedDivisionEventTypes?: Record<string, string>;
  // Events each registration already holds through an assignment in a
  // kept (pinned) division (registrationId -> eventTypes). Kept divisions
  // keep all their members, so those events are not categorized again.
  heldPinnedEvents?: Record<string, string[]>;
}

// Source-internal type. Mirrors `Registration & { competitor: Competitor }` from
// Prisma, but we declare it explicitly so tests can construct
// fixtures without depending on the Prisma client.
export interface RegistrationWithCompetitor {
  id: string;
  competitorId: string;
  patterns: boolean;
  sparring: boolean;
  ageAtTournament: number | null;
  weightAtRegistration: number | null;
  heightAtRegistration?: number | null;
  manualDivisionId: string | null;
  competeWithOlder?: boolean;
  competitor: {
    firstName: string;
    lastName: string;
    belt: string;
    beltColor?: string | null;
    gender: string;
    schoolDojang?: string | null;
    weightLbs?: number | null;
    heightInches?: number | null;
    danRank?: number | null;
    dateOfBirth?: Date | string | null;
  };
}

export interface DivisionGroup {
  key: string;
  name: string;
  beltLevel: 'BB' | 'CB';
  gender: 'M' | 'F';
  eventType: 'patterns' | 'sparring';
  ageMin: number;
  ageMax: number;
  beltColors: string[];
  danMin?: number;
  danMax?: number;
  weightClass?: string;
  registrations: RegistrationWithCompetitor[];
}

export interface CategorizationResult {
  divisions: number;
  assignments: number;
  warnings: string[];
}

export interface PreviewDivision {
  name: string;
  beltLevel: string;
  gender: string;
  eventType: string;
  ageMin: number;
  ageMax: number;
  weightClass: string | null;
  competitorCount: number;
  competitors: { registrationId: string; name: string; school: string }[];
}

export interface PreviewResult {
  divisions: PreviewDivision[];
  totalCompetitors: number;
  warnings: string[];
}

/**
 * Registrations that reached categorization but fit no division,
 * collected across both events so each is counted once.
 */
interface DroppedRegistrations {
  noGender: Set<string>;
  noAgeBand: Set<string>;
  noDanGroup: Set<string>;
}

function createDroppedCollector(): DroppedRegistrations {
  return { noGender: new Set(), noAgeBand: new Set(), noDanGroup: new Set() };
}

function droppedWarnings(dropped: DroppedRegistrations): string[] {
  const warnings: string[] = [];
  if (dropped.noGender.size > 0) {
    warnings.push(`${dropped.noGender.size} registration(s) were not categorized: gender is not male or female.`);
  }
  if (dropped.noAgeBand.size > 0) {
    warnings.push(`${dropped.noAgeBand.size} registration(s) fit no age band and were not categorized.`);
  }
  if (dropped.noDanGroup.size > 0) {
    warnings.push(`${dropped.noDanGroup.size} black belt registration(s) have a dan rank outside every dan group and were not categorized.`);
  }
  return warnings;
}

/**
 * Remove each pinned registration from the event of the division it is
 * pinned to, keeping it in its other event. A pin whose division event
 * is unknown excludes the registration entirely (the old behaviour).
 */
export function excludePinnedEvents(
  registrations: RegistrationWithCompetitor[],
  pinnedDivisionEventTypes: Record<string, string> | undefined,
  heldPinnedEvents?: Record<string, string[]>,
): { registrations: RegistrationWithCompetitor[]; pinnedCount: number } {
  const result: RegistrationWithCompetitor[] = [];
  let pinnedCount = 0;
  for (const registration of registrations) {
    const held = new Set(heldPinnedEvents?.[registration.id] ?? []);
    if (registration.manualDivisionId) {
      pinnedCount++;
      const pinnedEvent = pinnedDivisionEventTypes?.[registration.manualDivisionId];
      if (pinnedEvent !== 'patterns' && pinnedEvent !== 'sparring') continue;
      held.add(pinnedEvent);
    }
    if (held.size === 0) {
      result.push(registration);
      continue;
    }
    const remaining = {
      ...registration,
      patterns: registration.patterns && !held.has('patterns'),
      sparring: registration.sparring && !held.has('sparring'),
    };
    if (remaining.patterns || remaining.sparring) result.push(remaining);
  }
  return { registrations: result, pinnedCount };
}

/** registrationId -> event types held via assignments in the given divisions. */
export async function loadHeldPinnedEvents(
  prisma: PrismaClient | Prisma.TransactionClient,
  pinnedDivisionIds: string[],
): Promise<Record<string, string[]>> {
  if (pinnedDivisionIds.length === 0) return {};
  const assignments = await prisma.divisionAssignment.findMany({
    where: { divisionId: { in: pinnedDivisionIds } },
    select: { registrationId: true, division: { select: { eventType: true } } },
  });
  const held: Record<string, string[]> = {};
  for (const { registrationId, division } of assignments) {
    (held[registrationId] ??= []).push(division.eventType);
  }
  return held;
}

function partitionRegistrationsForCategorization(
  registrations: RegistrationWithCompetitor[]
): {
  patternsRegs: RegistrationWithCompetitor[];
  sparringRegs: RegistrationWithCompetitor[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const ageReady = registrations.filter((registration) => registration.ageAtTournament != null);
  const missingAgeCount = registrations.length - ageReady.length;

  if (missingAgeCount > 0) {
    warnings.push(
      `${missingAgeCount} registration(s) need review before auto-categorization: missing tournament age.`
    );
  }

  const missingWeightCount = ageReady.filter(
    (registration) =>
      registration.sparring &&
      registration.weightAtRegistration == null &&
      registration.competitor.weightLbs == null
  ).length;

  if (missingWeightCount > 0) {
    warnings.push(
      `${missingWeightCount} sparring registration(s) need review before auto-categorization: missing weight.`
    );
  }

  return {
    patternsRegs: ageReady.filter((registration) => registration.patterns),
    sparringRegs: ageReady.filter(
      (registration) =>
        registration.sparring &&
        (registration.weightAtRegistration != null || registration.competitor.weightLbs != null)
    ),
    warnings,
  };
}

export function previewCategorization(
  registrations: RegistrationWithCompetitor[],
  config: CategorizationConfig
): PreviewResult {
  const warnings: string[] = [];

  // v2: a registration manually pinned to a specific division is
  // managed via the move endpoint for that division's event; it is
  // still auto-categorized for its other event.
  const { registrations: unpinned, pinnedCount } = excludePinnedEvents(
    registrations,
    config.pinnedDivisionEventTypes,
    config.heldPinnedEvents,
  );
  if (pinnedCount > 0) {
    warnings.push(`${pinnedCount} registration(s) are pinned to specific divisions; their pinned event will be excluded from auto-categorization. Run "Restore pinned" to re-include them.`);
  }

  const partitioned = partitionRegistrationsForCategorization(unpinned);
  const { patternsRegs, sparringRegs } = partitioned;
  warnings.push(...partitioned.warnings);

  const allGroups: DivisionGroup[] = [];
  const dropped = createDroppedCollector();

  // Process patterns registrations
  const patternsGroups = categorizeByEvent(patternsRegs, 'patterns', config, dropped);
  allGroups.push(...patternsGroups);

  // Process sparring registrations (includes weight class)
  const sparringGroups = categorizeByEvent(sparringRegs, 'sparring', config, dropped);
  allGroups.push(...sparringGroups);
  warnings.push(...droppedWarnings(dropped));

  // Split large divisions
  let finalGroups: DivisionGroup[] = [];
  for (const group of allGroups) {
    if (group.registrations.length > config.divisionThreshold) {
      const splits = splitDivision(group, config.divisionThreshold, config);
      finalGroups.push(...splits);
      const splitMethod = config.enableSmartSplitting ? 'skill-balanced' : 'standard';
      warnings.push(`"${group.name}" will be split into ${splits.length} divisions (${group.registrations.length} competitors, ${splitMethod})`);
    } else {
      finalGroups.push(group);
    }
  }

  // Merge small divisions if enabled
  if (config.enableSmartMerging) {
    const beforeCount = finalGroups.length;
    finalGroups = smartMergeDivisions(finalGroups, config, warnings);
    const mergedCount = beforeCount - finalGroups.length;
    if (mergedCount > 0) {
      warnings.push(`Merged ${mergedCount} small adjacent divisions`);
    }
  }

  const schools = schoolResolverFor(config);

  // Convert to preview format
  const divisions: PreviewDivision[] = finalGroups
    .filter((g) => g.registrations.length > 0)
    .map((group) => {
      // Collect any validation warnings (large age spread,
      // large weight spread, etc.) — these don't fail the preview,
      // just surface as warnings.
      const warningsForGroup = [...validateGroup(group), ...fairnessWarnings(group, config, schools)];
      if (warningsForGroup.length > 0) {
        warnings.push(...warningsForGroup.map((w) => `${group.name}: ${w}`));
      }

      if (group.registrations.length < 3) {
        warnings.push(`"${group.name}" has only ${group.registrations.length} competitor(s) - consider merging`);
      }

      return {
        name: group.name,
        beltLevel: group.beltLevel,
        gender: group.gender,
        eventType: group.eventType,
        ageMin: group.ageMin,
        ageMax: group.ageMax,
        weightClass: group.weightClass || null,
        competitorCount: group.registrations.length,
        competitors: group.registrations.map((r) => ({
          registrationId: r.id,
          name: `${r.competitor.firstName} ${r.competitor.lastName}`,
          school: r.competitor.schoolDojang || '',
        })),
      };
    });

  // Count total unique competitors
  const competitorIds = new Set<string>();
  for (const group of finalGroups) {
    for (const reg of group.registrations) {
      competitorIds.add(reg.competitorId);
    }
  }

  return {
    divisions,
    totalCompetitors: competitorIds.size,
    warnings,
  };
}

export async function autoCategorize(
  prisma: PrismaClient | Prisma.TransactionClient,
  tournamentId: string,
  registrations: RegistrationWithCompetitor[],
  config: CategorizationConfig
): Promise<CategorizationResult> {
  const warnings: string[] = [];

  // v2: a registration pinned to a specific division is excluded from
  // that division's event only. Pinned divisions are kept as-is.
  const pinnedDivisionIds = Array.from(
    new Set(
      registrations
        .map((registration) => registration.manualDivisionId)
        .filter((divisionId): divisionId is string => Boolean(divisionId))
    )
  );
  let pinnedDivisionEventTypes = config.pinnedDivisionEventTypes;
  if (!pinnedDivisionEventTypes && pinnedDivisionIds.length > 0) {
    const pinnedDivisions = await prisma.division.findMany({
      where: { tournamentId, id: { in: pinnedDivisionIds } },
      select: { id: true, eventType: true },
    });
    pinnedDivisionEventTypes = Object.fromEntries(
      pinnedDivisions.map((division) => [division.id, division.eventType])
    );
  }
  const heldPinnedEvents = config.heldPinnedEvents ?? await loadHeldPinnedEvents(prisma, pinnedDivisionIds);
  const { registrations: unpinned, pinnedCount } = excludePinnedEvents(
    registrations,
    pinnedDivisionEventTypes,
    heldPinnedEvents,
  );
  if (pinnedCount > 0) {
    warnings.push(`${pinnedCount} registration(s) are pinned to specific divisions; their pinned event was excluded from auto-categorization.`);
  }

  const partitioned = partitionRegistrationsForCategorization(unpinned);
  const { patternsRegs, sparringRegs } = partitioned;
  warnings.push(...partitioned.warnings);

  const allGroups: DivisionGroup[] = [];
  const dropped = createDroppedCollector();

  // Process patterns registrations
  const patternsGroups = categorizeByEvent(patternsRegs, 'patterns', config, dropped);
  allGroups.push(...patternsGroups);

  // Process sparring registrations (includes weight class)
  const sparringGroups = categorizeByEvent(sparringRegs, 'sparring', config, dropped);
  allGroups.push(...sparringGroups);
  warnings.push(...droppedWarnings(dropped));

  // Split large divisions
  let finalGroups: DivisionGroup[] = [];
  for (const group of allGroups) {
    if (group.registrations.length > config.divisionThreshold) {
      const splits = splitDivision(group, config.divisionThreshold, config);
      finalGroups.push(...splits);
    } else {
      finalGroups.push(group);
    }
  }

  // Merge small divisions if enabled
  if (config.enableSmartMerging) {
    finalGroups = smartMergeDivisions(finalGroups, config, warnings);
  }
  const schools = schoolResolverFor(config);

  // Wrap all DB mutations in a transaction
  let divisionCount = 0;
  let assignmentCount = 0;

  const applyChanges = async (tx: Prisma.TransactionClient) => {
    // Clear existing divisions and assignments
    await tx.division.deleteMany({
      where: {
        tournamentId,
        ...(pinnedDivisionIds.length > 0
          ? { id: { notIn: pinnedDivisionIds } }
          : {}),
      },
    });

    // Create divisions and assignments
    let displayOrder = 0;

    for (const group of finalGroups) {
      if (group.registrations.length === 0) continue;

      // Collect validation warnings (large spreads, etc.) — these
      // don't fail the auto-categorize, just surface as warnings.
      const warningsForGroup = [...validateGroup(group), ...fairnessWarnings(group, config, schools)];
      if (warningsForGroup.length > 0) {
        warnings.push(...warningsForGroup.map((w) => `${group.name}: ${w}`));
      }

      const division = await tx.division.create({
        data: {
          tournamentId,
          name: group.name,
          beltLevel: group.beltLevel,
          gender: group.gender,
          eventType: group.eventType,
          ageMin: group.ageMin,
          ageMax: group.ageMax,
          beltColors: JSON.stringify(group.beltColors),
          danMin: group.danMin,
          danMax: group.danMax,
          weightClass: group.weightClass,
          divisionNumber: 1,
          displayOrder: displayOrder++,
        },
      });

      // Create assignments in bulk
      const assignmentData = group.registrations.map((reg, i) => ({
        divisionId: division.id,
        registrationId: reg.id,
        seedPosition: i + 1,
      }));

      await tx.divisionAssignment.createMany({ data: assignmentData });
      assignmentCount += assignmentData.length;

      divisionCount++;
    }
  };

  if ('$transaction' in prisma) {
    await prisma.$transaction(applyChanges);
  } else {
    await applyChanges(prisma);
  }

  return {
    divisions: divisionCount,
    assignments: assignmentCount,
    warnings,
  };
}

function categorizeByEvent(
  registrations: RegistrationWithCompetitor[],
  eventType: 'patterns' | 'sparring',
  config: CategorizationConfig,
  dropped: DroppedRegistrations = createDroppedCollector()
): DivisionGroup[] {
  const groups: DivisionGroup[] = [];

  // First split by belt level (BB vs CB)
  const bbRegs = registrations.filter((r) => isBlackBelt(r.competitor.belt));
  const cbRegs = registrations.filter((r) => !isBlackBelt(r.competitor.belt));

  // Process Black Belt
  if (bbRegs.length > 0) {
    const bbGroups = categorizeBeltLevel(bbRegs, 'BB', eventType, config, config.eventTypeLabels, dropped);
    groups.push(...bbGroups);
  }

  // Process Colored Belt
  if (cbRegs.length > 0) {
    const cbGroups = categorizeBeltLevel(cbRegs, 'CB', eventType, config, config.eventTypeLabels, dropped);
    groups.push(...cbGroups);
  }

  return groups;
}

function categorizeBeltLevel(
  registrations: RegistrationWithCompetitor[],
  beltLevel: 'BB' | 'CB',
  eventType: 'patterns' | 'sparring',
  config: CategorizationConfig,
  eventTypeLabels: { patterns: string; sparring: string } | undefined,
  dropped: DroppedRegistrations
): DivisionGroup[] {
  const groups: DivisionGroup[] = [];
  const rules = config.rules ?? DEFAULT_TOURNAMENT_RULES;

  // Split by gender (support both 'M'/'F' and 'male'/'female' formats)
  const males = registrations.filter((r) => r.competitor.gender === 'male' || r.competitor.gender === 'M');
  const females = registrations.filter((r) => r.competitor.gender === 'female' || r.competitor.gender === 'F');
  for (const registration of registrations) {
    if (!males.includes(registration) && !females.includes(registration)) {
      dropped.noGender.add(registration.id);
    }
  }

  for (const [gender, genderRegs] of [
    ['M', males],
    ['F', females],
  ] as const) {
    if (genderRegs.length === 0) continue;

    // Determine age bands: black-belt bands (BB only) > custom >
    // rules > useBlackBeltAgeGroups flag > DEFAULT
    const ageGroups: AgeGroup[] = (() => {
      const blackBeltBands = config.rules?.ageBands.blackBeltBands;
      if (beltLevel === 'BB' && blackBeltBands && blackBeltBands.length > 0) return blackBeltBands;
      if (config.customAgeGroups) return config.customAgeGroups;
      if (config.rules) {
        return rules.ageBands.customBands ?? (rules.ageBands.preset === 'blackBelt' ? BB_AGE_GROUPS : DEFAULT_AGE_GROUPS);
      }
      return config.useBlackBeltAgeGroups ? BB_AGE_GROUPS : DEFAULT_AGE_GROUPS;
    })();

    // Every competitor lands in exactly one band (see resolveAgeBand).
    const bandByRegistration = new Map(
      genderRegs.map((r) => [r.id, resolveAgeBand(r, ageGroups, config)] as const)
    );
    for (const [registrationId, band] of bandByRegistration) {
      if (!band) dropped.noAgeBand.add(registrationId);
    }

    for (const ageGroup of ageGroups) {
      const ageRegs = genderRegs.filter((r) => bandByRegistration.get(r.id) === ageGroup);

      if (ageRegs.length === 0) continue;

      if (beltLevel === 'BB') {
        // For BB, split by dan rank for patterns
        if (eventType === 'patterns') {
          const danGroups = groupByDanRank(ageRegs, dropped);
          for (const danGroup of danGroups) {
            groups.push(
              createDivisionGroup(
                danGroup.registrations,
                beltLevel,
                gender,
                eventType,
                ageGroup,
                ['Black'],
                danGroup.danMin,
                danGroup.danMax,
                undefined,
                eventTypeLabels
              )
            );
          }
        } else {
          // Sparring - split by weight class
          const weightGroups = weightGroupsFor(ageRegs, gender, ageGroup, config);
          for (const weightGroup of weightGroups) {
            groups.push(
              createDivisionGroup(
                weightGroup.registrations,
                beltLevel,
                gender,
                eventType,
                ageGroup,
                ['Black'],
                undefined,
                undefined,
                weightGroup.weightClass,
                eventTypeLabels
              )
            );
          }
        }
      } else {
        // For CB, group by belt color
        if (eventType === 'patterns') {
          const beltGroups = groupByBeltColor(ageRegs);
          for (const beltGroup of beltGroups) {
            groups.push(
              createDivisionGroup(
                beltGroup.registrations,
                beltLevel,
                gender,
                eventType,
                ageGroup,
                beltGroup.belts,
                undefined,
                undefined,
                undefined,
                eventTypeLabels
              )
            );
          }
        } else {
          // Sparring - first group by belt, then by weight
          const beltGroups = groupByBeltColor(ageRegs);
          for (const beltGroup of beltGroups) {
            const weightGroups = weightGroupsFor(beltGroup.registrations, gender, ageGroup, config);
            for (const weightGroup of weightGroups) {
              groups.push(
                createDivisionGroup(
                  weightGroup.registrations,
                  beltLevel,
                  gender,
                  eventType,
                  ageGroup,
                  beltGroup.belts,
                  undefined,
                  undefined,
                  weightGroup.weightClass,
                  eventTypeLabels
                )
              );
            }
          }
        }
      }
    }
  }

  return groups;
}

/**
 * Whole months between date of birth and the tournament date.
 * Returns null when either date is missing or unparseable.
 */
export function ageInMonthsAt(
  dateOfBirth: Date | string | null | undefined,
  tournamentDate: Date | string | null | undefined,
): number | null {
  if (!dateOfBirth || !tournamentDate) return null;
  const birth = new Date(dateOfBirth);
  const on = new Date(tournamentDate);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(on.getTime())) return null;
  let months = (on.getFullYear() - birth.getFullYear()) * 12 + (on.getMonth() - birth.getMonth());
  if (on.getDate() < birth.getDate()) months -= 1;
  return months;
}

/**
 * The single age band a registration competes in.
 *
 * Normally the band containing `ageAtTournament`. With the "compete with
 * older" opt-in and an `ageBoundaryTolerance` of N months, a competitor
 * who will reach the next band's minimum age within N months of the
 * tournament is moved up into that band instead (never into two bands).
 * The exact age in months comes from the date of birth at the tournament
 * date; without those, the stored whole-year age is used (i.e. the
 * competitor is treated as having just had their birthday).
 */
export function resolveAgeBand(
  registration: RegistrationWithCompetitor,
  ageGroups: AgeGroup[],
  config: Pick<CategorizationConfig, 'enableAgeBoundaryFlex' | 'ageBoundaryTolerance' | 'tournamentDate'>,
): AgeGroup | null {
  const age = registration.ageAtTournament || 0;
  const standard = ageGroups.find((group) => age >= group.min && age <= group.max) ?? null;

  const toleranceMonths = config.ageBoundaryTolerance ?? 0;
  if (!registration.competeWithOlder || config.enableAgeBoundaryFlex === false || toleranceMonths <= 0) {
    return standard;
  }
  const months = ageInMonthsAt(registration.competitor.dateOfBirth, config.tournamentDate) ?? age * 12;
  const flexedAge = Math.floor((months + toleranceMonths) / 12);
  const promoted = ageGroups.find((group) => flexedAge >= group.min && flexedAge <= group.max) ?? null;
  // Only ever move up; a gap in custom bands keeps the standard band.
  if (promoted && (!standard || promoted.min > standard.min)) return promoted;
  return standard;
}

export function groupByDanRank(
  registrations: RegistrationWithCompetitor[],
  dropped: DroppedRegistrations = createDroppedCollector()
): Array<{ danMin: number; danMax: number; registrations: RegistrationWithCompetitor[] }> {
  const groups: Array<{ danMin: number; danMax: number; registrations: RegistrationWithCompetitor[] }> = [];
  const danOf = (r: RegistrationWithCompetitor) => r.competitor.danRank || 1;

  // Common dan groupings. The top group is open-ended so 7th dan and
  // above (competitors allow up to 10) are not silently dropped; it is
  // still labelled "4th-6th" unless a higher dan is actually present.
  const danGroupings: Array<{ min: number; max: number; labelMax?: number }> = [
    { min: 1, max: 2 },
    { min: 3, max: 3 },
    { min: 4, max: Number.POSITIVE_INFINITY, labelMax: 6 },
  ];

  for (const danGroup of danGroupings) {
    const regs = registrations.filter((r) => {
      const dan = danOf(r);
      return dan >= danGroup.min && dan <= danGroup.max;
    });

    if (regs.length > 0) {
      groups.push({
        danMin: danGroup.min,
        danMax: Number.isFinite(danGroup.max)
          ? danGroup.max
          : Math.max(danGroup.labelMax ?? danGroup.min, ...regs.map(danOf)),
        registrations: regs,
      });
    }
  }

  for (const registration of registrations) {
    if (!groups.some((group) => group.registrations.includes(registration))) {
      dropped.noDanGroup.add(registration.id);
    }
  }

  return groups;
}

function groupByBeltColor(
  registrations: RegistrationWithCompetitor[]
): Array<{ belts: string[]; registrations: RegistrationWithCompetitor[] }> {
  const groups: Array<{ belts: string[]; registrations: RegistrationWithCompetitor[] }> = [];

  // Group by simplified belt category
  const beltMap = new Map<string, RegistrationWithCompetitor[]>();

  for (const reg of registrations) {
    const category = getSimpleBeltCategory(reg.competitor.belt);
    if (!beltMap.has(category)) {
      beltMap.set(category, []);
    }
    beltMap.get(category)!.push(reg);
  }

  // Combine small groups (less than 3 competitors)
  const entries = Array.from(beltMap.entries());
  const combined: Array<{ belts: string[]; registrations: RegistrationWithCompetitor[] }> = [];

  let pending: { belts: string[]; registrations: RegistrationWithCompetitor[] } | null = null;

  for (const [belt, regs] of entries) {
    if (regs.length < 3 && pending) {
      // Combine with pending
      pending.belts.push(belt);
      pending.registrations.push(...regs);
    } else if (regs.length < 3) {
      // Start new pending group
      pending = { belts: [belt], registrations: [...regs] };
    } else {
      // Push pending if exists
      if (pending) {
        if (pending.registrations.length >= 2) {
          combined.push(pending);
        } else {
          // Add to current group
          combined.push({
            belts: [...pending.belts, belt],
            registrations: [...pending.registrations, ...regs],
          });
          pending = null;
          continue;
        }
        pending = null;
      }
      combined.push({ belts: [belt], registrations: regs });
    }
  }

  if (pending && pending.registrations.length > 0) {
    combined.push(pending);
  }

  return combined;
}

function groupByWeightClass(
  registrations: RegistrationWithCompetitor[],
  gender: 'M' | 'F',
  ageGroup: AgeGroup,
  customWeightClasses?: CategorizationConfig['customWeightClasses']
): Array<{ weightClass: string; registrations: RegistrationWithCompetitor[] }> {
  const groups = new Map<string, RegistrationWithCompetitor[]>();

  // Convert DB weight class format to WeightClassConfig format if custom classes provided
  const weightClassConfig = customWeightClasses && customWeightClasses.length > 0
    ? customWeightClasses.map(wc => ({
        name: wc.name,
        gender: (wc.gender as 'M' | 'F' | null) || null,
        ageMin: wc.ageMin ?? 0,
        ageMax: wc.ageMax ?? 99,
        weightMinLbs: wc.weightMinLbs ?? 0,
        weightMaxLbs: wc.weightMaxLbs ?? 999,
      }))
    : undefined;

  // A wide age band (e.g. Black Belt "11 and Under") spans several
  // weight tables, and every table reuses names like "Light". Grouping
  // by name alone put a 6-year-old at 66 lb and an 11-year-old at
  // 140 lb in one "Heavy" division, so the key includes the table's
  // age range. The lookup age is clamped into the band so a competitor
  // promoted via "compete with older" uses the band's table.
  const tables = new Map<string, { name: string; ageMin: number; ageMax: number }>();
  for (const reg of registrations) {
    const weight = reg.weightAtRegistration || reg.competitor.weightLbs || 0;
    const age = Math.min(Math.max(reg.ageAtTournament || 0, ageGroup.min), ageGroup.max);
    const weightClass = findWeightClass(weight, age, gender, weightClassConfig);
    const key = weightClass ? `${weightClass.name}|${weightClass.ageMin}-${weightClass.ageMax}` : 'Unassigned';
    if (weightClass) tables.set(key, weightClass);

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(reg);
  }

  // Keep the plain class name when the band uses one weight table (the
  // usual case); qualify it with the table's ages only when the band
  // spans several tables, so the division names stay distinct.
  const tableRanges = new Set(Array.from(tables.values()).map((wc) => `${wc.ageMin}-${wc.ageMax}`));
  return Array.from(groups.entries()).map(([key, regs]) => {
    const table = tables.get(key);
    const label = !table
      ? 'Unassigned'
      : tableRanges.size > 1
        ? `${table.name} (${table.ageMax >= 99 ? `${table.ageMin}+` : `${table.ageMin}-${table.ageMax}`})`
        : table.name;
    return { weightClass: label, registrations: regs };
  });
}

function createDivisionGroup(
  registrations: RegistrationWithCompetitor[],
  beltLevel: 'BB' | 'CB',
  gender: 'M' | 'F',
  eventType: 'patterns' | 'sparring',
  ageGroup: AgeGroup,
  beltColors: string[],
  danMin?: number,
  danMax?: number,
  weightClass?: string,
  eventTypeLabels?: { patterns: string; sparring: string }
): DivisionGroup {
  // Generate name
  const genderName = gender === 'M' ? 'Males' : 'Females';
  const eventName = eventTypeLabels?.[eventType] ?? (eventType === 'patterns' ? 'Patterns' : 'Sparring');

  let beltPart = '';
  if (beltLevel === 'BB') {
    if (danMin !== undefined && danMax !== undefined) {
      if (danMin === danMax) {
        beltPart = `BB ${formatDan(danMin)} Dan`;
      } else {
        beltPart = `BB ${formatDan(danMin)}-${formatDan(danMax)} Dan`;
      }
    } else {
      beltPart = 'BB';
    }
  } else {
    if (beltColors.length === 1) {
      beltPart = `CB-All ${beltColors[0]} Belts`;
    } else {
      beltPart = `CB-All ${beltColors.join('/')} Belts`;
    }
  }

  let name = `${ageGroup.label} ${beltPart} ${genderName} ${eventName}`;
  if (weightClass) {
    name += ` ${weightClass}`;
  }

  return {
    key: `${beltLevel}-${gender}-${eventType}-${ageGroup.label}-${beltColors.join(',')}-${danMin || ''}-${danMax || ''}-${weightClass || ''}`,
    name,
    beltLevel,
    gender,
    eventType,
    ageMin: ageGroup.min,
    ageMax: ageGroup.max,
    beltColors,
    danMin,
    danMax,
    weightClass,
    registrations,
  };
}

function formatDan(dan: number): string {
  if (dan === 1) return '1st';
  if (dan === 2) return '2nd';
  if (dan === 3) return '3rd';
  return `${dan}th`;
}

function splitDivision(
  group: DivisionGroup,
  threshold: number,
  config?: CategorizationConfig
): DivisionGroup[] {
  const count = group.registrations.length;
  // A non-positive threshold would make numDivisions negative or infinite.
  if (!(threshold >= 1) || count === 0) return [group];
  const numDivisions = Math.ceil(count / threshold);
  const perDivision = Math.ceil(count / numDivisions);

  // Opt-in: keep people who are alike together (weight / age / belt).
  if (config?.rules?.fairness?.splitBySimilarity) {
    return similarSplitDivision(group, numDivisions, config);
  }

  // Use smart splitting if enabled
  if (config?.enableSmartSplitting) {
    return smartSplitDivision(group, numDivisions, perDivision, config);
  }

  // Default: Sort by school to distribute evenly. Spellings of one
  // school ("Newtons TKD" / "newtons tkd") and organizer aliases count
  // as the same school.
  const resolver = schoolResolverFor(config);
  const schoolOf = (reg: RegistrationWithCompetitor) => resolver.key(reg.competitor.schoolDojang) || 'Unknown';
  const sorted = [...group.registrations].sort((a, b) => schoolOf(a).localeCompare(schoolOf(b)));

  // Interleave by school
  const schools = new Map<string, RegistrationWithCompetitor[]>();
  for (const reg of sorted) {
    const school = schoolOf(reg);
    if (!schools.has(school)) {
      schools.set(school, []);
    }
    schools.get(school)!.push(reg);
  }

  const interleaved: RegistrationWithCompetitor[] = [];
  const schoolArrays = Array.from(schools.values());
  let maxLen = Math.max(...schoolArrays.map((s) => s.length));

  for (let i = 0; i < maxLen; i++) {
    for (const arr of schoolArrays) {
      if (i < arr.length) {
        interleaved.push(arr[i]);
      }
    }
  }

  // Split into divisions
  const divisions: DivisionGroup[] = [];
  for (let i = 0; i < numDivisions; i++) {
    const start = i * perDivision;
    const end = Math.min(start + perDivision, count);
    const divRegs = interleaved.slice(start, end);

    if (divRegs.length > 0) {
      divisions.push({
        ...group,
        key: `${group.key}-DIV${i + 1}`,
        name: `${group.name} DIV${i + 1}`,
        registrations: divRegs,
      });
    }
  }

  return divisions;
}

/**
 * Smart division splitting that balances skill across divisions
 * while maintaining school diversity
 */
function smartSplitDivision(
  group: DivisionGroup,
  numDivisions: number,
  perDivision: number,
  config: CategorizationConfig
): DivisionGroup[] {
  const eventType = group.eventType as 'patterns' | 'sparring';
  const resolver = schoolResolverFor(config);

  // Calculate estimated skill for each competitor
  const withSkill = group.registrations.map((reg) => ({
    reg,
    skill: getInitialSkillEstimate(
      reg.competitor.belt,
      reg.competitor.danRank ?? null,
      eventType
    ),
    school: resolver.key(reg.competitor.schoolDojang) || 'Unknown',
  }));

  // Sort by skill descending
  withSkill.sort((a, b) => b.skill - a.skill);

  // Initialize divisions with target sizes
  const divisions: Array<{
    registrations: RegistrationWithCompetitor[];
    totalSkill: number;
    schools: Set<string>;
  }> = [];

  for (let i = 0; i < numDivisions; i++) {
    divisions.push({ registrations: [], totalSkill: 0, schools: new Set() });
  }

  // Distribute competitors using snake draft pattern
  // This naturally balances skill: best goes to div 1, second best to div 2, etc.
  // Then reverse: next goes to div N, then div N-1, etc.
  let divIndex = 0;
  let direction = 1;

  for (const { reg, skill, school } of withSkill) {
    // Find the division with:
    // 1. Lowest skill sum (to balance)
    // 2. Fewest same-school competitors (to diversify)
    // 3. Below target size (to fill evenly)

    let bestDiv = divIndex;
    let bestScore = -Infinity;

    for (let i = 0; i < numDivisions; i++) {
      const div = divisions[i];
      if (div.registrations.length >= perDivision) continue;

      // Score based on:
      // - Lower current skill = better (want to balance)
      // - Fewer same school = better
      // - Prefer snake order
      const avgSkill = div.registrations.length > 0
        ? div.totalSkill / div.registrations.length
        : 0;
      const sameSchoolCount = div.schools.has(school)
        ? div.registrations.filter(r => (resolver.key(r.competitor.schoolDojang) || 'Unknown') === school).length
        : 0;

      const skillBalance = 1000 - avgSkill; // Lower avg = higher score
      const schoolPenalty = sameSchoolCount * 50; // Penalty for same school
      const orderBonus = i === divIndex ? 10 : 0; // Small bonus for snake order

      const score = skillBalance - schoolPenalty + orderBonus;

      if (score > bestScore && div.registrations.length < perDivision) {
        bestScore = score;
        bestDiv = i;
      }
    }

    // Add to best division
    divisions[bestDiv].registrations.push(reg);
    divisions[bestDiv].totalSkill += skill;
    divisions[bestDiv].schools.add(school);

    // Move in snake pattern
    divIndex += direction;
    if (divIndex >= numDivisions) {
      divIndex = numDivisions - 1;
      direction = -1;
    } else if (divIndex < 0) {
      divIndex = 0;
      direction = 1;
    }
  }

  // Convert to DivisionGroup format
  return divisions
    .filter(d => d.registrations.length > 0)
    .map((d, i) => ({
      ...group,
      key: `${group.key}-DIV${i + 1}`,
      name: `${group.name} DIV${i + 1}`,
      registrations: d.registrations,
    }));
}

/**
 * Smart merging of small adjacent divisions
 */
export function smartMergeDivisions(
  groups: DivisionGroup[],
  config: CategorizationConfig,
  // Collects a note for each merge a fairness limit blocked.
  notes?: string[]
): DivisionGroup[] {
  if (!config.enableSmartMerging) return groups;

  const minSize =
    config.minDivisionSize ?? config.rules?.divisions.minDivisionSize ?? DIVISION_SIZE_CONFIG.minSize;
  const merged: DivisionGroup[] = [];
  const processed = new Set<number>();

  // Sort by belt level, gender, event type, age
  const sorted = [...groups].sort((a, b) => {
    if (a.beltLevel !== b.beltLevel) return a.beltLevel.localeCompare(b.beltLevel);
    if (a.gender !== b.gender) return a.gender.localeCompare(b.gender);
    if (a.eventType !== b.eventType) return a.eventType.localeCompare(b.eventType);
    return a.ageMin - b.ageMin;
  });

  for (let i = 0; i < sorted.length; i++) {
    if (processed.has(i)) continue;

    const current = sorted[i];

    // If current is too small, try to merge with adjacent
    if (current.registrations.length < minSize) {
      // Look for adjacent group to merge with
      let mergeCandidate: DivisionGroup | null = null;
      let mergeIndex = -1;

      // Check next group (prefer merging with older age group)
      if (i + 1 < sorted.length && !processed.has(i + 1)) {
        const next = sorted[i + 1];
        if (canMerge(current, next) && mergeKeepsFairnessLimits(current, next, config, notes)) {
          mergeCandidate = next;
          mergeIndex = i + 1;
        }
      }

      // No next candidate (e.g. the trailing division of its event):
      // fold it into the previous output division. Index i - 1 is
      // always processed by now, so merge into its output entry
      // (possibly itself a merge) in place.
      if (!mergeCandidate && merged.length > 0) {
        const prev = merged[merged.length - 1];
        // Don't undo a split: stay within the division threshold.
        const combined = prev.registrations.length + current.registrations.length;
        if (
          combined <= config.divisionThreshold &&
          canMerge(prev, current) &&
          mergeKeepsFairnessLimits(prev, current, config, notes)
        ) {
          merged[merged.length - 1] = mergeTwoDivisions(prev, current, config.eventTypeLabels);
          processed.add(i);
          continue;
        }
      }

      if (mergeCandidate && mergeIndex >= 0) {
        // Merge the divisions — thread eventTypeLabels so the
        // merged name uses the sport-specific label (Kata/Kumite
        // for Karate) rather than the hardcoded English.
        const mergedGroup = mergeTwoDivisions(current, mergeCandidate, config.eventTypeLabels);
        merged.push(mergedGroup);
        processed.add(i);
        processed.add(mergeIndex);
        continue;
      }
    }

    // Add as-is if not merged
    if (!processed.has(i)) {
      merged.push(current);
      processed.add(i);
    }
  }

  return merged;
}

/**
 * Canonical TKD colored-belt ranking used to judge belt-adjacency
 * for merging. Used by `canMerge` — but only as ONE of several
 * merge signals (age adjacency, weight class, combined size are
 * also checked). A belt color not in this list is treated as
 * "unknown" rather than letting `BELT_ORDER.indexOf(c) === -1`
 * produce a meaningless `Math.abs(-1 - x) === Infinity` distance.
 *
 * Note: this is the standard TKD 5-color progression. Other styles
 * use additional colors (Brown pre-black, Purple in some Karate /
 * BJJ lineages, etc.) — those are deliberately NOT listed here so
 * `canMerge` will defer to the other signals for them rather than
 * silently blocking the merge. If we extend this list, watch out
 * for the strict `<= 1 step` rule below: a 7-color beltOrder would
 * make Red/Brown a distance-2 pair, and the strict adjacency rule
 * would block their merge. That's actually arguably correct
 * (Brown is a pre-black tier, often grouped with Black belts) but
 * is a behavior change vs the original 5-color order.
 */
const BELT_ORDER: readonly string[] = ['White', 'Yellow', 'Green', 'Blue', 'Red'];

/**
 * Check if two divisions can be merged
 */
export function canMerge(a: DivisionGroup, b: DivisionGroup): boolean {
  // Must match on these criteria
  if (a.beltLevel !== b.beltLevel) return false;
  if (a.gender !== b.gender) return false;
  if (a.eventType !== b.eventType) return false;

  // Age groups must be adjacent, overlapping, or within a small gap
  // (GAP_TOLERANCE years). Custom age-group rules (useBlackBeltAgeGroups,
  // customAgeGroups) can leave gaps — e.g. [6-9] and [11-14] skipping 10
  // because the tournament didn't open a 10-year-old bracket — and we
  // still want to merge small adjacent divisions in that case. A gap
  // larger than GAP_TOLERANCE is treated as a deliberate category
  // boundary and is not mergeable.
  const GAP_TOLERANCE = 3;
  const minGap = Math.max(0, Math.max(b.ageMin - a.ageMax - 1, a.ageMin - b.ageMax - 1));
  const ageAdjacent = minGap <= GAP_TOLERANCE;
  if (!ageAdjacent) return false;

  // Belt colors should be similar or adjacent. Belt colors are
  // filled by `groupByBeltColor` / BB paths, but a defensive check
  // here keeps us safe if `beltColors` is ever empty (e.g. an
  // upstream refactor) — `Math.max(...[])` and `Math.min(...[])`
  // return ±Infinity, which would make the distance check below
  // always fire (Infinity > 1) and block otherwise-mergeable
  // divisions.
  const beltsOverlap = a.beltColors.some(belt => b.beltColors.includes(belt));
  const beltsAdjacent = beltsAreAdjacent(a.beltColors, b.beltColors);

  if (!beltsOverlap && !beltsAdjacent) return false;

  // For sparring, weight classes should match or be adjacent
  if (a.eventType === 'sparring' && a.weightClass && b.weightClass) {
    if (a.weightClass !== b.weightClass) return false;
  }

  // Combined size shouldn't exceed max
  const combinedSize = a.registrations.length + b.registrations.length;
  if (combinedSize > DIVISION_SIZE_CONFIG.maxSize) return false;

  return true;
}

/**
 * Decide whether two belt-color lists are "adjacent" on the
 * canonical belt ranking. Used by `canMerge` to judge whether two
 * divisions are similar enough to merge — but only as one of
 * several signals (age adjacency, weight class match, combined size
 * are also checked).
 *
 * Returns `true` (allow) when:
 *   - All colors are known and the closest pair across the two lists
 *     is within 1 step on the ranking, OR
 *   - Any color on either side is unknown (i.e. `BELT_ORDER.indexOf`
 *     returns `-1`). In that case we can't make a confident
 *     "not adjacent" judgement, so we defer to the other merge
 *     signals instead of silently blocking the merge. This is the
 *     safe direction to fail: a wrong-merge is visible (kids
 *     competing against a wildly different belt level), but a
 *     wrong-block leaves small divisions stranded with no
 *     competitor to fight.
 *
 * Returns `false` (block) only when:
 *   - Both lists have at least one known color AND
 *   - No known color on either list is within 1 step of any known
 *     color on the other list.
 *
 * Defensive: empty `beltColors` arrays return `true` (defer). The
 * pre-fix code did `Math.max(...[])` = `-Infinity`, which produced
 * an `Infinity` distance and silently blocked otherwise-mergeable
 * divisions.
 */
function beltsAreAdjacent(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true; // unknown — defer
  const aIdx = a.map(c => BELT_ORDER.indexOf(c));
  const bIdx = b.map(c => BELT_ORDER.indexOf(c));
  const aHasUnknown = aIdx.some(i => i < 0);
  const bHasUnknown = bIdx.some(i => i < 0);
  if (aHasUnknown || bHasUnknown) return true; // unknown color — defer
  const aMax = Math.max(...aIdx);
  const aMin = Math.min(...aIdx);
  const bMax = Math.max(...bIdx);
  const bMin = Math.min(...bIdx);
  // Check both directions — pick the closest pair across the lists.
  const distance = Math.min(
    Math.abs(aMax - bMin),
    Math.abs(bMax - aMin),
  );
  return distance <= 1;
}

/**
 * Merge two divisions into one
 */
function mergeTwoDivisions(
  a: DivisionGroup,
  b: DivisionGroup,
  eventTypeLabels?: { patterns: string; sparring: string }
): DivisionGroup {
  // Combine registrations
  const registrations = [...a.registrations, ...b.registrations];

  // Combine belt colors
  const beltColors = Array.from(new Set([...a.beltColors, ...b.beltColors]));

  // Use wider age range
  const ageMin = Math.min(a.ageMin, b.ageMin);
  const ageMax = Math.max(a.ageMax, b.ageMax);

  // Use wider dan range if applicable
  const danMin = a.danMin !== undefined && b.danMin !== undefined
    ? Math.min(a.danMin, b.danMin)
    : a.danMin ?? b.danMin;
  const danMax = a.danMax !== undefined && b.danMax !== undefined
    ? Math.max(a.danMax, b.danMax)
    : a.danMax ?? b.danMax;

  // Generate merged name — must mirror createDivisionGroup's event
  // type label lookup so a Karate tournament's merged division name
  // reads "Kata" / "Kumite" rather than the hardcoded "Patterns" /
  // "Sparring". Regression: the previous version ignored
  // eventTypeLabels entirely.
  const genderName = a.gender === 'M' ? 'Males' : 'Females';
  const eventName = eventTypeLabels?.[a.eventType] ?? (a.eventType === 'patterns' ? 'Patterns' : 'Sparring');

  let beltPart = '';
  if (a.beltLevel === 'BB') {
    beltPart = 'BB';
    if (danMin !== undefined && danMax !== undefined) {
      if (danMin === danMax) {
        beltPart = `BB ${formatDan(danMin)} Dan`;
      } else {
        beltPart = `BB ${formatDan(danMin)}-${formatDan(danMax)} Dan`;
      }
    }
  } else {
    beltPart = `CB-All ${beltColors.join('/')} Belts`;
  }

  let name = `${ageMin}-${ageMax} ${beltPart} ${genderName} ${eventName}`;
  if (a.weightClass) {
    name += ` ${a.weightClass}`;
  }

  return {
    key: `${a.key}-merged`,
    name,
    beltLevel: a.beltLevel,
    gender: a.gender,
    eventType: a.eventType,
    ageMin,
    ageMax,
    beltColors,
    danMin,
    danMax,
    weightClass: a.weightClass,
    registrations,
  };
}

/**
 * Validate a division group and return any warnings. Returns just the
 * warnings array (the previous shape included a `valid: true` flag
 * that was always true — no failure path existed — and no caller
 * read it).
 */
export function validateGroup(group: DivisionGroup): string[] {
  const warnings: string[] = [];

  // Check age spread
  const ages = group.registrations.map((r) => r.ageAtTournament || 0);
  const ageSpread = Math.max(...ages) - Math.min(...ages);
  if (ageSpread > 5) {
    warnings.push(`Large age spread: ${ageSpread} years`);
  }

  // Check weight spread for sparring
  if (group.eventType === 'sparring') {
    const weights = group.registrations.map((r) => r.weightAtRegistration || r.competitor.weightLbs || 0);
    const validWeights = weights.filter((w) => w > 0);
    if (validWeights.length > 1) {
      const weightSpread = Math.max(...validWeights) - Math.min(...validWeights);
      if (weightSpread > 30) {
        warnings.push(`Large weight spread: ${weightSpread} lbs`);
      }
    }
  }

  return warnings;
}

// ─── Fair divisions (opt-in via rules.fairness / weights.strategy) ─────

const weightOf = (r: RegistrationWithCompetitor): number =>
  r.weightAtRegistration || r.competitor.weightLbs || 0;

const heightOf = (r: RegistrationWithCompetitor): number | null =>
  r.heightAtRegistration ?? r.competitor.heightInches ?? null;

const fullName = (r: RegistrationWithCompetitor): string =>
  `${r.competitor.firstName} ${r.competitor.lastName}`.trim();

const formatNumber = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const years = (n: number): string => `${n} year${n === 1 ? '' : 's'}`;

/** School resolver with the tournament's organizer aliases. */
function schoolResolverFor(config?: CategorizationConfig): SchoolResolver {
  return createSchoolResolver(config?.rules?.fairness?.schoolAliases);
}

/**
 * The hard limits for a division covering ages [ageMin, ageMax]: every
 * configured limit whose age range overlaps it applies, and the
 * strictest value wins (a merged 6-9 division keeps the 6-7 limit).
 */
export function fairnessLimitFor(
  ageMin: number,
  ageMax: number,
  config?: CategorizationConfig,
): { maxWeightGapLbs?: number; maxAgeGapYears?: number } {
  const result: { maxWeightGapLbs?: number; maxAgeGapYears?: number } = {};
  for (const limit of config?.rules?.fairness?.limits ?? []) {
    if (limit.ageMax < ageMin || limit.ageMin > ageMax) continue;
    if (limit.maxWeightGapLbs !== undefined) {
      result.maxWeightGapLbs = Math.min(result.maxWeightGapLbs ?? Infinity, limit.maxWeightGapLbs);
    }
    if (limit.maxAgeGapYears !== undefined) {
      result.maxAgeGapYears = Math.min(result.maxAgeGapYears ?? Infinity, limit.maxAgeGapYears);
    }
  }
  return result;
}

/**
 * Cut a sorted list of values into contiguous parts of similar size.
 *
 * Uses at least `parts` parts, and more when needed so that no part's
 * spread (last - first) exceeds `maxSpread`. Among equally balanced
 * cuts it prefers cutting at the biggest jumps between neighbours.
 * Returns the size of each part, in order.
 */
export function partitionSorted(values: number[], parts: number, maxSpread = Infinity): number[] {
  const n = values.length;
  if (n === 0) return [];

  // Fewest parts that respect the spread (greedy left to right).
  let needed = 1;
  let start = 0;
  for (let i = 1; i < n; i++) {
    if (values[i] - values[start] > maxSpread) {
      needed++;
      start = i;
    }
  }
  const k = Math.min(n, Math.max(1, Math.floor(parts) || 1, needed));
  if (k === 1) return [n];

  const ideal = n / k;
  // Size balance dominates; the jump at a cut only breaks ties.
  const SIZE_WEIGHT = 1e6;
  const cost: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1));
  cost[0][0] = 0;
  for (let j = 1; j <= k; j++) {
    for (let end = j; end <= n - (k - j); end++) {
      for (let s = end - 1; s >= j - 1; s--) {
        if (values[end - 1] - values[s] > maxSpread) break;
        if (cost[j - 1][s] === Infinity) continue;
        const size = end - s;
        const cutBonus = s > 0 ? values[s] - values[s - 1] : 0;
        const total = cost[j - 1][s] + (size - ideal) ** 2 * SIZE_WEIGHT - cutBonus;
        if (total < cost[j][end]) {
          cost[j][end] = total;
          from[j][end] = s;
        }
      }
    }
  }

  const sizes: number[] = [];
  let end = n;
  for (let j = k; j >= 1; j--) {
    const s = from[j][end];
    if (s < 0) return [n]; // unreachable: k >= needed is always feasible
    sizes.unshift(end - s);
    end = s;
  }
  return sizes;
}

/** Plain class names for an automatic cut into `count` weight classes. */
export function autoWeightClassNames(count: number): string[] {
  if (count <= 1) return [];
  if (count === 2) return ['Light', 'Heavy'];
  if (count === 3) return ['Light', 'Middle', 'Heavy'];
  if (count === 4) return ['Feather', 'Light', 'Middle', 'Heavy'];
  return Array.from({ length: count }, (_, i) => `Weight ${i + 1}`);
}

/** Lightest first; with the height tie-break, shorter first among equal weights. */
function sortByWeight(
  registrations: RegistrationWithCompetitor[],
  heightTieBreak: boolean,
): RegistrationWithCompetitor[] {
  return [...registrations].sort((a, b) => {
    const byWeight = weightOf(a) - weightOf(b);
    if (byWeight !== 0 || !heightTieBreak) return byWeight;
    const ha = heightOf(a);
    const hb = heightOf(b);
    if (ha == null || hb == null) return ha == null ? (hb == null ? 0 : 1) : -1;
    return ha - hb;
  });
}

function sliceBySizes<T>(items: T[], sizes: number[]): T[][] {
  const out: T[][] = [];
  let at = 0;
  for (const size of sizes) {
    out.push(items.slice(at, at + size));
    at += size;
  }
  return out;
}

/**
 * "Auto" weight classes: sort the group by weight and cut it into up to
 * `maxClasses` classes (default 3: Light / Middle / Heavy) of about
 * `targetClassSize` people, relative to the group itself (no fixed
 * tables). A fairness weight limit for the age band adds classes until
 * no class spans more than the limit.
 */
export function autoWeightClasses(
  registrations: RegistrationWithCompetitor[],
  options: {
    maxClasses?: number;
    targetClassSize?: number;
    skipIfSmallerThan?: number;
    maxWeightGapLbs?: number;
    heightTieBreak?: boolean;
  } = {},
): Array<{ weightClass: string | undefined; registrations: RegistrationWithCompetitor[] }> {
  if (registrations.length === 0) return [];
  const sorted = sortByWeight(registrations, options.heightTieBreak ?? false);
  const target = Math.max(1, options.targetClassSize ?? 4);
  const maxClasses = Math.max(1, options.maxClasses ?? 3);
  const wanted = sorted.length < (options.skipIfSmallerThan ?? 4)
    ? 1
    : Math.min(maxClasses, Math.ceil(sorted.length / target));
  const sizes = partitionSorted(sorted.map(weightOf), wanted, options.maxWeightGapLbs ?? Infinity);
  const names = autoWeightClassNames(sizes.length);
  return sliceBySizes(sorted, sizes).map((regs, i) => ({ weightClass: names[i], registrations: regs }));
}

/** Sparring weight grouping for one age band: auto classes or weight tables. */
function weightGroupsFor(
  registrations: RegistrationWithCompetitor[],
  gender: 'M' | 'F',
  ageGroup: AgeGroup,
  config: CategorizationConfig,
): Array<{ weightClass: string | undefined; registrations: RegistrationWithCompetitor[] }> {
  const rules = config.rules;
  if (rules?.weights.strategy !== 'auto') {
    return groupByWeightClass(registrations, gender, ageGroup, config.customWeightClasses);
  }
  return autoWeightClasses(registrations, {
    maxClasses: rules.weights.autoMaxClasses,
    targetClassSize: rules.weights.targetClassSize,
    skipIfSmallerThan: rules.weights.skipIfDivisionSmallerThan,
    maxWeightGapLbs: fairnessLimitFor(ageGroup.min, ageGroup.max, config).maxWeightGapLbs,
    heightTieBreak: rules.fairness?.heightTieBreak,
  });
}

/**
 * Split a too-big division into parts of people who are alike instead
 * of dealing them out: sparring by weight (height breaks ties when
 * enabled), patterns by age then belt (belt then age when the rules
 * split by belt). Fairness limits add parts when one would be too wide.
 */
function similarSplitDivision(
  group: DivisionGroup,
  numDivisions: number,
  config: CategorizationConfig,
): DivisionGroup[] {
  const limit = fairnessLimitFor(group.ageMin, group.ageMax, config);
  let sorted: RegistrationWithCompetitor[];
  let values: number[];
  let maxSpread = Infinity;

  if (group.eventType === 'sparring') {
    sorted = sortByWeight(group.registrations, config.rules?.fairness?.heightTieBreak ?? false);
    values = sorted.map(weightOf);
    maxSpread = limit.maxWeightGapLbs ?? Infinity;
  } else {
    const beltRank = (r: RegistrationWithCompetitor) =>
      getInitialSkillEstimate(r.competitor.belt, r.competitor.danRank ?? null, 'patterns');
    const age = (r: RegistrationWithCompetitor) => r.ageAtTournament ?? 0;
    const beltFirst = config.rules?.divisions.splitBy === 'belt';
    sorted = [...group.registrations].sort((a, b) =>
      beltFirst
        ? beltRank(a) - beltRank(b) || age(a) - age(b)
        : age(a) - age(b) || beltRank(a) - beltRank(b)
    );
    values = sorted.map(beltFirst ? beltRank : age);
    if (!beltFirst) maxSpread = limit.maxAgeGapYears ?? Infinity;
  }

  const parts = sliceBySizes(sorted, partitionSorted(values, numDivisions, maxSpread));
  if (parts.length === 1) return [group];
  return parts.map((registrations, i) => ({
    ...group,
    key: `${group.key}-DIV${i + 1}`,
    name: `${group.name} DIV${i + 1}`,
    registrations,
  }));
}

/** Pairs in a division whose difference in `valueOf` is over `limit`. */
function pairsOverLimit(
  registrations: RegistrationWithCompetitor[],
  valueOf: (r: RegistrationWithCompetitor) => number | null,
  limit: number,
): { count: number; low: RegistrationWithCompetitor; high: RegistrationWithCompetitor; gap: number } | null {
  const measured = registrations
    .map((r) => ({ r, v: valueOf(r) }))
    .filter((x): x is { r: RegistrationWithCompetitor; v: number } => x.v != null)
    .sort((a, b) => a.v - b.v);
  if (measured.length < 2) return null;
  const low = measured[0];
  const high = measured[measured.length - 1];
  if (high.v - low.v <= limit) return null;
  let count = 0;
  for (let i = 0; i < measured.length; i++) {
    for (let j = i + 1; j < measured.length; j++) {
      if (measured[j].v - measured[i].v > limit) count++;
    }
  }
  return { count, low: low.r, high: high.r, gap: high.v - low.v };
}

/**
 * Fairness problems in a division, in plain words naming the people
 * furthest apart: weight gap (sparring) and age gap over the limit for
 * its ages, and one school filling too much of it.
 */
export function fairnessWarnings(
  group: Pick<DivisionGroup, 'eventType' | 'ageMin' | 'ageMax' | 'registrations'>,
  config?: CategorizationConfig,
  resolver: SchoolResolver = schoolResolverFor(config),
  options: { includeSchoolShare?: boolean } = {},
): string[] {
  const warnings: string[] = [];
  const limit = fairnessLimitFor(group.ageMin, group.ageMax, config);
  const more = (count: number) =>
    count > 1 ? ` (${count - 1} more pair${count - 1 === 1 ? '' : 's'} over the limit)` : '';

  if (group.eventType === 'sparring' && limit.maxWeightGapLbs !== undefined) {
    const over = pairsOverLimit(group.registrations, (r) => weightOf(r) || null, limit.maxWeightGapLbs);
    if (over) {
      warnings.push(
        `Weight gap over the limit: ${fullName(over.low)} (${formatNumber(weightOf(over.low))} lb) and ` +
        `${fullName(over.high)} (${formatNumber(weightOf(over.high))} lb) are ${formatNumber(over.gap)} lb apart ` +
        `(limit ${formatNumber(limit.maxWeightGapLbs)} lb)${more(over.count)}`
      );
    }
  }

  if (limit.maxAgeGapYears !== undefined) {
    const over = pairsOverLimit(group.registrations, (r) => r.ageAtTournament, limit.maxAgeGapYears);
    if (over) {
      warnings.push(
        `Age gap over the limit: ${fullName(over.low)} (${over.low.ageAtTournament}) and ` +
        `${fullName(over.high)} (${over.high.ageAtTournament}) are ${years(over.gap)} apart ` +
        `(limit ${years(limit.maxAgeGapYears)})${more(over.count)}`
      );
    }
  }

  const sharePercent = config?.rules?.fairness?.schoolShareWarningPercent ?? 0;
  if (options.includeSchoolShare !== false && sharePercent > 0 && group.registrations.length >= 3) {
    const top = dominantSchool(group.registrations.map((r) => r.competitor.schoolDojang), sharePercent / 100, resolver);
    if (top) {
      warnings.push(`${top.count} of ${top.total} competitors are from ${top.label}`);
    }
  }

  return warnings;
}

/**
 * Whether merging two divisions keeps the fairness limits for the
 * merged ages. A blocked merge adds a note naming the pair that would
 * be too far apart.
 */
export function mergeKeepsFairnessLimits(
  a: DivisionGroup,
  b: DivisionGroup,
  config: CategorizationConfig,
  notes?: string[],
): boolean {
  if (!config.rules?.fairness?.limits.length) return true;
  const problems = fairnessWarnings(
    {
      eventType: a.eventType,
      ageMin: Math.min(a.ageMin, b.ageMin),
      ageMax: Math.max(a.ageMax, b.ageMax),
      registrations: [...a.registrations, ...b.registrations],
    },
    config,
    undefined,
    { includeSchoolShare: false },
  );
  if (problems.length === 0) return true;
  notes?.push(`Kept "${a.name}" and "${b.name}" apart. ${problems[0]}`);
  return false;
}
