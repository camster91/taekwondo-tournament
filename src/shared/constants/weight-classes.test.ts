import { describe, it, expect } from 'vitest';
import { getWeightClass, DEFAULT_WEIGHT_CLASSES } from './weight-classes.js';

describe('Weight Classes', () => {
  describe('DEFAULT_WEIGHT_CLASSES', () => {
    it('should have weight classes for multiple age groups', () => {
      expect(DEFAULT_WEIGHT_CLASSES.length).toBeGreaterThan(20);
    });

    it('should have weight classes for both genders', () => {
      const maleClasses = DEFAULT_WEIGHT_CLASSES.filter(wc => wc.gender === 'M');
      const femaleClasses = DEFAULT_WEIGHT_CLASSES.filter(wc => wc.gender === 'F');

      expect(maleClasses.length).toBeGreaterThan(0);
      expect(femaleClasses.length).toBeGreaterThan(0);
    });

    it('should have Light, Middle, Heavy classes', () => {
      const names = new Set(DEFAULT_WEIGHT_CLASSES.map(wc => wc.name));
      expect(names.has('Light')).toBe(true);
      expect(names.has('Middle')).toBe(true);
      expect(names.has('Heavy')).toBe(true);
    });

    it('should have Feather class for certain age groups', () => {
      const featherClasses = DEFAULT_WEIGHT_CLASSES.filter(wc => wc.name === 'Feather');
      expect(featherClasses.length).toBeGreaterThan(0);
      // Feather is typically for 12-14 age group
      expect(featherClasses.some(wc => wc.ageMin === 12 && wc.ageMax === 14)).toBe(true);
    });
  });

  describe('getWeightClass', () => {
    describe('Males 6-7', () => {
      it('should return Light for weight < 50', () => {
        expect(getWeightClass(45, 6, 'M')).toBe('Light');
        expect(getWeightClass(49, 7, 'M')).toBe('Light');
      });

      it('should return Middle for weight 50-65', () => {
        expect(getWeightClass(50, 6, 'M')).toBe('Middle');
        expect(getWeightClass(60, 7, 'M')).toBe('Middle');
      });

      it('should return Heavy for weight > 65', () => {
        expect(getWeightClass(66, 6, 'M')).toBe('Heavy');
        expect(getWeightClass(80, 7, 'M')).toBe('Heavy');
      });
    });

    describe('Males 12-14', () => {
      it('should return Feather for weight < 80', () => {
        expect(getWeightClass(70, 12, 'M')).toBe('Feather');
        expect(getWeightClass(79, 14, 'M')).toBe('Feather');
      });

      it('should return Light for weight 80-100', () => {
        expect(getWeightClass(80, 12, 'M')).toBe('Light');
        expect(getWeightClass(99, 14, 'M')).toBe('Light');
      });

      it('should return Middle for weight 100-130', () => {
        expect(getWeightClass(100, 12, 'M')).toBe('Middle');
        expect(getWeightClass(125, 13, 'M')).toBe('Middle');
      });

      it('should return Heavy for weight > 130', () => {
        expect(getWeightClass(130, 12, 'M')).toBe('Heavy');
        expect(getWeightClass(150, 14, 'M')).toBe('Heavy');
      });
    });

    describe('Females 10-11', () => {
      it('should return Light for weight < 60', () => {
        expect(getWeightClass(55, 10, 'F')).toBe('Light');
      });

      it('should return Middle for weight 60-80', () => {
        expect(getWeightClass(60, 10, 'F')).toBe('Middle');
        expect(getWeightClass(75, 11, 'F')).toBe('Middle');
      });

      it('should return Heavy for weight > 80', () => {
        expect(getWeightClass(80, 10, 'F')).toBe('Heavy');
        expect(getWeightClass(90, 11, 'F')).toBe('Heavy');
      });
    });

    describe('Adults 18-35', () => {
      it('should return correct classes for adult males', () => {
        expect(getWeightClass(140, 25, 'M')).toBe('Light');
        expect(getWeightClass(160, 25, 'M')).toBe('Middle');
        expect(getWeightClass(200, 25, 'M')).toBe('Heavy');
      });

      it('should return correct classes for adult females', () => {
        expect(getWeightClass(115, 25, 'F')).toBe('Light');
        expect(getWeightClass(130, 25, 'F')).toBe('Middle');
        expect(getWeightClass(160, 25, 'F')).toBe('Heavy');
      });
    });

    describe('Edge cases', () => {
      it('should return null for age without defined weight classes', () => {
        // 4-5 age group typically has no weight classes
        expect(getWeightClass(40, 4, 'M')).toBeNull();
        expect(getWeightClass(40, 5, 'M')).toBeNull();
      });

      it('should handle boundary weights correctly', () => {
        // At exactly the boundary (exclusive upper bound)
        expect(getWeightClass(50, 7, 'M')).toBe('Middle'); // 50 is start of Middle
        expect(getWeightClass(65, 7, 'M')).toBe('Heavy');  // 65 is start of Heavy
      });

      it('should handle very high weights', () => {
        expect(getWeightClass(300, 25, 'M')).toBe('Heavy');
        expect(getWeightClass(500, 40, 'F')).toBe('Heavy');
      });

      it('should handle zero weight', () => {
        expect(getWeightClass(0, 7, 'M')).toBe('Light');
      });
    });
  });
});
