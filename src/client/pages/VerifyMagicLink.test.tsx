// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VerifyMagicLink from './VerifyMagicLink';
import { AuthContext } from '../context/AuthContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('VerifyMagicLink return-to-work and error recovery', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders expired notice with retry link preserving email and returnTo', async () => {
    const mockAuthValue = {
      user: null,
      isLoading: false,
      isAuthenticated: false,
      token: null,
      requestMagicLink: vi.fn(),
      verifyCode: vi.fn(),
      verifyToken: vi.fn().mockResolvedValue({ success: false, error: 'Magic link has expired' }),
      logout: vi.fn(),
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <AuthContext.Provider value={mockAuthValue}>
          <MemoryRouter initialEntries={['/verify-magic-link?token=expired-tok&email=staff%40dojo.com&returnTo=%2Ftournaments%2F123%2Fscorekeeper']}>
            <Routes>
              <Route path="/verify-magic-link" element={<VerifyMagicLink />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );
    });

    // Wait for verifyToken resolution
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Sign-in link expired or invalid');
    expect(document.body.textContent).toContain('Magic link has expired');

    const retryLink = document.querySelector<HTMLAnchorElement>('a[href*="/login"]')!;
    expect(retryLink).not.toBeNull();
    expect(retryLink.getAttribute('href')).toContain('email=staff%40dojo.com');
    expect(retryLink.getAttribute('href')).toContain('returnTo=%2Ftournaments%2F123%2Fscorekeeper');

    await act(async () => {
      root.unmount();
    });
  });
});
