import { PrismaClient, Registration, Competitor } from '@prisma/client';
import { getBeltLevel, getSimpleBeltCategory, isBlackBelt } from '../../shared/constants/belts.js';
import { getAgeGroup, DEFAULT_AGE_GROUPS, BB_AGE_GROUPS, type AgeGroup } from '../../shared/constants/age-groups.js';
import { getWeightClass, DEFAULT_WEIGHT_CLASSES } from '../../shared/constants/weight-classes.js';

export interface CategorizationConfig {
  divisionThreshold: number;
  useBlackBeltAgeGroups?: boolean;
  customAgeGroups?: AgeGroup[];
}

interface RegistrationWithCompetitor extends Registration {
  competitor: Competitor;
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
  competitors: { name: string; school: string }[];
}

export interface PreviewResult {
  divisions: PreviewDivision[];
  totalCompetitors: number;
  warnings: string[];
}

export function previewCategorization(
  registrations: RegistrationWithCompetitor[],
  config: CategorizationConfig
): PreviewResult {
  const warnings: string[] = [];

  // Separate into patterns and sparring registrations
  const patternsRegs = registrations.filter((r) => r.patterns);
  const sparringRegs = registrations.filter((r) => r.sparring);

  const allGroups: DivisionGroup[] = [];

  // Process patterns registrations
  const patternsGroups = categorizeByEvent(patternsRegs, 'patterns', config);
  allGroups.push(...patternsGroups);

  // Process sparring registrations (includes weight class)
  const sparringGroups = categorizeByEvent(sparringRegs, 'sparring', config);
  allGroups.push(...sparringGroups);

  // Split large divisions
  const finalGroups: DivisionGroup[] = [];
  for (const group of allGroups) {
    if (group.registrations.length > config.divisionThreshold) {
      const splits = splitDivision(group, config.divisionThreshold);
      finalGroups.push(...splits);
      warnings.push(`"${group.name}" will be split into ${splits.length} divisions (${group.registrations.length} competitors)`);
    } else {
      finalGroups.push(group);
    }
  }

  // Convert to preview format
  const divisions: PreviewDivision[] = finalGroups
    .filter((g) => g.registrations.length > 0)
    .map((group) => {
      // Validate and collect warnings
      const validation = validateGroup(group);
      if (validation.warnings.length > 0) {
        warnings.push(...validation.warnings.map((w) => `${group.name}: ${w}`));
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

  // Clear existing divisions and assignments
  await prisma.division.deleteMany({
    where: { tournamentId },
  });

  // Separate into patterns and sparring registrations
  const patternsRegs = registrations.filter((r) => r.patterns);
  const sparringRegs = registrations.filter((r) => r.sparring);

  const allGroups: DivisionGroup[] = [];

  // Process patterns registrations
  const patternsGroups = categorizeByEvent(patternsRegs, 'patterns', config);
  allGroups.push(...patternsGroups);

  // Process sparring registrations (includes weight class)
  const sparringGroups = categorizeByEvent(sparringRegs, 'sparring', config);
  allGroups.push(...sparringGroups);

  // Split large divisions
  const finalGroups: DivisionGroup[] = [];
  for (const group of allGroups) {
    if (group.registrations.length > config.divisionThreshold) {
      const splits = splitDivision(group, config.divisionThreshold);
      finalGroups.push(...splits);
    } else {
      finalGroups.push(group);
    }
  }

  // Create divisions and assignments
  let divisionCount = 0;
  let assignmentCount = 0;
  let displayOrder = 0;

  for (const group of finalGroups) {
    if (group.registrations.length === 0) continue;

    // Validate group
    const validation = validateGroup(group);
    if (validation.warnings.length > 0) {
      warnings.push(...validation.warnings.map((w) => `${group.name}: ${w}`));
    }

    const division = await prisma.division.create({
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

    // Create assignments
    for (let i = 0; i < group.registrations.length; i++) {
      await prisma.divisionAssignment.create({
        data: {
          divisionId: division.id,
          registrationId: group.registrations[i].id,
          seedPosition: i + 1,
        },
      });
      assignmentCount++;
    }

    divisionCount++;
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
  config: CategorizationConfig
): DivisionGroup[] {
  const groups: DivisionGroup[] = [];

  // First split by belt level (BB vs CB)
  const bbRegs = registrations.filter((r) => isBlackBelt(r.competitor.belt));
  const cbRegs = registrations.filter((r) => !isBlackBelt(r.competitor.belt));

  // Process Black Belt
  if (bbRegs.length > 0) {
    const bbGroups = categorizeBeltLevel(bbRegs, 'BB', eventType, config);
    groups.push(...bbGroups);
  }

  // Process Colored Belt
  if (cbRegs.length > 0) {
    const cbGroups = categorizeBeltLevel(cbRegs, 'CB', eventType, config);
    groups.push(...cbGroups);
  }

  return groups;
}

function categorizeBeltLevel(
  registrations: RegistrationWithCompetitor[],
  beltLevel: 'BB' | 'CB',
  eventType: 'patterns' | 'sparring',
  config: CategorizationConfig
): DivisionGroup[] {
  const groups: DivisionGroup[] = [];

  // Split by gender (support both 'M'/'F' and 'male'/'female' formats)
  const males = registrations.filter((r) => r.competitor.gender === 'male' || r.competitor.gender === 'M');
  const females = registrations.filter((r) => r.competitor.gender === 'female' || r.competitor.gender === 'F');

  for (const [gender, genderRegs] of [
    ['M', males],
    ['F', females],
  ] as const) {
    if (genderRegs.length === 0) continue;

    // Split by age group
    const ageGroups = beltLevel === 'BB' ? BB_AGE_GROUPS : DEFAULT_AGE_GROUPS;

    for (const ageGroup of ageGroups) {
      const ageRegs = genderRegs.filter((r) => {
        const age = r.ageAtTournament || 0;
        return age >= ageGroup.min && age <= ageGroup.max;
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
                danGroup.danMax
              )
            );
          }
        } else {
          // Sparring - split by weight class
          const weightGroups = groupByWeightClass(ageRegs, gender, ageGroup);
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
                weightGroup.weightClass
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
                beltGroup.belts
              )
            );
          }
        } else {
          // Sparring - first group by belt, then by weight
          const beltGroups = groupByBeltColor(ageRegs);
          for (const beltGroup of beltGroups) {
            const weightGroups = groupByWeightClass(beltGroup.registrations, gender, ageGroup);
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
                  weightGroup.weightClass
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
  ageGroup: AgeGroup
): Array<{ weightClass: string; registrations: RegistrationWithCompetitor[] }> {
  const groups = new Map<string, RegistrationWithCompetitor[]>();

  for (const reg of registrations) {
    const weight = reg.weightAtRegistration || reg.competitor.weightLbs || 0;
    const age = reg.ageAtTournament || 0;
    const weightClass = getWeightClass(weight, age, gender) || 'Unassigned';

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
  weightClass?: string
): DivisionGroup {
  // Generate name
  const genderName = gender === 'M' ? 'Males' : 'Females';
  const eventName = eventType === 'patterns' ? 'Patterns' : 'Sparring';

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

function splitDivision(group: DivisionGroup, threshold: number): DivisionGroup[] {
  const count = group.registrations.length;
  const numDivisions = Math.ceil(count / threshold);
  const perDivision = Math.ceil(count / numDivisions);

  // Sort by school to distribute evenly
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

function validateGroup(group: DivisionGroup): { valid: boolean; warnings: string[] } {
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

  return { valid: true, warnings };
}
