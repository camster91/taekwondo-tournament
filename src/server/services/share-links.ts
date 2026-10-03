/**
 * Share kit for a tournament: the one registration link a director should
 * hand out, plus an embed snippet for the organizer's own website.
 *
 * Which link wins:
 *   1. the organization's active custom domain (their own web address),
 *   2. otherwise the app's address.
 * On either, a tournament published to the organizer's event page links to
 * `/events/<org>/<event>`; any other tournament links straight to the
 * registration form (`/register?tournament=<id>`).
 */

import { escapeHtml } from './email-templates.js';

export type ShareLinkKind = 'custom_domain' | 'event_page' | 'direct';

export interface ShareLinkInput {
  publicAppUrl: string;
  tournamentId: string;
  tournamentName: string;
  portalPublished: boolean;
  eventSlug: string | null;
  orgSlug: string | null;
  /** Hostname of the organization's active custom domain, if any. */
  customDomainHostname: string | null;
}

export interface ShareLinks {
  kind: ShareLinkKind;
  /** The link to share with families. */
  registerUrl: string;
  /** The organizer's page listing all their events, when there is one. */
  organizerPageUrl: string | null;
  /** The registration form on its own, for an iframe on another website. */
  embedUrl: string;
  /** Ready-to-paste HTML for the organizer's website. */
  embedCode: string;
  customDomainHostname: string | null;
}

const SLUG = /^[a-z0-9-]{3,63}$/;
// Hostnames are validated when attached; re-check before building a URL.
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function buildShareLinks(input: ShareLinkInput): ShareLinks {
  const customHost = input.customDomainHostname && HOSTNAME.test(input.customDomainHostname.toLowerCase())
    ? input.customDomainHostname.toLowerCase()
    : null;
  const base = customHost ? `https://${customHost}` : input.publicAppUrl.replace(/\/+$/, '');
  const orgSlug = input.orgSlug && SLUG.test(input.orgSlug) ? input.orgSlug : null;
  const eventSlug = input.eventSlug && SLUG.test(input.eventSlug) ? input.eventSlug : null;
  const onEventPage = Boolean(input.portalPublished && orgSlug && eventSlug);
  const tournamentId = encodeURIComponent(input.tournamentId);

  const registerUrl = onEventPage
    ? `${base}/events/${orgSlug}/${eventSlug}`
    : `${base}/register?tournament=${tournamentId}`;
  const embedUrl = onEventPage
    ? `${base}/register?portal=${orgSlug}/${eventSlug}&embed=1`
    : `${base}/register?tournament=${tournamentId}&embed=1`;
  // A custom domain opens on the organizer's own events page.
  const organizerPageUrl = customHost ? `${base}/` : orgSlug ? `${base}/events/${orgSlug}` : null;

  const embedCode = `<iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(`Register for ${input.tournamentName}`)}" `
    + 'width="100%" height="900" style="border:0;max-width:720px;" loading="lazy"></iframe>';

  return {
    kind: customHost ? 'custom_domain' : onEventPage ? 'event_page' : 'direct',
    registerUrl,
    organizerPageUrl,
    embedUrl,
    embedCode,
    customDomainHostname: customHost,
  };
}

/**
 * Let another website show this page in an iframe (the share-kit embed).
 * Only the registration form opts in, and only with `?embed=1`; every other
 * page keeps helmet's same-origin framing rule. Session cookies are
 * SameSite=Lax, so a cross-site frame never carries a signed-in session.
 */
export function allowCrossOriginFraming(res: { removeHeader(name: string): void; getHeader(name: string): unknown; setHeader(name: string, value: string): unknown }): void {
  res.removeHeader('X-Frame-Options');
  const csp = res.getHeader('Content-Security-Policy');
  if (typeof csp === 'string') {
    const relaxed = /frame-ancestors[^;]*/i.test(csp)
      ? csp.replace(/frame-ancestors[^;]*/i, 'frame-ancestors *')
      : `${csp};frame-ancestors *`;
    res.setHeader('Content-Security-Policy', relaxed);
  }
}

/** Whether this request is for the embeddable registration form. */
export function isEmbeddableRegisterRequest(path: string, query: Record<string, unknown>): boolean {
  return path === '/register' && query.embed === '1';
}
