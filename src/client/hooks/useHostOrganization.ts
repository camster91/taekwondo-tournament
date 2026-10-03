import { useEffect, useState } from 'react';

/** The organizer that owns this web address (their custom domain), if any. */
export interface HostOrganization {
  slug: string;
  name: string;
  brandPrimaryColor: string;
  brandLogoUrl: string | null;
}

export type HostLookup =
  | { status: 'loading' }
  | { status: 'ready'; organization: HostOrganization | null; hidePlatformBranding: boolean };

const NO_ORGANIZER: HostLookup = { status: 'ready', organization: null, hidePlatformBranding: false };

// One lookup per page load: the answer only depends on the host.
let pending: Promise<HostLookup> | null = null;
let settled: HostLookup | null = null;

export function parseHostLookup(body: unknown): HostLookup {
  if (!body || typeof body !== 'object') return NO_ORGANIZER;
  const { organization, hidePlatformBranding } = body as Record<string, unknown>;
  if (!organization || typeof organization !== 'object') return NO_ORGANIZER;
  const org = organization as Record<string, unknown>;
  if (typeof org.slug !== 'string' || !org.slug || typeof org.name !== 'string') return NO_ORGANIZER;
  return {
    status: 'ready',
    organization: {
      slug: org.slug,
      name: org.name,
      brandPrimaryColor: typeof org.brandPrimaryColor === 'string' ? org.brandPrimaryColor : '#DC2626',
      brandLogoUrl: typeof org.brandLogoUrl === 'string' ? org.brandLogoUrl : null,
    },
    hidePlatformBranding: hidePlatformBranding === true,
  };
}

function loadHostOrganization(): Promise<HostLookup> {
  if (!pending) {
    pending = fetch('/api/public/host', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then(parseHostLookup)
      // If the lookup fails, behave like the normal app address.
      .catch(() => NO_ORGANIZER)
      .then((result) => {
        settled = result;
        return result;
      });
  }
  return pending;
}

/**
 * Which organizer owns this host. On an organizer's custom domain the home
 * page and /register show their events instead of the bowin pages.
 */
export function useHostOrganization(enabled = true): HostLookup {
  const [lookup, setLookup] = useState<HostLookup>(() => settled ?? { status: 'loading' });

  useEffect(() => {
    if (!enabled || settled) return;
    let active = true;
    loadHostOrganization().then((result) => {
      if (active) setLookup(result);
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  return settled ?? lookup;
}
