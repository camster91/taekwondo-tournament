/**
 * EventPortal — Public-facing landing page for a specific event.
 * Shows event details, registration link, scoreboard link, and schedule.
 * 
 * Route: /events/:orgSlug/:eventSlug
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Calendar, MapPin, Users, ExternalLink, Trophy, FileText, DollarSign } from 'lucide-react';
import Spinner from '../components/ui/Spinner';

interface Organization {
  name: string;
  slug: string;
  brandPrimaryColor: string;
  brandLogoUrl: string | null;
}

interface Event {
  id: string;
  slug: string | null;
  name: string;
  date: string;
  location: string | null;
  status: string;
  registrationCount: number;
  registrationFee: string | null;
  publicScoreboardSlug: string | null;
  brandName: string;
  brandPrimaryColor: string;
  brandLogoUrl: string | null;
  portalUrl: string;
  registerUrl: string;
  scoreboardUrl: string | null;
}

export default function EventPortal() {
  const { orgSlug, eventSlug } = useParams<{ orgSlug: string; eventSlug: string }>();
  const [loading, setLoading] = useState(true);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgSlug || !eventSlug) return;

    const fetchEventData = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/public/portal/${orgSlug}/${eventSlug}`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Event not found');
          }
          throw new Error('Failed to load event');
        }

        const data = await response.json();
        setOrganization(data.organization);
        setEvent(data.event);
      } catch (err) {
        console.error('Failed to fetch event data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load event');
      } finally {
        setLoading(false);
      }
    };

    fetchEventData();
  }, [orgSlug, eventSlug]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !event || !organization) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Event Not Found</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            This event is not currently available or has been unpublished.
          </p>
          <Link
            to={orgSlug ? `/events/${orgSlug}` : '/'}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            {orgSlug ? 'View All Events' : 'Return Home'}
          </Link>
        </div>
      </div>
    );
  }

  const brandColor = event.brandPrimaryColor || organization.brandPrimaryColor || '#DC2626';
  const isRegistrationOpen = event.status === 'registration';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-700 dark:bg-slate-800/80">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {(event.brandLogoUrl || organization.brandLogoUrl) && (
                <img
                  src={event.brandLogoUrl || organization.brandLogoUrl || ''}
                  alt={organization.name}
                  className="h-12 w-12 rounded-lg object-contain"
                />
              )}
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {event.name}
                </h1>
                <Link
                  to={`/events/${orgSlug}`}
                  className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  {organization.name}
                </Link>
              </div>
            </div>

            {isRegistrationOpen && (
              <Link
                to={event.registerUrl}
                className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:shadow-xl"
                style={{ backgroundColor: brandColor }}
              >
                Register Now
                <ExternalLink className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Event Details Card */}
          <div className="lg:col-span-2">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Event Details
              </h2>

              <div className="mt-6 space-y-4">
                {/* Date */}
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">Date</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {new Date(event.date).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>

                {/* Location */}
                {event.location && (
                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">Location</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{event.location}</p>
                    </div>
                  </div>
                )}

                {/* Registration Count */}
                <div className="flex items-start gap-3">
                  <Users className="h-5 w-5 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">Competitors</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {event.registrationCount} registered
                    </p>
                  </div>
                </div>

                {/* Registration Fee */}
                {event.registrationFee && (
                  <div className="flex items-start gap-3">
                    <DollarSign className="h-5 w-5 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">Entry Fee</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {event.registrationFee}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Status Banner */}
              {!isRegistrationOpen && (
                <div className="mt-6 rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    {event.status === 'draft' && 'Registration has not opened yet.'}
                    {event.status === 'brackets' && 'Registration is closed. Brackets are being prepared.'}
                    {event.status === 'in_progress' && 'Tournament is currently in progress!'}
                    {event.status === 'completed' && 'Tournament has concluded. Thanks for participating!'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions Sidebar */}
          <div className="space-y-6">
            {/* Register Card */}
            {isRegistrationOpen && (
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Registration
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  Register to compete in this event
                </p>
                <Link
                  to={`/register?portal=${orgSlug}/${eventSlug}`}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
                  style={{ backgroundColor: brandColor }}
                >
                  Register Now
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            )}

            {/* Scoreboard Card */}
            {event.scoreboardUrl && (
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5" style={{ color: brandColor }} />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Live Scoreboard
                  </h3>
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  View live brackets and results
                </p>
                <Link
                  to={event.scoreboardUrl}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all hover:shadow-sm"
                  style={{
                    borderColor: brandColor,
                    color: brandColor,
                  }}
                >
                  View Scoreboard
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            )}

            {/* Check Registration Card */}
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5" style={{ color: brandColor }} />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Check Registration
                </h3>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Look up your registration status
              </p>
              <Link
                to={`/check-registration?tournament=${event.id}`}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all hover:shadow-sm"
                style={{
                  borderColor: brandColor,
                  color: brandColor,
                }}
              >
                Check Status
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
