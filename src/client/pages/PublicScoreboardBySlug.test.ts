import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScoreboardStatus } from './PublicScoreboardBySlug';

describe('public scoreboard slug status landmarks', () => {
  it('renders the expired-link state inside the main landmark', () => {
    const html = renderToStaticMarkup(
      createElement(ScoreboardStatus, { error: 'This share link is no longer active.' }),
    );

    expect(html).toMatch(/^<main\b/);
    expect(html).toContain('Scoreboard not found');
    expect(html).toContain('text-surface-300');
  });

  it('renders the loading state inside the main landmark', () => {
    const html = renderToStaticMarkup(createElement(ScoreboardStatus, { error: null }));

    expect(html).toMatch(/^<main\b/);
    expect(html).toContain('aria-label="Loading scoreboard"');
  });
});
