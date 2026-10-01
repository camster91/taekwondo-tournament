import { describe, expect, it, vi } from 'vitest';
import { recomputeRegistrationAges } from './registration-age';
import { calculateAge } from '../../shared/constants/age-groups';

function clientWith(rows: Array<{ id: string; ageAtTournament: number | null; dob: string; date: string }>) {
  return {
    registration: {
      findMany: vi.fn().mockResolvedValue(rows.map((row) => ({
        id: row.id,
        ageAtTournament: row.ageAtTournament,
        competitor: { dateOfBirth: new Date(row.dob) },
        tournament: { date: new Date(row.date) },
      }))),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('recomputeRegistrationAges', () => {
  it('refreshes stale ages after the tournament date moves past a birthday', async () => {
    // Registered when the tournament was 2026-05-01 (age 9); the date
    // moved to 2026-07-01, after the 2026-06-15 birthday.
    const client = clientWith([
      { id: 'r1', ageAtTournament: 9, dob: '2016-06-15T12:00:00Z', date: '2026-07-01T12:00:00Z' },
      { id: 'r2', ageAtTournament: 12, dob: '2014-01-10T12:00:00Z', date: '2026-07-01T12:00:00Z' },
    ]);

    const updated = await recomputeRegistrationAges(client as never, { tournamentId: 't1' });

    expect(client.registration.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tournamentId: 't1' } }));
    expect(updated).toBe(1);
    expect(client.registration.update).toHaveBeenCalledTimes(1);
    expect(client.registration.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { ageAtTournament: 10 } });
  });

  it('uses the same age function as registration creation', async () => {
    const dob = '2015-03-20T12:00:00Z';
    const date = '2026-03-19T12:00:00Z';
    const client = clientWith([{ id: 'r1', ageAtTournament: null, dob, date }]);

    await recomputeRegistrationAges(client as never, { competitorId: 'c1' });

    expect(client.registration.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { ageAtTournament: calculateAge(new Date(dob), new Date(date)) },
    });
  });
});
