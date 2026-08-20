import { describe, it, expect } from 'vitest';
import {
  parseDisplaySettings,
  formatMatchCompetitorName,
  formatMatchSummary,
  filterFeaturedMatches,
} from './featured-match';
import type { ApiMatch } from './api-types';

describe('featured-match utilities', () => {
  describe('parseDisplaySettings', () => {
    it('returns default all mode for missing or malformed settings', () => {
      expect(parseDisplaySettings(null)).toEqual({ mode: 'all' });
      expect(parseDisplaySettings('')).toEqual({ mode: 'all' });
      expect(parseDisplaySettings('invalid json')).toEqual({ mode: 'all' });
      expect(parseDisplaySettings('{}')).toEqual({ mode: 'all' });
    });

    it('parses valid ring and featured mode settings', () => {
      const ringSettings = JSON.stringify({ display: { mode: 'ring', ringNumber: 3 } });
      expect(parseDisplaySettings(ringSettings)).toEqual({ mode: 'ring', ringNumber: 3 });

      const featuredSettings = JSON.stringify({
        display: { mode: 'featured', featuredMatchId: 'm-123' },
      });
      expect(parseDisplaySettings(featuredSettings)).toEqual({
        mode: 'featured',
        featuredMatchId: 'm-123',
      });
    });
  });

  describe('formatMatchCompetitorName and formatMatchSummary', () => {
    const match: ApiMatch = {
      id: 'm-1',
      matchNumber: 5,
      roundNumber: 2,
      bracketType: 'winners',
      status: 'in_progress',
      ringNumber: 2,
      _divisionName: 'Junior Black Belt',
      competitor1: {
        id: 'c1',
        competitor: { firstName: 'Alice', lastName: 'Wong', schoolDojang: 'Apex TKD' },
      },
      competitor2: {
        id: 'c2',
        competitor: { firstName: 'Bob', lastName: 'Lee', schoolDojang: 'Summit Martial Arts' },
      },
    };

    it('formats competitor name with school/dojang', () => {
      expect(formatMatchCompetitorName(match.competitor1)).toBe('Alice Wong (Apex TKD)');
      expect(formatMatchCompetitorName(null)).toBe('TBD');
    });

    it('formats a complete human-readable summary of the match', () => {
      expect(formatMatchSummary(match)).toBe(
        'Alice Wong (Apex TKD) vs Bob Lee (Summit Martial Arts) (Junior Black Belt · M#5, Ring 2)'
      );
    });
  });

  describe('filterFeaturedMatches', () => {
    const matches: ApiMatch[] = [
      {
        id: 'm-1',
        matchNumber: 1,
        roundNumber: 1,
        bracketType: 'winners',
        status: 'in_progress',
        ringNumber: 1,
        _divisionName: 'Adult Heavyweight',
        competitor1: { id: 'c1', competitor: { firstName: 'Charlie', lastName: 'Brown', schoolDojang: 'Toronto TKD' } },
        competitor2: { id: 'c2', competitor: { firstName: 'David', lastName: 'Smith', schoolDojang: 'York MA' } },
      },
      {
        id: 'm-2',
        matchNumber: 2,
        roundNumber: 1,
        bracketType: 'winners',
        status: 'ready',
        ringNumber: 2,
        _divisionName: 'Youth Lightweight',
        competitor1: { id: 'c3', competitor: { firstName: 'Emma', lastName: 'Watson', schoolDojang: 'Apex TKD' } },
        competitor2: { id: 'c4', competitor: { firstName: 'Fiona', lastName: 'Gallagher', schoolDojang: 'North TKD' } },
      },
    ];

    it('returns all matches on empty search query', () => {
      expect(filterFeaturedMatches(matches, '')).toHaveLength(2);
      expect(filterFeaturedMatches(matches, '   ')).toHaveLength(2);
    });

    it('filters by competitor name, division, ring, or status', () => {
      expect(filterFeaturedMatches(matches, 'charlie')).toHaveLength(1);
      expect(filterFeaturedMatches(matches, 'charlie')[0].id).toBe('m-1');

      expect(filterFeaturedMatches(matches, 'Lightweight')).toHaveLength(1);
      expect(filterFeaturedMatches(matches, 'Lightweight')[0].id).toBe('m-2');

      expect(filterFeaturedMatches(matches, 'Ring 2')).toHaveLength(1);
      expect(filterFeaturedMatches(matches, 'Ring 2')[0].id).toBe('m-2');

      expect(filterFeaturedMatches(matches, 'in_progress')).toHaveLength(1);
      expect(filterFeaturedMatches(matches, 'in_progress')[0].id).toBe('m-1');
    });
  });
});
