import { describe, it, expect } from 'vitest';
import { isTestData } from './test-data.js';

describe('isTestData', () => {
  it('flags TestKid competitor from public-register.spec.ts', () => {
    expect(isTestData({ firstName: 'TestKid', lastName: 'E2E1781225213537' })).toBe(true);
  });

  it('flags competitor whose school starts with E2E', () => {
    expect(isTestData({ firstName: 'Real', lastName: 'Name', schoolDojang: 'E2E Test Dojang' })).toBe(true);
  });

  it('flags E2E Open 2026 tournament', () => {
    expect(isTestData({ name: 'E2E Open 2026' })).toBe(true);
  });

  it('flags E2E Test Tournament (timestamped) tournament', () => {
    expect(isTestData({ name: 'E2E Test Tournament 1781225226731' })).toBe(true);
  });

  it('does not flag real seed data', () => {
    expect(isTestData({ firstName: 'Minho', lastName: 'Kim', schoolDojang: 'Tiger Martial Arts' })).toBe(false);
    expect(isTestData({ name: 'Spring Championship 2026' })).toBe(false);
  });

  it('does not flag empty inputs', () => {
    expect(isTestData({})).toBe(false);
    expect(isTestData({ firstName: '', lastName: null })).toBe(false);
  });
});
