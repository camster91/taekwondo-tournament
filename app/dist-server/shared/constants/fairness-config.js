// Fairness configuration constants for tournament matching algorithms
// Fairness scoring weights by event type
export const FAIRNESS_WEIGHTS = {
    patterns: {
        experience: 0.35, // Tournament/training experience
        skill: 0.40, // Skill rating match
        school: 0.15, // School diversity
        noRematch: 0.10, // Avoid recent rematches
    },
    sparring: {
        weight: 0.25, // Weight proximity
        height: 0.15, // Height differential
        reach: 0.10, // Reach advantage
        experience: 0.15, // Experience match
        skill: 0.20, // Skill rating match
        school: 0.10, // School diversity
        noRematch: 0.05, // Avoid rematches
    },
};
// Experience score calculation weights
export const EXPERIENCE_WEIGHTS = {
    danRank: 0.30, // Dan rank for black belts
    beltAge: 0.20, // Time in current belt
    tournamentCount: 0.25, // Number of past tournaments
    placementHistory: 0.25, // Weighted past placements
};
// ELO rating system configuration
export const RATING_CONFIG = {
    initialRating: 1000, // Starting ELO rating
    kFactorNew: 40, // Higher K for new competitors (< 10 matches)
    kFactorIntermediate: 32, // Medium K (10-30 matches)
    kFactorExperienced: 24, // Lower K for veterans (30+ matches)
    decayPerMonth: 5, // Rating decay per month of inactivity
    maxDecay: 100, // Maximum rating decay
    inactivityThreshold: 6, // Months before decay starts
};
// Physical matching thresholds by age group (for sparring)
export const PHYSICAL_THRESHOLDS = {
    weight: {
        '4-5': 5, // Max 5 lbs difference
        '6-7': 8,
        '8-9': 10,
        '10-11': 12,
        '12-14': 15,
        '15-17': 20,
        '18-35': 25,
        '36+': 25,
    },
    height: {
        '4-5': 3, // Max 3 inches difference
        '6-7': 4,
        '8-9': 5,
        '10-11': 6,
        '12-14': 7,
        '15-17': 8,
        '18-35': 10,
        '36+': 10,
    },
    reach: {
        significant: 3, // Reach advantage > 3 inches is significant
        critical: 5, // Reach advantage > 5 inches needs review
    },
};
// Division size constraints
export const DIVISION_SIZE_CONFIG = {
    minSize: 3, // Minimum competitors per division
    optimalSize: 8, // Ideal size for brackets
    maxSize: 16, // Max before splitting
    mergeThreshold: 4, // Consider merging if below this
    splitThreshold: 10, // Consider splitting if above this
};
// Age boundary flexibility configuration
export const AGE_BOUNDARY_CONFIG = {
    allowFlexibility: true,
    toleranceMonths: 6, // Allow 6 months flexibility at boundaries
    ageBoundaries: [5, 7, 9, 11, 14, 17, 35], // Standard age group cutoffs
    preferUpward: true, // Prefer moving up rather than down
};
// Rematch avoidance configuration
export const REMATCH_CONFIG = {
    avoidRecentTournaments: 3, // Avoid rematches from last N tournaments
    allowFinalRematch: true, // Allow rematches in finals (dramatic)
    minMatchesBetween: 2, // Min matches since last encounter
};
// Seeding strategy options
export const SEEDING_STRATEGIES = {
    random: 'random', // Completely random (with school spread)
    school_spread: 'school_spread', // Avoid same-school first round
    skill_based: 'skill_based', // ATP/WTA style seeding by rating
    balanced: 'balanced', // Balance skill across bracket halves
    fairness_optimized: 'fairness_optimized', // Optimize first-round matchups
};
// Skill rating estimation by belt level (for new competitors)
export const INITIAL_SKILL_ESTIMATES = {
    patterns: {
        White: 800,
        Yellow: 900,
        Green: 1000,
        Blue: 1100,
        Red: 1200,
        Black: {
            1: 1300, // 1st Dan
            2: 1400, // 2nd Dan
            3: 1500, // 3rd Dan
            4: 1600, // 4th Dan
            5: 1700, // 5th Dan
            6: 1800, // 6th Dan
        },
    },
    sparring: {
        White: 800,
        Yellow: 900,
        Green: 1000,
        Blue: 1100,
        Red: 1200,
        Black: {
            1: 1250, // 1st Dan
            2: 1350, // 2nd Dan
            3: 1450, // 3rd Dan
            4: 1550, // 4th Dan
            5: 1650, // 5th Dan
            6: 1750, // 6th Dan
        },
    },
};
// Placement point values for experience scoring
export const PLACEMENT_POINTS = {
    1: 100, // Gold
    2: 75, // Silver
    3: 50, // Bronze
    4: 25, // 4th place
    5: 10, // Participation
};
// Weight decay for older tournament results
export const TOURNAMENT_RECENCY_WEIGHTS = {
    0: 1.0, // Current tournament
    1: 0.9, // 1 tournament ago
    2: 0.75, // 2 tournaments ago
    3: 0.6, // 3 tournaments ago
    4: 0.45, // 4 tournaments ago
    5: 0.3, // 5+ tournaments ago
};
// Fairness score thresholds
export const FAIRNESS_THRESHOLDS = {
    excellent: 85, // 85-100: Excellent match
    good: 70, // 70-84: Good match
    acceptable: 55, // 55-69: Acceptable match
    poor: 40, // 40-54: Poor match (flag for review)
    critical: 0, // 0-39: Critical mismatch (should not proceed)
};
// Get K-factor based on matches played
export function getKFactor(matchesPlayed) {
    if (matchesPlayed < 10)
        return RATING_CONFIG.kFactorNew;
    if (matchesPlayed < 30)
        return RATING_CONFIG.kFactorIntermediate;
    return RATING_CONFIG.kFactorExperienced;
}
// Get age group string for thresholds
export function getAgeGroupKey(ageMin, ageMax) {
    return `${ageMin}-${ageMax}`;
}
// Get initial skill estimate for a competitor
export function getInitialSkillEstimate(belt, danRank, eventType) {
    const estimates = INITIAL_SKILL_ESTIMATES[eventType];
    if (belt.toLowerCase() === 'black' && danRank) {
        const blackRatings = estimates.Black;
        const danKey = Math.min(danRank, 6);
        return blackRatings[danKey] || blackRatings[1];
    }
    // Normalize belt name
    const normalizedBelt = belt.split('/')[0].trim();
    // Map belt names to ratings
    const beltRatings = {
        white: estimates.White,
        yellow: estimates.Yellow,
        green: estimates.Green,
        blue: estimates.Blue,
        red: estimates.Red,
    };
    return beltRatings[normalizedBelt.toLowerCase()] || 800;
}
