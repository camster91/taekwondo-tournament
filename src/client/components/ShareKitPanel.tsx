import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Share2, Copy, ExternalLink, Download, Printer, Check } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { Card, CardHeader, CardBody, Button, Input, Textarea } from './ui';
import Spinner from './ui/Spinner';

/** GET /api/tournaments/:id/share-links */
export interface ShareLinksResponse {
  kind: 'custom_domain' | 'event_page' | 'direct';
  registerUrl: string;
  organizerPageUrl: string | null;
  embedUrl: string;
  embedCode: string;
  customDomainHostname: string | null;
  qrCodeDataUrl: string;
  registrationOpen: boolean;
  posterAvailable: boolean;
}

type CopyTarget = 'link' | 'organizer' | 'embed';

/** Plain-words note under the link: where it goes and how to improve it. */
export function shareLinkHint(links: Pick<ShareLinksResponse, 'kind' | 'customDomainHostname'>): string {
  if (links.kind === 'custom_domain') return `This link uses your own web address (${links.customDomainHostname}).`;
  if (links.kind === 'event_page') return 'This link opens your event page.';
  return 'This link opens the sign-up form. You can add your own web address under Organization settings.';
}

/**
 * Share kit for directors: the registration link (the organizer's own web
 * address when one is set up), a QR code, and code to put the sign-up form
 * on the organizer's website.
 */
export default function ShareKitPanel({ tournamentId, tournamentName }: { tournamentId: string; tournamentName: string }) {
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  const { data: links, isLoading, isError, refetch } = useQuery<ShareLinksResponse>({
    queryKey: ['tournament-share-links', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/share-links`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load share links');
      return res.json();
    },
  });

  const copy = async (target: CopyTarget, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
      setCopied(target);
      setTimeout(() => setCopied((current) => (current === target ? null : current)), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  const copyLabel = (target: CopyTarget, label: string) => (copied === target ? 'Copied!' : label);
  const qrFileName = `${tournamentName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'tournament'}_QR.png`;

  return (
    <section data-testid="share-kit" aria-label="Share">
      <Card>
        <CardHeader
          title="Share"
          icon={Share2}
          description="Send families the sign-up link, print the QR code, or put the form on your website."
        />
        <CardBody className="space-y-5">
          {isLoading && (
            <div className="flex justify-center py-6" aria-busy="true">
              <Spinner size="md" />
            </div>
          )}

          {isError && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-sm text-danger" role="alert">
              <span>We couldn't load the share links. Check your connection and try again.</span>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>Try again</Button>
            </div>
          )}

          {links && (
            <>
              {!links.registrationOpen && (
                <p className="text-sm rounded-lg border border-warning/30 bg-warning/10 dark:bg-warning/20 p-3 text-surface-800 dark:text-surface-100">
                  Registration isn't open yet. Families who use this link can't sign up until you open registration.
                </p>
              )}

              <div>
                <label htmlFor="share-register-url" className="block text-sm font-medium text-surface-800 dark:text-surface-200">
                  Sign-up link
                </label>
                <div className="mt-1 flex flex-col sm:flex-row gap-2">
                  <Input
                    id="share-register-url"
                    readOnly
                    value={links.registerUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="sm:flex-1 min-w-0 font-mono"
                  />
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={() => copy('link', links.registerUrl)} aria-label="Copy sign-up link">
                      {copied === 'link' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copyLabel('link', 'Copy link')}
                    </Button>
                    <Button as="a" href={links.registerUrl} target="_blank" rel="noopener noreferrer" variant="secondary" size="sm" aria-label="Open sign-up link in a new tab">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </Button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-surface-600 dark:text-surface-400" data-testid="share-link-hint">{shareLinkHint(links)}</p>
              </div>

              {links.organizerPageUrl && (
                <div>
                  <label htmlFor="share-organizer-url" className="block text-sm font-medium text-surface-800 dark:text-surface-200">
                    All your events
                  </label>
                  <div className="mt-1 flex flex-col sm:flex-row gap-2">
                    <Input
                      id="share-organizer-url"
                      readOnly
                      value={links.organizerPageUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="sm:flex-1 min-w-0 font-mono"
                    />
                    <Button variant="secondary" size="sm" onClick={() => copy('organizer', links.organizerPageUrl!)} aria-label="Copy link to all your events">
                      <Copy className="h-3.5 w-3.5" />
                      {copyLabel('organizer', 'Copy link')}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
                <img
                  src={links.qrCodeDataUrl}
                  alt="QR code for the sign-up link"
                  className="h-40 w-40 rounded-lg border border-surface-200 dark:border-surface-700 bg-white p-1 self-center sm:self-auto"
                />
                <div className="space-y-2">
                  <p className="text-sm text-surface-700 dark:text-surface-300">
                    Phones can scan this to open the sign-up link. Put it on flyers or at the front desk.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button as="a" href={links.qrCodeDataUrl} download={qrFileName} variant="secondary" size="sm">
                      <Download className="h-3.5 w-3.5" />
                      Download QR code
                    </Button>
                    {links.posterAvailable && (
                      <Button as="a" href={`/api/tournaments/${tournamentId}/qr-poster`} download variant="secondary" size="sm">
                        <Printer className="h-3.5 w-3.5" />
                        Printable poster
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <details className="rounded-lg border border-surface-200 dark:border-surface-700 p-3">
                <summary className="cursor-pointer text-sm font-medium text-surface-800 dark:text-surface-200">
                  Put the sign-up form on your website
                </summary>
                <p className="mt-2 text-sm text-surface-600 dark:text-surface-400">
                  Copy this code and paste it into your website where the form should appear.
                </p>
                <Textarea
                  readOnly
                  aria-label="Code for your website"
                  value={links.embedCode}
                  rows={3}
                  onFocus={(e) => e.currentTarget.select()}
                  className="mt-2 w-full font-mono text-xs"
                />
                <Button className="mt-2" variant="secondary" size="sm" onClick={() => copy('embed', links.embedCode)} aria-label="Copy website code">
                  <Copy className="h-3.5 w-3.5" />
                  {copyLabel('embed', 'Copy code')}
                </Button>
              </details>

              {copyFailed && (
                <p className="text-sm text-danger" role="alert">
                  Copying didn't work in this browser. Select the text and copy it yourself.
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
