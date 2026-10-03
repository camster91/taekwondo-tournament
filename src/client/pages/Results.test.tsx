// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Results from './Results';

afterEach(cleanup);

function renderResults() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['results-tournament', 'test-tournament'], {
    id: 'test-tournament', name: 'Test Tournament', date: '2026-10-03', location: null,
  });
  client.setQueryData(['results-divisions', 'test-tournament'], [{
    id: 'test-division', name: 'Test Division', eventType: 'patterns',
    bracket: {
      id: 'test-bracket', status: 'completed',
      matches: [{ id: 'test-match', status: 'completed', roundNumber: 1, matchNumber: 1 }],
      placements: [{
        place: 1, registrationId: 'test-registration',
        registration: { competitor: {
          id: 'test-competitor', firstName: 'Alex', lastName: 'Test', schoolDojang: 'Test School',
        } },
      }],
    },
  }]);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tournaments/test-tournament/results']}>
        <Routes>
          <Route path="/tournaments/:id/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Results accessibility', () => {
  it('names the back link and hides its decorative icon', async () => {
    renderResults();
    const back = screen.getByRole('link', { name: 'Back to tournament' });
    expect(back).toHaveAttribute('href', '/tournaments/test-tournament');
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.setup().tab();
    expect(back).toHaveFocus();
  });

  it('names the native event filter and supports selecting an event', async () => {
    renderResults();
    const filter = screen.getByRole('combobox', { name: 'Filter by event' });
    expect(filter.tagName).toBe('SELECT');
    expect(filter).toHaveValue('all');
    await userEvent.setup().selectOptions(filter, 'sparring');
    expect(filter).toHaveValue('sparring');
    expect(screen.getByText('No results yet')).toBeInTheDocument();
  });

  it('preserves names for Export, its actions, and the school report link', async () => {
    renderResults();
    const user = userEvent.setup();
    const exportButton = screen.getByRole('button', { name: 'Export' });
    expect(exportButton.querySelector('.sr-only')).toHaveTextContent('Export');
    await user.click(exportButton);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAccessibleName();
    }
    await user.click(screen.getByText('Test School'));
    const report = screen.getByRole('link', { name: 'Download Report' });
    expect(report.querySelector('.sr-only')).toHaveTextContent('Download Report');
  });
});
