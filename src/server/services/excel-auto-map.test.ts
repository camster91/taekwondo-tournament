import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { autoDetectMapping } from './excel-auto-map.js';

describe('Auto-detect mapping', () => {
  it('detects the Newton\'s Championship 2025 .xlsm layout', () => {
    const buf = readFileSync('/Users/biancabienaime/taekwondo-tournament/2025 NEWTONS CHAMPIONSHIP LIST.xlsm');
    const result = autoDetectMapping(buf);

    // Basic expectations
    expect(result.availableSheets.length).toBe(12);
    expect(result.rowCount).toBeGreaterThan(500);
    expect(result.suggestedSheet).toBeTruthy();

    // Should detect the Gender, Belt, Weight, Patterns, Sparring, School columns
    // (the .xlsm uses "Name" as a combined column, not First/Last)
    expect(result.mapping.gender).toBe('Gender');
    expect(result.mapping.belt).toBe('Belt');
    expect(result.mapping.weight).toBe('Weight (lbs)');
    expect(result.mapping.school).toBe('School');
    expect(result.mapping.patterns).toBe('Patterns');
    expect(result.mapping.sparring).toBe('Sparring');
    expect(result.mapping.danRank).toBe('DAN');
    expect(result.mapping.height).toBe('Height');

    // Should detect "Name" as a combined column and flag the warning
    expect(result.mapping.name).toBe('Name');
    expect(result.warnings.some((w) => w.toLowerCase().includes('name'))).toBe(true);

    // High confidence on the well-known fields
    expect(result.confidence.gender).toBeGreaterThanOrEqual(80);
    expect(result.confidence.belt).toBeGreaterThanOrEqual(80);
    expect(result.confidence.weight).toBeGreaterThanOrEqual(80);
  });

  it('picks the most data-rich sheet', () => {
    const buf = readFileSync('/Users/biancabienaime/taekwondo-tournament/2025 NEWTONS CHAMPIONSHIP LIST.xlsm');
    const result = autoDetectMapping(buf);
    // The "Competitors list" sheet has 684 rows, more than any other
    expect(result.suggestedSheet).toBe('Competitors list');
  });
});
