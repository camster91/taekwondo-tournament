// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LiveUpdatesNotice from './LiveUpdatesNotice';

const renderNotice = (error: 'unauthorized' | 'forbidden' | null, onRetry = vi.fn()) =>
  render(<MemoryRouter><LiveUpdatesNotice error={error} onRetry={onRetry} /></MemoryRouter>);

describe('LiveUpdatesNotice', () => {
  it('renders nothing while the socket is healthy', () => {
    const { container } = renderNotice(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('tells the user to sign in again when the session ended', () => {
    renderNotice('unauthorized');
    expect(screen.getByRole('alert')).toHaveTextContent(/session ended/i);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('offers a retry when access to the division was refused or revoked', async () => {
    const onRetry = vi.fn();
    renderNotice('forbidden', onRetry);
    expect(screen.getByRole('alert')).toHaveTextContent(/no longer have access/i);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry live updates' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
