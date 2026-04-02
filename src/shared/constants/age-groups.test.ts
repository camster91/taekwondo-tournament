import { describe, it, expect } from 'vitest';
import {
  getAgeGroup,
  calculateAge,
  DEFAULT_AGE_GROUPS,
  BB_AGE_GROUPS,
} from './age-groups.js';

describe('Age Groups', () => {
  describe('DEFAULT_AGE_GROUPS', () => {
    it('should have 8 age groups', () => {
      expect(DEFAULT_AGE_GROUPS).toHaveLength(8);
    });

    it('should cover ages 4 to 99', () => {
      expect(DEFAULT_AGE_GROUPS[0].min).toBe(4);
      expect(DEFAULT_AGE_GROUPS[DEFAULT_AGE_GROUPS.length - 1].max).toBe(99);
    });

    it('should have correct labels', () => {
      expect(DEFAULT_AGE_GROUPS[0].label).toBe('4-5');
      expect(DEFAULT_AGE_GROUPS[1].label).toBe('6-7');
      expect(DEFAULT_AGE_GROUPS[7].label).toBe('36+');
    });

    it('should not have gaps between age groups', () => {
      for (let i = 1; i < DEFAULT_AGE_GROUPS.length; i++) {
        const prevMax = DEFAULT_AGE_GROUPS[i - 1].max;
        const currentMin = DEFAULT_AGE_GROUPS[i].min;
        expect(currentMin).toBe(prevMax + 1);
      }
    });
  });

  describe('BB_AGE_GROUPS', () => {
    it('should have 6 age groups for black belts', () => {
      expect(BB_AGE_GROUPS).toHaveLength(6);
    });

    it('should have "11 and Under" as first group', () => {
      expect(BB_AGE_GROUPS[0].label).toBe('11 and Under');
      expect(BB_AGE_GROUPS[0].min).toBe(4);
      expect(BB_AGE_GROUPS[0].max).toBe(11);
    });
  });

  describe('getAgeGroup', () => {
    it('should return correct age group for DEFAULT_AGE_GROUPS', () => {
      expect(getAgeGroup(4)?.label).toBe('4-5');
      expect(getAgeGroup(5)?.label).toBe('4-5');
      expect(getAgeGroup(6)?.label).toBe('6-7');
      expect(getAgeGroup(10)?.label).toBe('10-11');
      expect(getAgeGroup(15)?.label).toBe('15-17');
      expect(getAgeGroup(25)?.label).toBe('18-35');
      expect(getAgeGroup(50)?.label).toBe('36+');
    });

    it('should return null for age below minimum', () => {
      expect(getAgeGroup(3)).toBeNull();
      expect(getAgeGroup(2)).toBeNull();
    });

    it('should return null for age above maximum', () => {
      expect(getAgeGroup(100)).toBeNull();
    });

    it('should use BB_AGE_GROUPS when specified', () => {
      expect(getAgeGroup(10, BB_AGE_GROUPS)?.label).toBe('11 and Under');
      expect(getAgeGroup(12, BB_AGE_GROUPS)?.label).toBe('12-13');
      expect(getAgeGroup(14, BB_AGE_GROUPS)?.label).toBe('14-15');
    });

    it('should handle edge cases at boundaries', () => {
      // 11 year old in default groups
      expect(getAgeGroup(11, DEFAULT_AGE_GROUPS)?.label).toBe('10-11');
      // 12 year old transitions to next group
      expect(getAgeGroup(12, DEFAULT_AGE_GROUPS)?.label).toBe('12-14');

      // 11 year old in BB groups
      expect(getAgeGroup(11, BB_AGE_GROUPS)?.label).toBe('11 and Under');
      // 12 year old in BB groups
      expect(getAgeGroup(12, BB_AGE_GROUPS)?.label).toBe('12-13');
    });
  });

  describe('calculateAge', () => {
    it('should calculate age correctly for past birthday', () => {
      const dob = new Date('2010-01-15');
      const tournament = new Date('2025-06-01');
      expect(calculateAge(dob, tournament)).toBe(15);
    });

    it('should calculate age correctly for upcoming birthday', () => {
      const dob = new Date('2010-08-15');
      const tournament = new Date('2025-06-01');
      expect(calculateAge(dob, tournament)).toBe(14);
    });

    it('should calculate age correctly on birthday', () => {
      const dob = new Date('2010-06-01');
      const tournament = new Date('2025-06-01');
      expect(calculateAge(dob, tournament)).toBe(15);
    });

    it('should handle same year birth and tournament', () => {
      const dob = new Date('2025-01-15');
      const tournament = new Date('2025-06-01');
      expect(calculateAge(dob, tournament)).toBe(0);
    });

    it('should handle day before birthday', () => {
      const dob = new Date('2010-06-02');
      const tournament = new Date('2025-06-01');
      expect(calculateAge(dob, tournament)).toBe(14);
    });

    it('should handle day after birthday', () => {
      const dob = new Date('2010-05-31');
      const tournament = new Date('2025-06-01');
      expect(calculateAge(dob, tournament)).toBe(15);
    });
  });
});
