export const DEFAULT_AGE_GROUPS = [
    { min: 4, max: 5, label: '4-5' },
    { min: 6, max: 7, label: '6-7' },
    { min: 8, max: 9, label: '8-9' },
    { min: 10, max: 11, label: '10-11' },
    { min: 12, max: 14, label: '12-14' },
    { min: 15, max: 17, label: '15-17' },
    { min: 18, max: 35, label: '18-35' },
    { min: 36, max: 99, label: '36+' },
];
// Black Belt specific age groups (sometimes different)
export const BB_AGE_GROUPS = [
    { min: 4, max: 11, label: '11 and Under' },
    { min: 12, max: 13, label: '12-13' },
    { min: 14, max: 15, label: '14-15' },
    { min: 16, max: 17, label: '16-17' },
    { min: 18, max: 35, label: '18-35' },
    { min: 36, max: 99, label: '36+' },
];
export function getAgeGroup(age, groups = DEFAULT_AGE_GROUPS) {
    return groups.find(g => age >= g.min && age <= g.max) || null;
}
export function calculateAge(dateOfBirth, tournamentDate) {
    const birth = new Date(dateOfBirth);
    const tournament = new Date(tournamentDate);
    let age = tournament.getFullYear() - birth.getFullYear();
    const monthDiff = tournament.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && tournament.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}
