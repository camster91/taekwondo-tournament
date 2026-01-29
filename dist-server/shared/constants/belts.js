// Belt hierarchy and classifications
export const COLORED_BELTS = [
    'White',
    'White / Single Yellow Stripe',
    'White / Double Yellow Stripe',
    'Yellow',
    'Yellow / Single Green Stripe',
    'Yellow / Double Green Stripe',
    'Green',
    'Green / Single Blue Stripe',
    'Green / Double Blue Stripe',
    'Blue',
    'Blue / Single Red Stripe',
    'Blue / Double Red Stripe',
    'Red',
    'Red / Single Black Stripe',
    'Red / Double Black Stripe',
];
export const BLACK_BELT_RANKS = [1, 2, 3, 4, 5, 6];
// Simplified belt categories for grouping
export const BELT_CATEGORIES = {
    White: ['White', 'White / Single Yellow Stripe', 'White / Double Yellow Stripe'],
    Yellow: ['Yellow', 'Yellow / Single Green Stripe', 'Yellow / Double Green Stripe'],
    Green: ['Green', 'Green / Single Blue Stripe', 'Green / Double Blue Stripe'],
    Blue: ['Blue', 'Blue / Single Red Stripe', 'Blue / Double Red Stripe'],
    Red: ['Red', 'Red / Single Black Stripe', 'Red / Double Black Stripe'],
    Black: ['Black'],
};
// Belt normalization for imports
export const BELT_ALIASES = {
    'W': 'White',
    'WHITE': 'White',
    'Y': 'Yellow',
    'YELLOW': 'Yellow',
    'G': 'Green',
    'GREEN': 'Green',
    'B': 'Blue',
    'BLUE': 'Blue',
    'R': 'Red',
    'RED': 'Red',
    'BL': 'Black',
    'BLACK': 'Black',
    'BB': 'Black',
};
// Common belt groupings used in divisions
export const BELT_GROUPINGS = {
    'All Belts': ['White', 'Yellow', 'Green', 'Blue', 'Red'],
    'White/Yellow': ['White', 'Yellow'],
    'Green/Blue': ['Green', 'Blue'],
    'Blue/Red': ['Blue', 'Red'],
    'White to Blue': ['White', 'Yellow', 'Green', 'Blue'],
    'Yellow to Red': ['Yellow', 'Green', 'Blue', 'Red'],
};
export function isBlackBelt(belt) {
    return belt.toLowerCase() === 'black';
}
export function getBeltLevel(belt) {
    return isBlackBelt(belt) ? 'BB' : 'CB';
}
export function normalizeBelt(belt) {
    const upper = belt.toUpperCase().trim();
    return BELT_ALIASES[upper] || belt.trim();
}
export function getSimpleBeltCategory(belt) {
    const normalized = normalizeBelt(belt);
    for (const [category, belts] of Object.entries(BELT_CATEGORIES)) {
        if (belts.some(b => normalized.toLowerCase().includes(b.toLowerCase()))) {
            return category;
        }
    }
    return normalized;
}
