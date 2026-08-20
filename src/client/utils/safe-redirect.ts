/**
 * Validates and sanitizes a return/redirect URL to prevent open-redirect vulnerabilities.
 * Only relative application paths starting with a single '/' are permitted.
 */
export function getSafeRedirectUrl(target: string | null | undefined, fallback = '/'): string {
  if (!target || typeof target !== 'string') {
    return fallback;
  }

  const trimmed = target.trim();

  // Reject empty string or purely whitespace
  if (!trimmed) {
    return fallback;
  }

  // Must start with exactly one forward slash, not protocol-relative '//' or Windows '\\'
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback;
  }

  // Reject URLs containing protocols or schemes (e.g., javascript:, data:, https://)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  // Reject CRLF injection characters
  if (/[\r\n\t]/.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}
