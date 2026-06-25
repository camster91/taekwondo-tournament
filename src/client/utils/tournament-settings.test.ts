import { describe, it, expect } from 'vitest';

// Mirror the parser from PublicRegister.tsx. We don't import the page
// directly because that pulls in the full form + router stack.
interface TournamentSettings {
  tournamentFeeCents?: number;
  feeNotes?: string;
  [key: string]: unknown;
}

function parseTournamentSettings(raw: string | null | undefined): TournamentSettings {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as TournamentSettings) : {};
  } catch {
    return {};
  }
}

describe('parseTournamentSettings (F9 fee parser)', () => {
  it('returns empty object for null', () => {
    expect(parseTournamentSettings(null)).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(parseTournamentSettings(undefined)).toEqual({});
  });

  it('returns empty object for empty string', () => {
    expect(parseTournamentSettings('')).toEqual({});
  });

  it('returns empty object for invalid JSON', () => {
    expect(parseTournamentSettings('not-json')).toEqual({});
  });

  it('returns empty object for JSON non-object (e.g. number)', () => {
    expect(parseTournamentSettings('42')).toEqual({});
  });

  it('parses tournamentFeeCents and feeNotes from a real settings blob', () => {
    const raw = JSON.stringify({ tournamentFeeCents: 2500, feeNotes: 'Pay at door' });
    expect(parseTournamentSettings(raw)).toEqual({
      tournamentFeeCents: 2500,
      feeNotes: 'Pay at door',
    });
  });

  it('preserves unknown keys (forward-compat with future settings)', () => {
    const raw = JSON.stringify({
      tournamentFeeCents: 1500,
      feeNotes: '',
      divisionThreshold: 8,
    });
    expect(parseTournamentSettings(raw)).toEqual({
      tournamentFeeCents: 1500,
      feeNotes: '',
      divisionThreshold: 8,
    });
  });

  it('handles 0-cent fee (free event)', () => {
    const raw = JSON.stringify({ tournamentFeeCents: 0, feeNotes: 'Free event' });
    expect(parseTournamentSettings(raw)).toEqual({
      tournamentFeeCents: 0,
      feeNotes: 'Free event',
    });
  });
});
