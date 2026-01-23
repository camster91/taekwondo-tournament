import { describe, it, expect } from 'vitest';
import { generateBracket, type CompetitorSeed } from './bracket-generator.js';

function createCompetitors(count: number, schools?: string[]): CompetitorSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    name: `Competitor ${i + 1}`,
    school: schools?.[i] || `School ${(i % 3) + 1}`,
  }));
}

describe('Bracket Generator', () => {
  describe('generateBracket', () => {
    it('should return empty structure for 0 competitors', () => {
      const result = generateBracket([]);
      expect(result.competitorCount).toBe(0);
      expect(result.winners).toHaveLength(0);
      expect(result.losers).toHaveLength(0);
      expect(result.finals).toHaveLength(0);
    });

    it('should handle single competitor', () => {
      const competitors = createCompetitors(1);
      const result = generateBracket(competitors);

      expect(result.competitorCount).toBe(1);
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].competitor1Id).toBe('reg-1');
      expect(result.winners[0].competitor2Id).toBeNull();
    });

    it('should create 2-person bracket', () => {
      const competitors = createCompetitors(2);
      const result = generateBracket(competitors);

      expect(result.competitorCount).toBe(2);
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].matchNumber).toBe(1);
      expect(result.winners[0].round).toBe(1);
    });

    it('should create 4-person double elimination bracket', () => {
      const competitors = createCompetitors(4);
      const result = generateBracket(competitors);

      expect(result.competitorCount).toBe(4);
      // 4-person bracket has 3 winners matches, 2 losers, 1 final
      expect(result.winners).toHaveLength(3);
      expect(result.losers).toHaveLength(2);
      expect(result.finals).toHaveLength(1);
    });

    it('should create 8-person double elimination bracket', () => {
      const competitors = createCompetitors(8);
      const result = generateBracket(competitors);

      expect(result.competitorCount).toBe(8);
      // 8-person bracket structure
      expect(result.winners).toHaveLength(7);  // 4 + 2 + 1
      expect(result.losers).toHaveLength(6);
      expect(result.finals).toHaveLength(2);   // Grand finals + reset
    });

    it('should pad 5 competitors to 8-person bracket with BYEs', () => {
      const competitors = createCompetitors(5);
      const result = generateBracket(competitors);

      expect(result.competitorCount).toBe(5);
      // Should use 8-person bracket structure
      expect(result.winners).toHaveLength(7);

      // Some matches should have null (BYE) for competitor2
      const byeMatches = result.winners.filter(m =>
        m.competitor1Id !== null && m.competitor2Id === null
      );
      expect(byeMatches.length).toBeGreaterThan(0);
    });

    it('should pad 3 competitors to 4-person bracket with BYE', () => {
      const competitors = createCompetitors(3);
      const result = generateBracket(competitors);

      expect(result.competitorCount).toBe(3);
      // Should use 4-person bracket structure
      expect(result.winners).toHaveLength(3);
    });
  });

  describe('seeding strategies', () => {
    it('should use random seeding when specified', () => {
      const competitors = createCompetitors(8);

      // Run multiple times to verify randomness
      const results = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const result = generateBracket(competitors, 'random');
        const firstFour = result.winners
          .slice(0, 4)
          .map(m => m.competitor1Id)
          .join(',');
        results.add(firstFour);
      }

      // With random seeding, we should get different orderings
      // (with high probability)
      expect(results.size).toBeGreaterThan(1);
    });

    it('should use school spread seeding to minimize same-school matchups', () => {
      // Create competitors with same school
      const competitors: CompetitorSeed[] = [
        { registrationId: 'reg-1', name: 'A', school: 'School A' },
        { registrationId: 'reg-2', name: 'B', school: 'School A' },
        { registrationId: 'reg-3', name: 'C', school: 'School B' },
        { registrationId: 'reg-4', name: 'D', school: 'School B' },
        { registrationId: 'reg-5', name: 'E', school: 'School C' },
        { registrationId: 'reg-6', name: 'F', school: 'School C' },
        { registrationId: 'reg-7', name: 'G', school: 'School D' },
        { registrationId: 'reg-8', name: 'H', school: 'School D' },
      ];

      const result = generateBracket(competitors, 'school_spread');

      // First round matches (1-4 in 8-person bracket)
      const firstRoundMatches = result.winners.filter(m => m.round === 1);
      expect(firstRoundMatches).toHaveLength(4);

      // Count same-school first round matchups (should be minimized)
      const getSchool = (id: string | null) =>
        competitors.find(c => c.registrationId === id)?.school;

      let sameSchoolMatchups = 0;
      for (const match of firstRoundMatches) {
        if (getSchool(match.competitor1Id) === getSchool(match.competitor2Id)) {
          sameSchoolMatchups++;
        }
      }

      // With proper spreading, same-school matchups should be minimal
      expect(sameSchoolMatchups).toBeLessThanOrEqual(2);
    });

    it('should use manual seeding when specified', () => {
      const competitors: CompetitorSeed[] = [
        { registrationId: 'reg-1', name: 'A', school: 'S1', seedPosition: 3 },
        { registrationId: 'reg-2', name: 'B', school: 'S2', seedPosition: 1 },
        { registrationId: 'reg-3', name: 'C', school: 'S3', seedPosition: 2 },
        { registrationId: 'reg-4', name: 'D', school: 'S4', seedPosition: 4 },
      ];

      const result = generateBracket(competitors, 'manual');

      // Verify the seeding order was respected
      // First match should be seed 1 vs seed 4
      expect(result.winners[0].competitor1Id).toBe('reg-2'); // seed 1
      expect(result.winners[0].competitor2Id).toBe('reg-4'); // seed 4
    });
  });

  describe('bracket structure', () => {
    it('should have correct next match pointers for winners bracket', () => {
      const competitors = createCompetitors(8);
      const result = generateBracket(competitors);

      // Winners round 1 matches should point to round 2
      const round1 = result.winners.filter(m => m.round === 1);
      for (const match of round1) {
        expect(match.nextWinnerMatch).toBeDefined();
        expect(match.nextLoserMatch).toBeDefined();
      }
    });

    it('should have correct losers bracket structure', () => {
      const competitors = createCompetitors(8);
      const result = generateBracket(competitors);

      // Losers bracket should have progression
      const losersWithNext = result.losers.filter(m => m.nextWinnerMatch);
      expect(losersWithNext.length).toBeGreaterThan(0);
    });

    it('should have finals bracket with grand finals and reset', () => {
      const competitors = createCompetitors(8);
      const result = generateBracket(competitors);

      expect(result.finals).toHaveLength(2);
      expect(result.finals[0].matchNumber).toBe(14); // Grand finals
      expect(result.finals[1].matchNumber).toBe(15); // Reset match
    });
  });
});
