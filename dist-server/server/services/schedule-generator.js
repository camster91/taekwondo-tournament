const DEFAULT_CONFIG = {
    startTime: '09:00',
    endTime: '17:00',
    ringCount: 4,
    matchDurationMinutes: {
        patterns: 3,
        sparring: 5,
    },
    breakBetweenDivisions: 5,
};
// Helper to parse time string to minutes since midnight
function timeToMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}
// Helper to convert minutes since midnight to time string
function minutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}
// Estimate duration for a division based on bracket structure
function estimateDivisionDuration(competitorCount, eventType, config) {
    // For double elimination, total matches ≈ 2 * (n - 1) where n is competitors
    // But many are BYEs in first round, so we use: ceil(log2(n)) rounds
    // Simplified: assume ~n matches for small brackets
    const matchDuration = eventType === 'patterns'
        ? config.matchDurationMinutes.patterns
        : config.matchDurationMinutes.sparring;
    // For 8 competitors: roughly 14 matches in double elimination
    // But with BYEs, closer to 10-12 actual matches
    const estimatedMatches = Math.min(competitorCount * 1.5, competitorCount * 2 - 1);
    const totalTime = Math.ceil(estimatedMatches * matchDuration);
    // Minimum 10 minutes, maximum 90 minutes per division
    return Math.max(10, Math.min(90, totalTime));
}
export async function generateSchedule(prisma, tournamentId, configOverrides) {
    const config = { ...DEFAULT_CONFIG, ...configOverrides };
    const warnings = [];
    // Get tournament and divisions
    const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
    });
    if (!tournament) {
        throw new Error('Tournament not found');
    }
    const divisions = await prisma.division.findMany({
        where: { tournamentId },
        include: {
            _count: {
                select: { assignments: true },
            },
        },
        orderBy: [
            { eventType: 'asc' }, // Patterns first, then sparring
            { beltLevel: 'asc' }, // BB then CB
            { gender: 'asc' },
            { ageMin: 'asc' },
        ],
    });
    if (divisions.length === 0) {
        return {
            tournamentId,
            tournamentName: tournament.name,
            date: tournament.date.toISOString(),
            config,
            schedule: [],
            warnings: ['No divisions found. Generate divisions first.'],
        };
    }
    // Initialize ring schedules (track current time for each ring)
    const ringSchedules = Array(config.ringCount).fill(timeToMinutes(config.startTime));
    const endTimeMinutes = timeToMinutes(config.endTime);
    // Group divisions by event type and category for better scheduling
    const patternsDiv = divisions.filter((d) => d.eventType === 'patterns');
    const sparringDiv = divisions.filter((d) => d.eventType === 'sparring');
    // Schedule patterns first (typically shorter)
    const scheduled = [];
    // Function to schedule a division on the least busy ring
    const scheduleDivision = (div) => {
        const duration = estimateDivisionDuration(div._count.assignments, div.eventType, config);
        // Find ring with earliest available time
        const ringIndex = ringSchedules.indexOf(Math.min(...ringSchedules));
        const startTimeMinutes = ringSchedules[ringIndex];
        const endTimeDivision = startTimeMinutes + duration;
        if (endTimeDivision > endTimeMinutes) {
            warnings.push(`Division "${div.name}" may run past end time (scheduled to end at ${minutesToTime(endTimeDivision)})`);
        }
        scheduled.push({
            divisionId: div.id,
            divisionName: div.name,
            eventType: div.eventType,
            beltLevel: div.beltLevel,
            gender: div.gender,
            competitorCount: div._count.assignments,
            ring: ringIndex + 1, // 1-indexed
            startTime: minutesToTime(startTimeMinutes),
            endTime: minutesToTime(endTimeDivision),
            estimatedDurationMinutes: duration,
        });
        // Update ring schedule with break
        ringSchedules[ringIndex] = endTimeDivision + config.breakBetweenDivisions;
    };
    // Schedule patterns divisions
    patternsDiv.forEach(scheduleDivision);
    // Add a buffer between patterns and sparring
    const maxPatternsEnd = Math.max(...ringSchedules);
    for (let i = 0; i < ringSchedules.length; i++) {
        ringSchedules[i] = Math.max(ringSchedules[i], maxPatternsEnd);
    }
    // Schedule sparring divisions
    sparringDiv.forEach(scheduleDivision);
    // Sort schedule by start time then ring
    scheduled.sort((a, b) => {
        const timeCompare = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
        if (timeCompare !== 0)
            return timeCompare;
        return a.ring - b.ring;
    });
    // Check for late end time
    const latestEnd = Math.max(...scheduled.map((s) => timeToMinutes(s.endTime)));
    if (latestEnd > endTimeMinutes) {
        warnings.push(`Schedule extends past end time. Latest event ends at ${minutesToTime(latestEnd)}`);
    }
    return {
        tournamentId,
        tournamentName: tournament.name,
        date: tournament.date.toISOString(),
        config,
        schedule: scheduled,
        warnings,
    };
}
