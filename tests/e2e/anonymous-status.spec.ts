import { expect, test } from '@playwright/test';

test.describe('truthful anonymous status', () => {
  for (const view of [
    { name: 'venue', path: (id: string) => `/display/${id}?key=fabricated` },
    { name: 'parent', path: (id: string) => `/scoreboard/parent/${id}?key=fabricated` },
  ]) {
    test(`${view.name} scoreboard keeps confirmed matches visible during a transient poll failure`, async ({ page }) => {
      const id = `00000000-0000-4000-8000-0000000000${view.name === 'venue' ? '71' : '72'}`;
      let scoreboardRequests = 0;
      const scoreboard = {
        divisions: [{
          id: 'division-1',
          name: 'Fabricated Black Belt Final',
          eventType: 'sparring',
          bracket: {
            id: 'bracket-1',
            matches: [{
              id: 'match-1', matchNumber: 7, roundNumber: 3, bracketType: 'winners', ringNumber: 1,
              status: 'in_progress', score1: '2', score2: '1', winnerId: null,
              competitor1: { id: 'registration-1', competitor: { firstName: 'Amina', lastName: 'Fabricated', schoolDojang: 'Demo Dojang' } },
              competitor2: { id: 'registration-2', competitor: { firstName: 'Ji-ho', lastName: 'Fabricated', schoolDojang: 'Test Academy' } },
            }],
          },
        }],
        displaySettings: {},
      };
      await page.route(`**/api/public/tournaments/${id}`, (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id, name: 'Resilient Fabricated Open', date: '2027-01-01', location: 'Test Venue', status: 'in_progress' }),
      }));
      await page.route(`**/api/public/tournaments/${id}/scoreboard**`, (route) => {
        scoreboardRequests += 1;
        if (scoreboardRequests === 2) {
          return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary outage' }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scoreboard) });
      });

      await page.goto(view.path(id));
      await expect(page.getByText('Amina Fabricated')).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('Showing the last confirmed scoreboard', { timeout: 12_000 });
      await expect(page.getByText('Amina Fabricated')).toBeVisible();
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByText('Amina Fabricated')).toBeVisible();
    });
  }

  test('parent scoreboard preserves matches when its metadata poll fails and retries the failed resource', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000073';
    let tournamentRequests = 0;
    const tournament = { id, name: 'Metadata Resilience Open', date: '2027-01-01', location: 'Test Venue', status: 'in_progress' };
    const scoreboard = {
      divisions: [{ id: 'division-1', name: 'Fabricated Final', eventType: 'sparring', bracket: { id: 'bracket-1', matches: [{
        id: 'match-1', matchNumber: 1, roundNumber: 1, bracketType: 'winners', ringNumber: 1, status: 'in_progress', score1: 0, score2: 0, winnerId: null,
        competitor1: { id: 'registration-1', competitor: { firstName: 'Mina', lastName: 'Confirmed', schoolDojang: null } },
        competitor2: { id: 'registration-2', competitor: { firstName: 'Theo', lastName: 'Fabricated', schoolDojang: null } },
      }] } }],
      displaySettings: {},
    };
    await page.route(`**/api/public/tournaments/${id}`, (route) => {
      tournamentRequests += 1;
      return tournamentRequests === 2
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Metadata unavailable' }) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tournament) });
    });
    await page.route(`**/api/public/tournaments/${id}/scoreboard**`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scoreboard) }));

    await page.goto(`/scoreboard/parent/${id}?key=fabricated`);
    await expect(page.getByText('Mina Confirmed')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Showing the last confirmed scoreboard', { timeout: 15_000 });
    await expect(page.getByText('Mina Confirmed')).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(tournamentRequests).toBeGreaterThanOrEqual(3);
  });

  test('venue scoreboard shows only the cached board and stale warning after a metadata poll failure', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000075';
    let tournamentRequests = 0;
    await page.route(`**/api/public/tournaments/${id}`, (route) => {
      tournamentRequests += 1;
      return tournamentRequests === 2
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Metadata unavailable' }) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, name: 'Venue Metadata Test', date: '2027-01-01', location: 'Test', status: 'in_progress' }) });
    });
    await page.route(`**/api/public/tournaments/${id}/scoreboard**`, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({
        divisions: [{ id: 'division-1', name: 'Fabricated Final', eventType: 'sparring', bracket: { id: 'bracket-1', matches: [{
          id: 'match-1', matchNumber: 1, roundNumber: 1, bracketType: 'winners', ringNumber: 1, status: 'in_progress', score1: 0, score2: 0, winnerId: null,
          competitor1: { id: 'registration-1', competitor: { firstName: 'Venue', lastName: 'Confirmed', schoolDojang: null } }, competitor2: null,
        }] } }], displaySettings: {},
      }),
    }));

    await page.goto(`/display/${id}?key=fabricated`);
    await expect(page.getByText('Venue Confirmed')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Showing the last confirmed scoreboard', { timeout: 15_000 });
    await expect(page.getByText('Venue Confirmed')).toBeVisible();
    await expect(page.getByText(/Check the URL with the tournament director/i)).toHaveCount(0);
  });

  test('a cached scoreboard fails closed when its public link is revoked', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000074';
    let scoreboardRequests = 0;
    await page.route(`**/api/public/tournaments/${id}`, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ id, name: 'Revocation Test', date: '2027-01-01', location: 'Test', status: 'in_progress' }),
    }));
    await page.route(`**/api/public/tournaments/${id}/scoreboard**`, (route) => {
      scoreboardRequests += 1;
      if (scoreboardRequests > 1) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        divisions: [{ id: 'division-1', name: 'Private Final', eventType: 'sparring', bracket: { id: 'bracket-1', matches: [{
          id: 'match-1', matchNumber: 1, roundNumber: 1, bracketType: 'winners', ringNumber: 1, status: 'in_progress', score1: 0, score2: 0, winnerId: null,
          competitor1: { id: 'registration-1', competitor: { firstName: 'Hidden', lastName: 'Athlete', schoolDojang: null } }, competitor2: null,
        }] } }], displaySettings: {},
      }) });
    });

    await page.goto(`/scoreboard/parent/${id}?key=fabricated`);
    await expect(page.getByText('Hidden Athlete')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live scoreboard unavailable' })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByText('Hidden Athlete')).toHaveCount(0);
    await expect(page.getByText(/link is inactive/i)).toBeVisible();
  });

  test('a first-time public visitor is not told that a session expired', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText('Your session has expired. Please log in again.')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Tournament Registration/i })).toBeVisible();
  });

  test('an unavailable parent link never renders a live empty state', async ({ page }) => {
    await page.goto('/scoreboard/parent/00000000-0000-4000-8000-000000000000?key=invalid');
    await expect(page.getByRole('heading', { name: 'Tournament unavailable' })).toBeVisible();
    await expect(page.getByText('No matches in progress right now.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('Your session has expired. Please log in again.')).toHaveCount(0);
  });

  test('parent scoreboard explains rate limiting and preserves retry', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000099';
    await page.route(`**/api/public/tournaments/${id}`, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id, name: 'Fabricated Event', date: '2027-01-01', location: 'Test', status: 'in_progress' }),
    }));
    await page.route(`**/api/public/tournaments/${id}/scoreboard**`, (route) => route.fulfill({
      status: 429,
      headers: { 'Retry-After': '42' },
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Busy' }),
    }));
    await page.goto(`/scoreboard/parent/${id}?key=fabricated`);
    await expect(page.getByText(/Try again in 42 seconds/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('registration lookup does not turn a tournament-list outage into an empty selector', async ({ page }) => {
    await page.route('**/api/public/tournaments', (route) => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unavailable' }),
    }));
    await page.goto('/check-registration');
    await expect(page.getByRole('alert').filter({ hasText: 'Tournament choices are unavailable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Look up registration' })).toBeDisabled();
  });

  test('registration lookup preserves privacy-safe guidance for an ordinary miss', async ({ page }) => {
    await page.route('**/api/public/tournaments', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 't1', name: 'Fabricated Event', date: '2027-01-01' }]),
    }));
    await page.route('**/api/public/check-registration?**', (route) => route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ registered: false }),
    }));
    await page.goto('/check-registration');
    await page.getByLabel('Tournament').selectOption('t1');
    await page.getByLabel('First name').fill('Nobody');
    await page.getByLabel('Last name').fill('Fabricated');
    await page.getByLabel('Date of birth').fill('2010-01-01');
    await page.getByRole('button', { name: 'Look up registration' }).click();
    await expect(page.getByRole('alert')).toContainText('No registration found for those exact details');
    await expect(page.getByRole('alert')).not.toContainText('Request failed');
  });

  test('registration management distinguishes an outage from an invalid private link', async ({ page }) => {
    await page.route('**/api/public/registrations/fabricated-token', (route) => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Database unavailable' }),
    }));
    await page.goto('/manage-registration?token=fabricated-token');
    await expect(page.getByRole('alert')).toContainText('Registration management is unavailable right now');
    await expect(page.getByRole('alert')).not.toContainText('invalid or has expired');
  });

  test('public registration identifies a tournament-list outage and recovers on retry', async ({ page }) => {
    let tournamentRequests = 0;
    await page.route('**/api/public/tournaments', (route) => {
      tournamentRequests += 1;
      if (tournamentRequests === 1) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Tournament service unavailable' }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/public/legal-config', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        consentVersion: 'e2e-v1',
        privacyNoticeUrl: '/privacy',
        tournamentTermsUrl: '/terms',
      }),
    }));

    await page.goto('/register');
    await expect(page.getByRole('alert')).toContainText('Tournament list is temporarily unavailable');
    const requestsBeforeRetry = tournamentRequests;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('heading', { name: 'No Open Tournaments' })).toBeVisible();
    expect(tournamentRequests).toBe(requestsBeforeRetry + 1);
  });
});
