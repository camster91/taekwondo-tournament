import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoDetectMapping } from './excel-auto-map.js';

// Resolve the .xlsm fixture path relative to this test file, not to
// the developer's home directory. The original test hard-coded
// `/Users/biancabienaime/taekwondo-tournament/...` which only worked
// on Cam's machine; CI failed with ENOENT because no such path
// existed in the GitHub Actions runner.
//
// The .xlsm lives at the repo root. vitest's test runner sets CWD
// to the repo root, so a relative resolve() is enough. We also
// gracefully skip the tests if the file isn't present (it can be
// gitignored in lightweight clones).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = resolve(__dirname, '../../../2025 NEWTONS CHAMPIONSHIP LIST.xlsm');

const fixtureExists = existsSync(FIXTURE_PATH);
const itIfFixture = fixtureExists ? it : it.skip;

describe('Auto-detect mapping', () => {
  let buf: Buffer;

  beforeAll(() => {
    if (!fixtureExists) return;
    buf = readFileSync(FIXTURE_PATH);
  });

  itIfFixture('detects the Newton\'s Championship 2025 .xlsm layout', () => {
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

  itIfFixture('picks the most data-rich sheet', () => {
    const result = autoDetectMapping(buf);
    // The "Competitors list" sheet has 684 rows, more than any other
    expect(result.suggestedSheet).toBe('Competitors list');
  });

  // Always-run guard so a missing fixture gives a clear failure
  // rather than 2 silent skips. If the file is checked in to the
  // repo this should never trigger; if it's been gitignored, the
  // test suite is intentionally silent rather than failing the
  // build over a data file.
  it('fixture is present at the expected path', () => {
    expect(fixtureExists).toBe(true);
  });
});
