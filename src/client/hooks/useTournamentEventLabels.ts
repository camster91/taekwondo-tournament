import { useQuery } from '@tanstack/react-query';
import { getAuthHeaders } from '../context/AuthContext';
import { getEventTypeLabel, getEventTypeLabels } from '../../shared/constants/sport-profiles';

/**
 * Sport-specific names for a tournament's two stored event slots
 * ('patterns' / 'sparring'), e.g. Kata / Kumite for karate. Shares the
 * ['tournament', id] query other pages already use, so it is usually
 * served from cache. Falls back to Taekwondo names while loading.
 */
export function useTournamentEventLabels(tournamentId: string | undefined) {
  const { data } = useQuery<{ sportProfileSlug?: string | null }>({
    queryKey: ['tournament', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournament');
      return res.json();
    },
    enabled: Boolean(tournamentId),
  });
  const slug = data?.sportProfileSlug;
  return {
    labels: getEventTypeLabels(slug),
    eventLabel: (eventType: string) => getEventTypeLabel(slug, eventType),
  };
}
