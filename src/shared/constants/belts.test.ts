import { describe, it, expect } from 'vitest';
import {
  isBlackBelt,
  getBeltLevel,
  normalizeBelt,
  getSimpleBeltCategory,
  COLORED_BELTS,
  BELT_CATEGORIES,
} from './belts.js';

describe('Belt Constants', () => {
  describe('isBlackBelt', () => {
    it('should return true for black belt', () => {
      expect(isBlackBelt('Black')).toBe(true);
      expect(isBlackBelt('black')).toBe(true);
      expect(isBlackBelt('BLACK')).toBe(true);
    });

    it('should return false for colored belts', () => {
      expect(isBlackBelt('White')).toBe(false);
      expect(isBlackBelt('Yellow')).toBe(false);
      expect(isBlackBelt('Green')).toBe(false);
      expect(isBlackBelt('Blue')).toBe(false);
      expect(isBlackBelt('Red')).toBe(false);
    });

    it('should return false for belts with stripes', () => {
      expect(isBlackBelt('Red / Single Black Stripe')).toBe(false);
      expect(isBlackBelt('Red / Double Black Stripe')).toBe(false);
    });
  });

  describe('getBeltLevel', () => {
    it('should return BB for black belt', () => {
      expect(getBeltLevel('Black')).toBe('BB');
      expect(getBeltLevel('black')).toBe('BB');
    });

    it('should return CB for colored belts', () => {
      expect(getBeltLevel('White')).toBe('CB');
      expect(getBeltLevel('Yellow')).toBe('CB');
      expect(getBeltLevel('Green')).toBe('CB');
      expect(getBeltLevel('Blue')).toBe('CB');
      expect(getBeltLevel('Red')).toBe('CB');
    });
  });

  describe('normalizeBelt', () => {
    it('should normalize single letter abbreviations', () => {
      expect(normalizeBelt('W')).toBe('White');
      expect(normalizeBelt('Y')).toBe('Yellow');
      expect(normalizeBelt('G')).toBe('Green');
      expect(normalizeBelt('B')).toBe('Blue');
      expect(normalizeBelt('R')).toBe('Red');
    });

    it('should normalize uppercase full names', () => {
      expect(normalizeBelt('WHITE')).toBe('White');
      expect(normalizeBelt('YELLOW')).toBe('Yellow');
      expect(normalizeBelt('BLACK')).toBe('Black');
    });

    it('should normalize black belt abbreviations', () => {
      expect(normalizeBelt('BB')).toBe('Black');
      expect(normalizeBelt('BL')).toBe('Black');
    });

    it('should preserve unknown belt names', () => {
      expect(normalizeBelt('Unknown Belt')).toBe('Unknown Belt');
      expect(normalizeBelt('Custom')).toBe('Custom');
    });

    it('should trim whitespace', () => {
      expect(normalizeBelt('  White  ')).toBe('White');
      expect(normalizeBelt(' Y ')).toBe('Yellow');
    });
  });

  describe('getSimpleBeltCategory', () => {
    it('should categorize base colored belts', () => {
      expect(getSimpleBeltCategory('White')).toBe('White');
      expect(getSimpleBeltCategory('Yellow')).toBe('Yellow');
      expect(getSimpleBeltCategory('Green')).toBe('Green');
      expect(getSimpleBeltCategory('Blue')).toBe('Blue');
      expect(getSimpleBeltCategory('Red')).toBe('Red');
    });

    it('should categorize belts with stripes to their base color', () => {
      expect(getSimpleBeltCategory('White / Single Yellow Stripe')).toBe('White');
      expect(getSimpleBeltCategory('Yellow / Double Green Stripe')).toBe('Yellow');
      expect(getSimpleBeltCategory('Green / Single Blue Stripe')).toBe('Green');
      expect(getSimpleBeltCategory('Blue / Double Red Stripe')).toBe('Blue');
      expect(getSimpleBeltCategory('Red / Single Black Stripe')).toBe('Red');
    });

    it('should categorize black belt', () => {
      expect(getSimpleBeltCategory('Black')).toBe('Black');
    });

    it('should handle abbreviations', () => {
      expect(getSimpleBeltCategory('W')).toBe('White');
      expect(getSimpleBeltCategory('Y')).toBe('Yellow');
    });
  });

  describe('COLORED_BELTS constant', () => {
    it('should have all 15 colored belt variations', () => {
      expect(COLORED_BELTS).toHaveLength(15);
    });

    it('should start with White and end with Red / Double Black Stripe', () => {
      expect(COLORED_BELTS[0]).toBe('White');
      expect(COLORED_BELTS[COLORED_BELTS.length - 1]).toBe('Red / Double Black Stripe');
    });
  });

  describe('BELT_CATEGORIES constant', () => {
    it('should have all 6 categories', () => {
      const categories = Object.keys(BELT_CATEGORIES);
      expect(categories).toHaveLength(6);
      expect(categories).toContain('White');
      expect(categories).toContain('Yellow');
      expect(categories).toContain('Green');
      expect(categories).toContain('Blue');
      expect(categories).toContain('Red');
      expect(categories).toContain('Black');
    });

    it('should have 3 belts per colored category', () => {
      expect(BELT_CATEGORIES.White).toHaveLength(3);
      expect(BELT_CATEGORIES.Yellow).toHaveLength(3);
      expect(BELT_CATEGORIES.Green).toHaveLength(3);
      expect(BELT_CATEGORIES.Blue).toHaveLength(3);
      expect(BELT_CATEGORIES.Red).toHaveLength(3);
    });

    it('should have 1 belt in Black category', () => {
      expect(BELT_CATEGORIES.Black).toHaveLength(1);
    });
  });
});
