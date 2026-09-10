// Client-side resolver: takes a publicSlug from the URL, looks up the
// tournament via /api/public/tournaments/:slug (the same endpoint accepts
// both UUIDs and slugs), then navigates to /display/:tournamentId where
// the existing PublicScoreboard picks up.
//
// Cheaper than a full route handler for the slug-shaped URL, and keeps
// PublicScoreboard ignorant of slug semantics.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { buildResolvedScoreboardPath } from '../utils/public-scoreboard-url';

export function ScoreboardStatus({ error }: { error: string | null }) {
  if (error) {
    return (
      <main className="min-h-screen bg-surface-900 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <AlertCircle className="h-20 w-20 text-red-400 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-white mb-3">Scoreboard not found</h1>
          <p className="text-surface-300">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main
      aria-label="Loading scoreboard"
      className="min-h-screen bg-surface-900 flex items-center justify-center"
    >
      <Loader2 className="h-16 w-16 text-primary-400 animate-spin" />
    </main>
  );
}

export default function PublicScoreboardBySlug() {
  const { publicSlug } = useParams<{ publicSlug: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/tournaments/${encodeURIComponent(publicSlug)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setError('This share link is no longer active. Please ask the director for an updated link.');
          return;
        }
        if (!res.ok) {
          setError('Could not load this scoreboard. Please try again later.');
          return;
        }
        const data = await res.json();
        navigate(buildResolvedScoreboardPath(data.id, publicSlug), { replace: true });
      } catch {
        if (!cancelled) setError('Network error. Please try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [publicSlug, navigate]);

  return <ScoreboardStatus error={error} />;
}
