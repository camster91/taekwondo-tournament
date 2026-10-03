import { describe, expect, it } from 'vitest';
import { specialNeedsByDivision, specialNeedsText } from './special-needs';

describe('specialNeedsText', () => {
  it('returns null when there is no note', () => {
    expect(specialNeedsText(null, undefined)).toBeNull();
    expect(specialNeedsText('  ', '')).toBeNull();
  });

  it('shows one copy when both notes say the same thing', () => {
    expect(specialNeedsText('Asthma inhaler', 'asthma inhaler ')).toBe('Asthma inhaler');
    expect(specialNeedsText(null, 'Hearing aid')).toBe('Hearing aid');
  });

  it('joins different notes, this event first', () => {
    expect(specialNeedsText('Needs a quiet warm-up', 'Epipen')).toBe('Needs a quiet warm-up · Epipen');
  });
});

describe('specialNeedsByDivision', () => {
  it('groups competitors with notes under each division they are in', () => {
    const map = specialNeedsByDivision([
      {
        id: 'r1',
        specialNeeds: 'Asthma',
        competitor: { firstName: 'Ana', lastName: 'Lee', specialNeeds: null },
        assignments: [{ division: { id: 'd1' } }, { division: { id: 'd2' } }],
      },
      { id: 'r2', specialNeeds: null, competitor: { firstName: 'Bo', lastName: 'Kim' }, assignments: [{ division: { id: 'd1' } }] },
      { id: 'r3', competitor: { firstName: 'Cy', lastName: 'Ng', specialNeeds: 'Glasses' } },
    ]);
    expect(map.get('d1')).toEqual([{ registrationId: 'r1', name: 'Ana Lee', note: 'Asthma' }]);
    expect(map.get('d2')).toHaveLength(1);
    expect(map.size).toBe(2);
  });
});
