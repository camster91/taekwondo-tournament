import { test, expect } from '@playwright/test';
import { checkA11y } from './axe-helper';

// Proves the accessibility gate can fail: every a11y spec asserts
// `violations` is empty, which would pass trivially if the scan were
// misconfigured (no rules, wrong tags, nothing scanned).
test.describe('accessibility gate self-test', () => {
  test('reports planted WCAG 2.0 and 2.1 violations', async ({ page }) => {
    await page.setContent(`<!doctype html>
      <html><head><title>a11y self-test</title></head><body><main>
        <h1>Planted violations</h1>
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
        <button></button>
        <label>Email <input type="email" autocomplete="not-a-token"></label>
      </main></body></html>`);

    const results = await checkA11y(page);
    const ids = results.violations.map((v) => v.id);

    expect(ids).toContain('image-alt');              // WCAG 2.0 A
    expect(ids).toContain('button-name');            // WCAG 2.0 A
    expect(ids).toContain('autocomplete-valid');     // WCAG 2.1 AA — only runs with wcag21aa
  });

  test('passes a clean page', async ({ page }) => {
    await page.setContent(`<!doctype html>
      <html lang="en"><head><title>a11y self-test</title></head><body><main>
        <h1>Clean page</h1>
        <button type="button">Save</button>
      </main></body></html>`);
    const results = await checkA11y(page);
    expect(results.violations).toEqual([]);
  });
});
