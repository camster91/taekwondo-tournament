import { getSimpleBeltCategory, isBlackBelt } from '../../shared/constants/belts.js';
import { DEFAULT_AGE_GROUPS, BB_AGE_GROUPS } from '../../shared/constants/age-groups.js';
import { getWeightClass } from '../../shared/constants/weight-classes.js';
import { DIVISION_SIZE_CONFIG, getInitialSkillEstimate, } from '../../shared/constants/fairness-config.js';
export function previewCategorization(registrations, config) {
    const warnings = [];
    // Separate into patterns and sparring registrations
    const patternsRegs = registrations.filter((r) => r.patterns);
    const sparringRegs = registrations.filter((r) => r.sparring);
    const allGroups = [];
    // Process patterns registrations
    const patternsGroups = categorizeByEvent(patternsRegs, 'patterns', config);
    allGroups.push(...patternsGroups);
    // Process sparring registrations (includes weight class)
    const sparringGroups = categorizeByEvent(sparringRegs, 'sparring', config);
    allGroups.push(...sparringGroups);
    // Split large divisions
    let finalGroups = [];
    for (const group of allGroups) {
        if (group.registrations.length > config.divisionThreshold) {
            const splits = splitDivision(group, config.divisionThreshold, config);
            finalGroups.push(...splits);
            const splitMethod = config.enableSmartSplitting ? 'skill-balanced' : 'standard';
            warnings.push(`"${group.name}" will be split into ${splits.length} divisions (${group.registrations.length} competitors, ${splitMethod})`);
        }
        else {
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
    const divisions = finalGroups
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
    const competitorIds = new Set();
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
export async function autoCategorize(prisma, tournamentId, registrations, config) {
    const warnings = [];
    // Clear existing divisions and assignments
    await prisma.division.deleteMany({
        where: { tournamentId },
    });
    // Separate into patterns and sparring registrations
    const patternsRegs = registrations.filter((r) => r.patterns);
    const sparringRegs = registrations.filter((r) => r.sparring);
    const allGroups = [];
    // Process patterns registrations
    const patternsGroups = categorizeByEvent(patternsRegs, 'patterns', config);
    allGroups.push(...patternsGroups);
    // Process sparring registrations (includes weight class)
    const sparringGroups = categorizeByEvent(sparringRegs, 'sparring', config);
    allGroups.push(...sparringGroups);
    // Split large divisions
    let finalGroups = [];
    for (const group of allGroups) {
        if (group.registrations.length > config.divisionThreshold) {
            const splits = splitDivision(group, config.divisionThreshold, config);
            finalGroups.push(...splits);
        }
        else {
            finalGroups.push(group);
        }
    }
    // Merge small divisions if enabled
    if (config.enableSmartMerging) {
        finalGroups = smartMergeDivisions(finalGroups, config);
    }
    // Create divisions and assignments
    let divisionCount = 0;
    let assignmentCount = 0;
    let displayOrder = 0;
    for (const group of finalGroups) {
        if (group.registrations.length === 0)
            continue;
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
function categorizeByEvent(registrations, eventType, config) {
    const groups = [];
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
function categorizeBeltLevel(registrations, beltLevel, eventType, config) {
    const groups = [];
    // Split by gender (support both 'M'/'F' and 'male'/'female' formats)
    const males = registrations.filter((r) => r.competitor.gender === 'male' || r.competitor.gender === 'M');
    const females = registrations.filter((r) => r.competitor.gender === 'female' || r.competitor.gender === 'F');
    for (const [gender, genderRegs] of [
        ['M', males],
        ['F', females],
    ]) {
        if (genderRegs.length === 0)
            continue;
        // Split by age group
        const ageGroups = beltLevel === 'BB' ? BB_AGE_GROUPS : DEFAULT_AGE_GROUPS;
        for (const ageGroup of ageGroups) {
            const ageRegs = genderRegs.filter((r) => {
                const age = r.ageAtTournament || 0;
                return age >= ageGroup.min && age <= ageGroup.max;
            });
            if (ageRegs.length === 0)
                continue;
            if (beltLevel === 'BB') {
                // For BB, split by dan rank for patterns
                if (eventType === 'patterns') {
                    const danGroups = groupByDanRank(ageRegs);
                    for (const danGroup of danGroups) {
                        groups.push(createDivisionGroup(danGroup.registrations, beltLevel, gender, eventType, ageGroup, ['Black'], danGroup.danMin, danGroup.danMax));
                    }
                }
                else {
                    // Sparring - split by weight class
                    const weightGroups = groupByWeightClass(ageRegs, gender, ageGroup);
                    for (const weightGroup of weightGroups) {
                        groups.push(createDivisionGroup(weightGroup.registrations, beltLevel, gender, eventType, ageGroup, ['Black'], undefined, undefined, weightGroup.weightClass));
                    }
                }
            }
            else {
                // For CB, group by belt color
                if (eventType === 'patterns') {
                    const beltGroups = groupByBeltColor(ageRegs);
                    for (const beltGroup of beltGroups) {
                        groups.push(createDivisionGroup(beltGroup.registrations, beltLevel, gender, eventType, ageGroup, beltGroup.belts));
                    }
                }
                else {
                    // Sparring - first group by belt, then by weight
                    const beltGroups = groupByBeltColor(ageRegs);
                    for (const beltGroup of beltGroups) {
                        const weightGroups = groupByWeightClass(beltGroup.registrations, gender, ageGroup);
                        for (const weightGroup of weightGroups) {
                            groups.push(createDivisionGroup(weightGroup.registrations, beltLevel, gender, eventType, ageGroup, beltGroup.belts, undefined, undefined, weightGroup.weightClass));
                        }
                    }
                }
            }
        }
    }
    return groups;
}
function groupByDanRank(registrations) {
    const groups = [];
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
function groupByBeltColor(registrations) {
    const groups = [];
    // Group by simplified belt category
    const beltMap = new Map();
    for (const reg of registrations) {
        const category = getSimpleBeltCategory(reg.competitor.belt);
        if (!beltMap.has(category)) {
            beltMap.set(category, []);
        }
        beltMap.get(category).push(reg);
    }
    // Combine small groups (less than 3 competitors)
    const entries = Array.from(beltMap.entries());
    const combined = [];
    let pending = null;
    for (const [belt, regs] of entries) {
        if (regs.length < 3 && pending) {
            // Combine with pending
            pending.belts.push(belt);
            pending.registrations.push(...regs);
        }
        else if (regs.length < 3) {
            // Start new pending group
            pending = { belts: [belt], registrations: [...regs] };
        }
        else {
            // Push pending if exists
            if (pending) {
                if (pending.registrations.length >= 2) {
                    combined.push(pending);
                }
                else {
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
function groupByWeightClass(registrations, gender, ageGroup) {
    const groups = new Map();
    for (const reg of registrations) {
        const weight = reg.weightAtRegistration || reg.competitor.weightLbs || 0;
        const age = reg.ageAtTournament || 0;
        const weightClass = getWeightClass(weight, age, gender) || 'Unassigned';
        if (!groups.has(weightClass)) {
            groups.set(weightClass, []);
        }
        groups.get(weightClass).push(reg);
    }
    return Array.from(groups.entries()).map(([weightClass, regs]) => ({
        weightClass,
        registrations: regs,
    }));
}
function createDivisionGroup(registrations, beltLevel, gender, eventType, ageGroup, beltColors, danMin, danMax, weightClass) {
    // Generate name
    const genderName = gender === 'M' ? 'Males' : 'Females';
    const eventName = eventType === 'patterns' ? 'Patterns' : 'Sparring';
    let beltPart = '';
    if (beltLevel === 'BB') {
        if (danMin !== undefined && danMax !== undefined) {
            if (danMin === danMax) {
                beltPart = `BB ${formatDan(danMin)} Dan`;
            }
            else {
                beltPart = `BB ${formatDan(danMin)}-${formatDan(danMax)} Dan`;
            }
        }
        else {
            beltPart = 'BB';
        }
    }
    else {
        if (beltColors.length === 1) {
            beltPart = `CB-All ${beltColors[0]} Belts`;
        }
        else {
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
function formatDan(dan) {
    if (dan === 1)
        return '1st';
    if (dan === 2)
        return '2nd';
    if (dan === 3)
        return '3rd';
    return `${dan}th`;
}
function splitDivision(group, threshold, config) {
    const count = group.registrations.length;
    const numDivisions = Math.ceil(count / threshold);
    const perDivision = Math.ceil(count / numDivisions);
    // Use smart splitting if enabled
    if (config?.enableSmartSplitting) {
        return smartSplitDivision(group, numDivisions, perDivision, config);
    }
    // Default: Sort by school to distribute evenly
    const sorted = [...group.registrations].sort((a, b) => (a.competitor.schoolDojang || '').localeCompare(b.competitor.schoolDojang || ''));
    // Interleave by school
    const schools = new Map();
    for (const reg of sorted) {
        const school = reg.competitor.schoolDojang || 'Unknown';
        if (!schools.has(school)) {
            schools.set(school, []);
        }
        schools.get(school).push(reg);
    }
    const interleaved = [];
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
    const divisions = [];
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
function smartSplitDivision(group, numDivisions, perDivision, config) {
    const eventType = group.eventType;
    // Calculate estimated skill for each competitor
    const withSkill = group.registrations.map((reg) => ({
        reg,
        skill: getInitialSkillEstimate(reg.competitor.belt, reg.competitor.danRank, eventType),
        school: reg.competitor.schoolDojang || 'Unknown',
    }));
    // Sort by skill descending
    withSkill.sort((a, b) => b.skill - a.skill);
    // Initialize divisions with target sizes
    const divisions = [];
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
            if (div.registrations.length >= perDivision)
                continue;
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
        }
        else if (divIndex < 0) {
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
function smartMergeDivisions(groups, config) {
    if (!config.enableSmartMerging)
        return groups;
    const minSize = DIVISION_SIZE_CONFIG.minSize;
    const merged = [];
    const processed = new Set();
    // Sort by belt level, gender, event type, age
    const sorted = [...groups].sort((a, b) => {
        if (a.beltLevel !== b.beltLevel)
            return a.beltLevel.localeCompare(b.beltLevel);
        if (a.gender !== b.gender)
            return a.gender.localeCompare(b.gender);
        if (a.eventType !== b.eventType)
            return a.eventType.localeCompare(b.eventType);
        return a.ageMin - b.ageMin;
    });
    for (let i = 0; i < sorted.length; i++) {
        if (processed.has(i))
            continue;
        const current = sorted[i];
        // If current is too small, try to merge with adjacent
        if (current.registrations.length < minSize) {
            // Look for adjacent group to merge with
            let mergeCandidate = null;
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
                // Merge the divisions
                const mergedGroup = mergeTwoDivisions(current, mergeCandidate);
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
 * Check if two divisions can be merged
 */
function canMerge(a, b) {
    // Must match on these criteria
    if (a.beltLevel !== b.beltLevel)
        return false;
    if (a.gender !== b.gender)
        return false;
    if (a.eventType !== b.eventType)
        return false;
    // Age groups must be adjacent
    const ageAdjacent = a.ageMax + 1 === b.ageMin || b.ageMax + 1 === a.ageMin;
    if (!ageAdjacent)
        return false;
    // Belt colors should be similar or adjacent
    const beltsOverlap = a.beltColors.some(belt => b.beltColors.includes(belt));
    const beltOrder = ['White', 'Yellow', 'Green', 'Blue', 'Red'];
    const aMaxBeltIdx = Math.max(...a.beltColors.map(b => beltOrder.indexOf(b)));
    const bMinBeltIdx = Math.min(...b.beltColors.map(b => beltOrder.indexOf(b)));
    const beltsAdjacent = Math.abs(aMaxBeltIdx - bMinBeltIdx) <= 1;
    if (!beltsOverlap && !beltsAdjacent)
        return false;
    // For sparring, weight classes should match or be adjacent
    if (a.eventType === 'sparring' && a.weightClass && b.weightClass) {
        if (a.weightClass !== b.weightClass)
            return false;
    }
    // Combined size shouldn't exceed max
    const combinedSize = a.registrations.length + b.registrations.length;
    if (combinedSize > DIVISION_SIZE_CONFIG.maxSize)
        return false;
    return true;
}
/**
 * Merge two divisions into one
 */
function mergeTwoDivisions(a, b) {
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
        : a.danMin || b.danMin;
    const danMax = a.danMax !== undefined && b.danMax !== undefined
        ? Math.max(a.danMax, b.danMax)
        : a.danMax || b.danMax;
    // Generate merged name
    const genderName = a.gender === 'M' ? 'Males' : 'Females';
    const eventName = a.eventType === 'patterns' ? 'Patterns' : 'Sparring';
    const ageLabel = `${ageMin}-${ageMax}`;
    let beltPart = '';
    if (a.beltLevel === 'BB') {
        beltPart = 'BB';
        if (danMin !== undefined && danMax !== undefined) {
            if (danMin === danMax) {
                beltPart = `BB ${formatDan(danMin)} Dan`;
            }
            else {
                beltPart = `BB ${formatDan(danMin)}-${formatDan(danMax)} Dan`;
            }
        }
    }
    else {
        beltPart = `CB-All ${beltColors.join('/')} Belts`;
    }
    let name = `${ageLabel} ${beltPart} ${genderName} ${eventName}`;
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
function validateGroup(group) {
    const warnings = [];
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
