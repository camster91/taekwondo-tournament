import { PrismaClient, Registration, Competitor } from '@prisma/client';
import { getBeltLevel, getSimpleBeltCategory, isBlackBelt } from '../../shared/constants/belts.js';
import { getAgeGroup, DEFAULT_AGE_GROUPS, BB_AGE_GROUPS, type AgeGroup } from '../../shared/constants/age-groups.js';
import { getWeightClass, DEFAULT_WEIGHT_CLASSES } from '../../shared/constants/weight-classes.js';
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
    danRank?: number | null;
  };
}

interface DivisionGroup {
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

  // v2: skip registrations manually pinned to a specific division —
  // they are managed via the move endpoint, not auto-categorization
  const unpinned = registrations.filter((r) => !r.manualDivisionId);
  const pinnedCount = registrations.length - unpinned.length;
  if (pinnedCount > 0) {
    warnings.push(`${pinnedCount} registration(s) are pinned to specific divisions and will be excluded from auto-categorization. Run "Restore pinned" to re-include them.`);
  }

  const partitioned = partitionRegistrationsForCategorization(unpinned);
  const { patternsRegs, sparringRegs } = partitioned;
  warnings.push(...partitioned.warnings);

  const allGroups: DivisionGroup[] = [];

  // Process patterns registrations
  const patternsGroups = categorizeByEvent(patternsRegs, 'patterns', config);
  allGroups.push(...patternsGroups);

  // Process sparring registrations (includes weight class)
  const sparringGroups = categorizeByEvent(sparringRegs, 'sparring', config);
  allGroups.push(...sparringGroups);

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
    finalGroups = smartMergeDivisions(finalGroups, config);
    const mergedCount = beforeCount - finalGroups.length;
    if (mergedCount > 0) {
      warnings.push(`Merged ${mergedCount} small adjacent divisions`);
    }
  }

  // Convert to preview format
  const divisions: PreviewDivision[] = finalGroups
    .filter((g) => g.registrations.length > 0)
    .map((group) => {
      // Collect any validation warnings (large age spread,
      // large weight spread, etc.) — these don't fail the preview,
      // just surface as warnings.
      const warningsForGroup = validateGroup(group);
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
  prisma: PrismaClient,
  tournamentId: string,
  registrations: RegistrationWithCompetitor[],
  config: CategorizationConfig
): Promise<CategorizationResult> {
  const warnings: string[] = [];

  // v2: skip registrations manually pinned to a specific division
  const unpinned = registrations.filter((r) => !r.manualDivisionId);
  const pinnedDivisionIds = Array.from(
    new Set(
      registrations
        .map((registration) => registration.manualDivisionId)
        .filter((divisionId): divisionId is string => Boolean(divisionId))
    )
  );
  const pinnedCount = registrations.length - unpinned.length;
  if (pinnedCount > 0) {
    warnings.push(`${pinnedCount} registration(s) are pinned to specific divisions and were excluded from auto-categorization.`);
  }

  const partitioned = partitionRegistrationsForCategorization(unpinned);
  const { patternsRegs, sparringRegs } = partitioned;
  warnings.push(...partitioned.warnings);

  const allGroups: DivisionGroup[] = [];

  // Process patterns registrations
  const patternsGroups = categorizeByEvent(patternsRegs, 'patterns', config);
  allGroups.push(...patternsGroups);

  // Process sparring registrations (includes weight class)
  const sparringGroups = categorizeByEvent(sparringRegs, 'sparring', config);
  allGroups.push(...sparringGroups);

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
    finalGroups = smartMergeDivisions(finalGroups, config);
  }

  // Wrap all DB mutations in a transaction
  let divisionCount = 0;
  let assignmentCount = 0;

  await prisma.$transaction(async (tx) => {
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
      const warningsForGroup = validateGroup(group);
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
  });

  return {
    divisions: divisionCount,
    assignments: assignmentCount,
    warnings,
  };
}

function categorizeByEvent(
  registrations: RegistrationWithCompetitor[],
  eventType: 'patterns' | 'sparring',
  config: CategorizationConfig
): DivisionGroup[] {
  const groups: DivisionGroup[] = [];

  // First split by belt level (BB vs CB)
  const bbRegs = registrations.filter((r) => isBlackBelt(r.competitor.belt));
  const cbRegs = registrations.filter((r) => !isBlackBelt(r.competitor.belt));

  // Process Black Belt
  if (bbRegs.length > 0) {
    const bbGroups = categorizeBeltLevel(bbRegs, 'BB', eventType, config, config.eventTypeLabels);
    groups.push(...bbGroups);
  }

  // Process Colored Belt
  if (cbRegs.length > 0) {
    const cbGroups = categorizeBeltLevel(cbRegs, 'CB', eventType, config, config.eventTypeLabels);
    groups.push(...cbGroups);
  }

  return groups;
}

function categorizeBeltLevel(
  registrations: RegistrationWithCompetitor[],
  beltLevel: 'BB' | 'CB',
  eventType: 'patterns' | 'sparring',
  config: CategorizationConfig,
  eventTypeLabels?: { patterns: string; sparring: string }
): DivisionGroup[] {
  const groups: DivisionGroup[] = [];
  const rules = config.rules ?? DEFAULT_TOURNAMENT_RULES;

  // Split by gender (support both 'M'/'F' and 'male'/'female' formats)
  const males = registrations.filter((r) => r.competitor.gender === 'male' || r.competitor.gender === 'M');
  const females = registrations.filter((r) => r.competitor.gender === 'female' || r.competitor.gender === 'F');

  for (const [gender, genderRegs] of [
    ['M', males],
    ['F', females],
  ] as const) {
    if (genderRegs.length === 0) continue;

    // Determine age bands: rules > useBlackBeltAgeGroups flag > DEFAULT
    const ageGroups: AgeGroup[] = (() => {
      if (config.customAgeGroups) return config.customAgeGroups;
      if (config.rules) {
        return rules.ageBands.customBands ?? (rules.ageBands.preset === 'blackBelt' ? BB_AGE_GROUPS : DEFAULT_AGE_GROUPS);
      }
      return config.useBlackBeltAgeGroups ? BB_AGE_GROUPS : DEFAULT_AGE_GROUPS;
    })();

    for (const ageGroup of ageGroups) {
      const ageRegs = genderRegs.filter((r) => {
        const age = r.ageAtTournament || 0;
        // Standard age band match
        if (age >= ageGroup.min && age <= ageGroup.max) return true;
        // v2: "compete with older" opt-in — a competitor whose age is below
        // the band's min (within ageFlexMonths) can be promoted up
        if (r.competeWithOlder && config.enableAgeBoundaryFlex !== false) {
          const toleranceMonths = config.ageBoundaryTolerance ?? 0;
          if (toleranceMonths > 0) {
            const ageWithFlex = age + toleranceMonths / 12;
            if (ageWithFlex >= ageGroup.min && ageWithFlex <= ageGroup.max) return true;
          }
        }
        return false;
      });

      if (ageRegs.length === 0) continue;

      if (beltLevel === 'BB') {
        // For BB, split by dan rank for patterns
        if (eventType === 'patterns') {
          const danGroups = groupByDanRank(ageRegs);
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
          const weightGroups = groupByWeightClass(ageRegs, gender, ageGroup, config.customWeightClasses);
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
            const weightGroups = groupByWeightClass(beltGroup.registrations, gender, ageGroup, config.customWeightClasses);
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

function groupByDanRank(
  registrations: RegistrationWithCompetitor[]
): Array<{ danMin: number; danMax: number; registrations: RegistrationWithCompetitor[] }> {
  const groups: Array<{ danMin: number; danMax: number; registrations: RegistrationWithCompetitor[] }> = [];

  // Common dan groupings
  const danGroupings = [
    { min: 1, max: 2 },
    { min: 3, max: 3 },
    { min: 4, max: 6 },
  ];

  for (const danGroup of danGroupings) {
    const regs = registrations.filter((r) => {
      const dan = r.competitor.danRank || 1;
      return dan >= danGroup.min && dan <= danGroup.max;
    });

    if (regs.length > 0) {
      groups.push({
        danMin: danGroup.min,
        danMax: danGroup.max,
        registrations: regs,
      });
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

  for (const reg of registrations) {
    const weight = reg.weightAtRegistration || reg.competitor.weightLbs || 0;
    const age = reg.ageAtTournament || 0;
    const weightClass = getWeightClass(weight, age, gender, weightClassConfig) || 'Unassigned';

    if (!groups.has(weightClass)) {
      groups.set(weightClass, []);
    }
    groups.get(weightClass)!.push(reg);
  }

  return Array.from(groups.entries()).map(([weightClass, regs]) => ({
    weightClass,
    registrations: regs,
  }));
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
  const numDivisions = Math.ceil(count / threshold);
  const perDivision = Math.ceil(count / numDivisions);

  // Use smart splitting if enabled
  if (config?.enableSmartSplitting) {
    return smartSplitDivision(group, numDivisions, perDivision, config);
  }

  // Default: Sort by school to distribute evenly
  const sorted = [...group.registrations].sort((a, b) =>
    (a.competitor.schoolDojang || '').localeCompare(b.competitor.schoolDojang || '')
  );

  // Interleave by school
  const schools = new Map<string, RegistrationWithCompetitor[]>();
  for (const reg of sorted) {
    const school = reg.competitor.schoolDojang || 'Unknown';
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

  // Calculate estimated skill for each competitor
  const withSkill = group.registrations.map((reg) => ({
    reg,
    skill: getInitialSkillEstimate(
      reg.competitor.belt,
      reg.competitor.danRank ?? null,
      eventType
    ),
    school: reg.competitor.schoolDojang || 'Unknown',
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
        ? div.registrations.filter(r => (r.competitor.schoolDojang || 'Unknown') === school).length
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
function smartMergeDivisions(
  groups: DivisionGroup[],
  config: CategorizationConfig
): DivisionGroup[] {
  if (!config.enableSmartMerging) return groups;

  const minSize = DIVISION_SIZE_CONFIG.minSize;
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
        if (canMerge(current, next)) {
          mergeCandidate = next;
          mergeIndex = i + 1;
        }
      }

      // Check previous group if no next candidate
      if (!mergeCandidate && i > 0 && !processed.has(i - 1)) {
        const prev = sorted[i - 1];
        // Only merge with previous if it's also small
        if (prev.registrations.length < minSize && canMerge(prev, current)) {
          mergeCandidate = prev;
          mergeIndex = i - 1;
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
