import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DemoGuide, { buildDemoDestination, DEMO_PATHS } from './DemoGuide.js';

describe('DemoGuide', () => {
  it('offers five honest tournament-day paths with exact destinations', () => {
    expect(DEMO_PATHS.map((path) => [path.id, path.impact])).toEqual([
      ['director', 'read-only'],
      ['scorekeeper', 'changes-demo-data'],
      ['checkin', 'changes-demo-data'],
      ['parent', 'read-only'],
      ['display', 'read-only'],
    ]);
    expect(buildDemoDestination('director', 'live-id', 'live-slug')).toBe('/tournaments/live-id/director');
    expect(buildDemoDestination('scorekeeper', 'live-id', 'live-slug')).toBe('/scorekeeper/live-id');
    expect(buildDemoDestination('checkin', 'live-id', 'live-slug')).toBe('/checkin/live-id');
    expect(buildDemoDestination('parent', 'live-id', 'live-slug')).toBe('/scoreboard/parent/live-id?key=live-slug');
    expect(buildDemoDestination('display', 'live-id', 'live-slug')).toBe('/scoreboard/live-slug');
  });

  it('renders fabricated/shared-data disclosure and accessible choices', () => {
    const html = renderToStaticMarkup(createElement(DemoGuide, {
      open: true,
      tournamentId: 'live-id',
      publicSlug: 'live-slug',
      onClose: vi.fn(),
      onChoose: vi.fn(),
      onComplete: vi.fn(),
      onRetry: vi.fn(),
    }));
    expect(html).toContain('Choose your tournament-day view');
    expect(html).toContain('Everything here is fabricated');
    expect(html).toContain('shared');
    expect(html).toContain('Self-service reset is not available');
    expect(html).toContain('Bowin team periodically restores');
    expect(html).toContain('Changes demo data');
    expect(html).toContain('Read only');
    expect((html.match(/data-demo-path=/g) ?? []).length).toBe(5);
  });

  it('shows a recoverable unavailable state when the fixture is missing', () => {
    const html = renderToStaticMarkup(createElement(DemoGuide, {
      open: true,
      tournamentId: null,
      publicSlug: null,
      onClose: vi.fn(),
      onChoose: vi.fn(),
      onComplete: vi.fn(),
      onRetry: vi.fn(),
    }));
    expect(html).toContain('Showcase temporarily unavailable');
    expect(html).toContain('Try again');
  });
});
