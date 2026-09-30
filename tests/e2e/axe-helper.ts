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

  // WCAG 2.0, 2.1 and 2.2 at levels A and AA. axe tags each rule with the
  // version that introduced it, so 2.1 rules (reflow, autocomplete,
  // orientation, ...) only run when `wcag21a`/`wcag21aa` are listed.
  builder.withTags(WCAG_AA_TAGS);

  return builder.analyze();
}

export const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Durations (in ms) of every running CSS animation and transition on the
 * page, excluding ones already at or below `thresholdMs`. Used to prove
 * that `prefers-reduced-motion: reduce` actually removes motion.
 */
export async function motionLongerThan(page: Page, thresholdMs = 0.01) {
  return page.evaluate((threshold) => {
    const toMs = (value: string) => Math.max(0, ...value.split(',').map((part) => {
      const v = part.trim();
      return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
    }));
    const found: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const style = getComputedStyle(el);
      const animation = style.animationName !== 'none' ? toMs(style.animationDuration) : 0;
      const transition = style.transitionProperty !== 'none' ? toMs(style.transitionDuration) : 0;
      const longest = Math.max(animation, transition);
      if (longest > threshold) {
        const name = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') +
          (typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '');
        found.push(`${name} ${longest}ms`);
      }
    }
    return found;
  }, thresholdMs);
}
