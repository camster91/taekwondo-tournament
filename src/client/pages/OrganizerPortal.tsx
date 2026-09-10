/**
 * OrganizerPortal — Public-facing portal landing page for an organization.
 * Shows all published events for the organizer with tenant branding.
 * 
 * Route: /events/:orgSlug
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Calendar, MapPin, Users, ExternalLink, ArrowRight } from 'lucide-react';
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
  brandName: string;
  brandPrimaryColor: string;
  brandLogoUrl: string | null;
}

export default function OrganizerPortal() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const [loading, setLoading] = useState(true);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgSlug) return;

    const fetchPortalData = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/public/portal/${orgSlug}`);
        if (!response.ok) {
          throw new Error('Failed to load events');
        }

        const data = await response.json();
        setOrganization(data.organization);
        setEvents(data.events || []);
      } catch (err) {
        console.error('Failed to fetch portal data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load events');
      } finally {
        setLoading(false);
      }
    };

    fetchPortalData();
  }, [orgSlug]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Events Not Found</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            We couldn't find any published events for this organizer.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  const brandColor = organization.brandPrimaryColor || '#DC2626';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-700 dark:bg-slate-800/80">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            {organization.brandLogoUrl && (
              <img
                src={organization.brandLogoUrl}
                alt={organization.name}
                className="h-12 w-12 rounded-lg object-contain"
              />
            )}
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                {organization.name}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Tournament Events
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Events Grid */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {events.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-800">
            <Calendar className="mx-auto h-12 w-12 text-slate-400" />
            <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
              No Upcoming Events
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Check back soon for upcoming tournament events.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <Link
                key={event.id}
                to={`/events/${orgSlug}/${event.slug}`}
                className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all hover:shadow-lg dark:border-slate-700 dark:bg-slate-800"
              >
                {/* Status Badge */}
                {event.status === 'registration' && (
                  <div
                    className="absolute right-4 top-4 rounded-full px-3 py-1 text-xs font-medium text-white"
                    style={{ backgroundColor: brandColor }}
                  >
                    Registration Open
                  </div>
                )}

                <div className="p-6">
                  <h3 className="text-lg font-semibold text-slate-900 group-hover:text-primary-600 dark:text-white dark:group-hover:text-primary-400">
                    {event.name}
                  </h3>

                  <div className="mt-4 space-y-2">
                    {/* Date */}
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <Calendar className="h-4 w-4" />
                      <span>{new Date(event.date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}</span>
                    </div>

                    {/* Location */}
                    {event.location && (
                      <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                        <MapPin className="h-4 w-4" />
                        <span>{event.location}</span>
                      </div>
                    )}

                    {/* Registration Count */}
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <Users className="h-4 w-4" />
                      <span>{event.registrationCount} registered</span>
                    </div>
                  </div>

                  {/* Call to Action */}
                  <div className="mt-6 flex items-center justify-between">
                    <span
                      className="text-sm font-medium"
                      style={{ color: brandColor }}
                    >
                      View Event
                    </span>
                    <ArrowRight
                      className="h-5 w-5 transition-transform group-hover:translate-x-1"
                      style={{ color: brandColor }}
                    />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
