// ─── TAEKWONDO ────────────────────────────────────────────────────────────────
export const TAEKWONDO_PROFILE = {
    id: 'taekwondo',
    name: 'Taekwondo',
    slug: 'taekwondo',
    icon: '🥋',
    description: 'Olympic martial art featuring kicks and strikes',
    eventTypes: [
        { id: 'patterns', name: 'Patterns', description: 'Poomsae / Forms competition', hasWeightClasses: false, isCombat: false },
        { id: 'sparring', name: 'Sparring', description: 'Kyorugi / Point sparring', hasWeightClasses: true, isCombat: true },
    ],
    beltConfig: {
        levels: [
            { name: 'White', abbreviation: 'W', rank: 1, color: '#FFFFFF', isTopLevel: false },
            { name: 'Yellow', abbreviation: 'Y', rank: 2, color: '#FFD700', isTopLevel: false },
            { name: 'Green', abbreviation: 'G', rank: 3, color: '#22C55E', isTopLevel: false },
            { name: 'Blue', abbreviation: 'B', rank: 4, color: '#3B82F6', isTopLevel: false },
            { name: 'Red', abbreviation: 'R', rank: 5, color: '#EF4444', isTopLevel: false },
            { name: 'Black', abbreviation: 'BB', rank: 6, color: '#111827', isTopLevel: true },
        ],
        hasStripes: true,
        hasDanRank: true,
        topLevelName: 'Black Belt',
        topLevelAbbreviation: 'BB',
    },
    scoringConfig: {
        type: 'points',
        hasPenalties: true,
        penaltyName: 'Gamjeon',
        hasRounds: true,
        defaultRounds: 3,
        defaultRoundDurationSeconds: 90,
    },
};
// ─── KARATE ───────────────────────────────────────────────────────────────────
export const KARATE_PROFILE = {
    id: 'karate',
    name: 'Karate',
    slug: 'karate',
    icon: '🥊',
    description: 'Traditional Japanese martial art',
    eventTypes: [
        { id: 'kata', name: 'Kata', description: 'Forms / pattern competition', hasWeightClasses: false, isCombat: false },
        { id: 'kumite', name: 'Kumite', description: 'Sparring / fighting competition', hasWeightClasses: true, isCombat: true },
    ],
    beltConfig: {
        levels: [
            { name: 'White', abbreviation: 'W', rank: 1, color: '#FFFFFF', isTopLevel: false },
            { name: 'Orange', abbreviation: 'O', rank: 2, color: '#F97316', isTopLevel: false },
            { name: 'Blue', abbreviation: 'B', rank: 3, color: '#3B82F6', isTopLevel: false },
            { name: 'Yellow', abbreviation: 'Y', rank: 4, color: '#FFD700', isTopLevel: false },
            { name: 'Green', abbreviation: 'G', rank: 5, color: '#22C55E', isTopLevel: false },
            { name: 'Purple', abbreviation: 'P', rank: 6, color: '#A855F7', isTopLevel: false },
            { name: 'Brown', abbreviation: 'BR', rank: 7, color: '#92400E', isTopLevel: false },
            { name: 'Black', abbreviation: 'BB', rank: 8, color: '#111827', isTopLevel: true },
        ],
        hasStripes: true,
        hasDanRank: true,
        topLevelName: 'Black Belt',
        topLevelAbbreviation: 'BB',
    },
    scoringConfig: {
        type: 'points',
        hasPenalties: true,
        penaltyName: 'Shido',
        hasRounds: true,
        defaultRounds: 1,
        defaultRoundDurationSeconds: 180,
    },
};
// ─── JUDO ─────────────────────────────────────────────────────────────────────
export const JUDO_PROFILE = {
    id: 'judo',
    name: 'Judo',
    slug: 'judo',
    icon: '🤼',
    description: 'Olympic grappling art focused on throws and pins',
    eventTypes: [
        { id: 'randori', name: 'Randori', description: 'Competitive fighting', hasWeightClasses: true, isCombat: true },
        { id: 'kata', name: 'Kata', description: 'Paired forms demonstration', hasWeightClasses: false, isCombat: false },
    ],
    beltConfig: {
        levels: [
            { name: 'White', abbreviation: 'W', rank: 1, color: '#FFFFFF', isTopLevel: false },
            { name: 'Yellow', abbreviation: 'Y', rank: 2, color: '#FFD700', isTopLevel: false },
            { name: 'Orange', abbreviation: 'O', rank: 3, color: '#F97316', isTopLevel: false },
            { name: 'Green', abbreviation: 'G', rank: 4, color: '#22C55E', isTopLevel: false },
            { name: 'Blue', abbreviation: 'B', rank: 5, color: '#3B82F6', isTopLevel: false },
            { name: 'Brown', abbreviation: 'BR', rank: 6, color: '#92400E', isTopLevel: false },
            { name: 'Black', abbreviation: 'BB', rank: 7, color: '#111827', isTopLevel: true },
        ],
        hasStripes: false,
        hasDanRank: true,
        topLevelName: 'Dan',
        topLevelAbbreviation: 'BB',
    },
    scoringConfig: {
        type: 'submission',
        hasPenalties: true,
        penaltyName: 'Shido',
        hasRounds: false,
        defaultRounds: 1,
        defaultRoundDurationSeconds: 240,
    },
};
// ─── WRESTLING ────────────────────────────────────────────────────────────────
export const WRESTLING_PROFILE = {
    id: 'wrestling',
    name: 'Wrestling',
    slug: 'wrestling',
    icon: '🤸',
    description: 'Competitive grappling sport with weight classes',
    eventTypes: [
        { id: 'freestyle', name: 'Freestyle', description: 'Freestyle wrestling', hasWeightClasses: true, isCombat: true },
        { id: 'folkstyle', name: 'Folkstyle', description: 'Scholastic / collegiate wrestling', hasWeightClasses: true, isCombat: true },
    ],
    beltConfig: {
        levels: [
            { name: 'Novice', abbreviation: 'N', rank: 1, color: '#6B7280', isTopLevel: false },
            { name: 'Intermediate', abbreviation: 'I', rank: 2, color: '#3B82F6', isTopLevel: false },
            { name: 'Advanced', abbreviation: 'A', rank: 3, color: '#EF4444', isTopLevel: true },
        ],
        hasStripes: false,
        hasDanRank: false,
        topLevelName: 'Advanced',
        topLevelAbbreviation: 'ADV',
    },
    scoringConfig: {
        type: 'points',
        hasPenalties: false,
        penaltyName: 'Penalty',
        hasRounds: true,
        defaultRounds: 3,
        defaultRoundDurationSeconds: 120,
    },
};
// ─── BJJ ──────────────────────────────────────────────────────────────────────
export const BJJ_PROFILE = {
    id: 'bjj',
    name: 'Brazilian Jiu-Jitsu',
    slug: 'bjj',
    icon: '🥋',
    description: 'Ground-based grappling martial art',
    eventTypes: [
        { id: 'gi', name: 'Gi', description: 'Traditional uniform competition', hasWeightClasses: true, isCombat: true },
        { id: 'nogi', name: 'No-Gi', description: 'Without uniform competition', hasWeightClasses: true, isCombat: true },
    ],
    beltConfig: {
        levels: [
            { name: 'White', abbreviation: 'W', rank: 1, color: '#FFFFFF', isTopLevel: false },
            { name: 'Blue', abbreviation: 'B', rank: 2, color: '#3B82F6', isTopLevel: false },
            { name: 'Purple', abbreviation: 'P', rank: 3, color: '#A855F7', isTopLevel: false },
            { name: 'Brown', abbreviation: 'BR', rank: 4, color: '#92400E', isTopLevel: false },
            { name: 'Black', abbreviation: 'BB', rank: 5, color: '#111827', isTopLevel: true },
        ],
        hasStripes: true,
        hasDanRank: false,
        topLevelName: 'Black Belt',
        topLevelAbbreviation: 'BB',
    },
    scoringConfig: {
        type: 'submission',
        hasPenalties: true,
        penaltyName: 'Penalty',
        hasRounds: false,
        defaultRounds: 1,
        defaultRoundDurationSeconds: 300,
    },
};
// ─── All profiles ─────────────────────────────────────────────────────────────
export const SPORT_PROFILES = [
    TAEKWONDO_PROFILE,
    KARATE_PROFILE,
    JUDO_PROFILE,
    WRESTLING_PROFILE,
    BJJ_PROFILE,
];
export function getSportProfile(slug) {
    return SPORT_PROFILES.find(p => p.slug === slug);
}
export function getSportEventType(sportSlug, eventTypeId) {
    const profile = getSportProfile(sportSlug);
    return profile?.eventTypes.find(e => e.id === eventTypeId);
}
// Map legacy boolean fields (patterns/sparring) to sport event types
export function getEventTypeLabel(sportSlug, eventId) {
    const profile = getSportProfile(sportSlug);
    if (!profile)
        return eventId;
    // Try direct ID match first
    const exact = profile.eventTypes.find(e => e.id === eventId);
    if (exact)
        return exact.name;
    // Legacy mapping: patterns -> first non-combat, sparring -> first combat
    if (eventId === 'patterns') {
        return profile.eventTypes.find(e => !e.isCombat)?.name ?? 'Patterns';
    }
    if (eventId === 'sparring') {
        return profile.eventTypes.find(e => e.isCombat)?.name ?? 'Sparring';
    }
    return eventId;
}
export function getBeltLevelLabel(sportSlug, belt) {
    const profile = getSportProfile(sportSlug);
    if (!profile)
        return belt;
    const level = profile.beltConfig.levels.find(l => l.name.toLowerCase() === belt.toLowerCase());
    return level?.name ?? belt;
}
export function isTopLevelBelt(sportSlug, belt) {
    const profile = getSportProfile(sportSlug);
    if (!profile)
        return belt.toLowerCase() === 'black';
    return profile.beltConfig.levels.find(l => l.name.toLowerCase() === belt.toLowerCase())?.isTopLevel ?? false;
}
