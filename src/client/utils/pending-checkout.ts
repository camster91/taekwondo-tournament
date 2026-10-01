// Keeps a paid registration's confirmation (including the private
// management token, shown only once) across the Stripe Checkout redirect.
// sessionStorage is per-tab and same-origin, and Stripe returns to the same
// tab, so the success/cancel page can show the management link that lets
// the parent finish payment, edit or withdraw.
import type { RegistrationResult } from './registration-contract';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY_PREFIX = 'bowin_pending_checkout:';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type PendingCheckout = RegistrationResult['registration'];

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function savePendingCheckout(
  registration: PendingCheckout,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(`${KEY_PREFIX}${registration.id}`, JSON.stringify(registration));
  } catch {
    // Storage full or blocked: the management link is also in the email.
  }
}

export function loadPendingCheckout(
  registrationId: string,
  storage: StorageLike | null = defaultStorage(),
): PendingCheckout | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${KEY_PREFIX}${registrationId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCheckout;
    if (parsed?.id !== registrationId || !TOKEN_PATTERN.test(parsed.managementToken ?? '')) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function managementUrlFor(managementToken: string): string {
  return `/manage-registration?token=${encodeURIComponent(managementToken)}`;
}
