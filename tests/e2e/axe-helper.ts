import { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Run axe accessibility checks on the current page.
 * Automatically excludes common third-party/marketing elements.
 * 
 * @param page - Playwright page instance
 * @param options - Optional configuration
 * @returns Axe results with violations
 */
export async function checkA11y(
  page: Page,
  options?: {
    /** Additional selectors to exclude from scan */
    exclude?: string[];
    /** Specific rules to disable (use sparingly) */
    disableRules?: string[];
    /** Context to limit scan (default: entire page) */
    include?: string[];
  }
) {
  const builder = new AxeBuilder({ page });

  // Exclude third-party embeds and marketing elements by default
  const defaultExcludes = [
    '.stripe-payment-element',
    '[data-testid="stripe-element"]',
  ];

  const allExcludes = [...defaultExcludes, ...(options?.exclude || [])];
  allExcludes.forEach((selector) => builder.exclude(selector));

  if (options?.include) {
    options.include.forEach((selector) => builder.include(selector));
  }

  if (options?.disableRules) {
    builder.disableRules(options.disableRules);
  }

  // Run against WCAG 2.2 AA
  builder.withTags(['wcag2a', 'wcag2aa', 'wcag22aa']);

  return builder.analyze();
}
