const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object');
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const nullableNumber = (value: unknown) => value === null || typeof value === 'number';

function isCompetitor(value: unknown): boolean {
  if (!isObject(value) || typeof value.id !== 'string' || !isObject(value.competitor)) return false;
  const person = value.competitor;
  return typeof person.firstName === 'string' && typeof person.lastName === 'string'
    && nullableString(person.schoolDojang)
    && (person.specialNeeds === undefined || nullableString(person.specialNeeds));
}

export function isCheckInRegistrationData(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.every((row) => {
    if (!isObject(row) || !isObject(row.competitor)) return false;
    const person = row.competitor;
    return typeof row.id === 'string' && typeof row.patterns === 'boolean' && typeof row.sparring === 'boolean'
      && nullableNumber(row.weightAtRegistration) && nullableNumber(row.ageAtTournament)
      && typeof row.checkedIn === 'boolean' && nullableString(row.checkInTime) && nullableNumber(row.checkInWeight)
      && typeof person.id === 'string' && typeof person.firstName === 'string' && typeof person.lastName === 'string'
      && typeof person.gender === 'string' && typeof person.belt === 'string'
      && nullableString(person.schoolDojang) && nullableNumber(person.weightLbs);
  });
}

export function isScorekeeperDivisionData(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.every((division) => {
    if (!isObject(division) || typeof division.id !== 'string' || typeof division.name !== 'string'
      || typeof division.eventType !== 'string') return false;
    if (division.bracket === null) return true;
    if (!isObject(division.bracket) || typeof division.bracket.id !== 'string' || !Array.isArray(division.bracket.matches)) return false;
    return division.bracket.matches.every((match) => {
      if (!isObject(match)) return false;
      return typeof match.id === 'string' && typeof match.matchNumber === 'number'
        && typeof match.roundNumber === 'number' && typeof match.bracketType === 'string'
        && (match.ringNumber === undefined || nullableNumber(match.ringNumber))
        && typeof match.status === 'string' && nullableString(match.score1) && nullableString(match.score2)
        && nullableString(match.winnerId)
        && (match.competitor1 === null || isCompetitor(match.competitor1))
        && (match.competitor2 === null || isCompetitor(match.competitor2));
    });
  });
}
