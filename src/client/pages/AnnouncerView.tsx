import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { buildScoreboardApiUrl } from '../utils/public-scoreboard-url';
import Spinner from '../components/ui/Spinner';

interface Match {
  id: string;
  matchNumber: number;
  status: string;
  competitor1Name: string | null;
  competitor2Name: string | null;
  competitor1School: string | null;
  competitor2School: string | null;
  ringNumber: number | null;
}

interface Division {
  id: string;
  name: string;
  eventType: string;
  bracket?: {
    matches: Array<{
      id: string;
      matchNumber: number;
      status: string;
      ringNumber: number | null;
      competitor1?: {
        competitor: {
          firstName: string;
          lastName: string;
          schoolDojang: string | null;
        };
      } | null;
      competitor2?: {
        competitor: {
          firstName: string;
          lastName: string;
          schoolDojang: string | null;
        };
      } | null;
    }>;
  };
}

interface ScoreboardData {
  divisions: Division[];
  displaySettings?: {
    mode?: string;
    ringNumber?: number;
  };
}

function AnnouncerView() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [searchParams] = useSearchParams();
  const publicKey = searchParams.get('key') || '';
  const [currentTime, setCurrentTime] = useState(new Date());

  // Auto-refresh time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch tournament info
  const { data: tournament, isLoading: tournamentLoading } = useQuery<{
    name: string;
    date: string;
    brandName?: string;
    brandPrimaryColor?: string;
  }>({
    queryKey: ['announcer-tournament', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/public/tournaments/${tournamentId}`);
      if (!res.ok) throw new Error('Tournament not found');
      return res.json();
    },
    refetchInterval: 30000, // 30s
  });

  // Fetch scoreboard data
  const { data: scoreboardData, isLoading: scoreboardLoading } = useQuery<ScoreboardData>({
    queryKey: ['announcer-data', tournamentId, publicKey],
    queryFn: async () => {
      const url = buildScoreboardApiUrl(tournamentId!, publicKey);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Scoreboard not found');
      return res.json();
    },
    refetchInterval: 10000, // 10s auto-refresh
  });

  if (tournamentLoading || scoreboardLoading) {
    return (
      <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!tournament || !scoreboardData) {
    return (
      <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">Announcer View Unavailable</h1>
          <p className="text-surface-300">Could not load tournament data.</p>
        </div>
      </div>
    );
  }

  // Extract all matches and categorize them
  const allMatches: Array<Match & { divisionName: string }> = [];
  
  scoreboardData.divisions.forEach((division) => {
    if (!division.bracket?.matches) return;
    division.bracket.matches.forEach((match) => {
      allMatches.push({
        id: match.id,
        matchNumber: match.matchNumber,
        status: match.status,
        competitor1Name: match.competitor1
          ? `${match.competitor1.competitor.firstName} ${match.competitor1.competitor.lastName}`
          : null,
        competitor2Name: match.competitor2
          ? `${match.competitor2.competitor.firstName} ${match.competitor2.competitor.lastName}`
          : null,
        competitor1School: match.competitor1?.competitor.schoolDojang || null,
        competitor2School: match.competitor2?.competitor.schoolDojang || null,
        ringNumber: match.ringNumber,
        divisionName: division.name,
      });
    });
  });

  // Filter for display
  const displayMode = scoreboardData.displaySettings?.mode || 'all';
  const displayRingNumber = scoreboardData.displaySettings?.ringNumber;
  
  let filteredMatches = allMatches;
  if (displayMode === 'single-ring' && displayRingNumber) {
    filteredMatches = allMatches.filter((m) => m.ringNumber === displayRingNumber);
  }

  // NOW COMPETING (in_progress)
  const nowCompeting = filteredMatches
    .filter((m) => m.status === 'in_progress')
    .sort((a, b) => {
      if (a.ringNumber !== b.ringNumber) return (a.ringNumber || 999) - (b.ringNumber || 999);
      return a.matchNumber - b.matchNumber;
    });

  // UP NEXT (ready, lowest match number per ring)
  const readyMatches = filteredMatches.filter((m) => m.status === 'ready');
  const upNextByRing = new Map<number, typeof filteredMatches[0]>();
  readyMatches.forEach((m) => {
    const ring = m.ringNumber || 0;
    const existing = upNextByRing.get(ring);
    if (!existing || m.matchNumber < existing.matchNumber) {
      upNextByRing.set(ring, m);
    }
  });
  const upNext = Array.from(upNextByRing.values()).sort((a, b) => (a.ringNumber || 0) - (b.ringNumber || 0));

  // ON DECK (ready, second-lowest match number per ring, excluding upNext)
  const upNextIds = new Set(upNext.map((m) => m.id));
  const onDeckByRing = new Map<number, typeof filteredMatches[0]>();
  readyMatches.forEach((m) => {
    if (upNextIds.has(m.id)) return;
    const ring = m.ringNumber || 0;
    const existing = onDeckByRing.get(ring);
    if (!existing || m.matchNumber < existing.matchNumber) {
      onDeckByRing.set(ring, m);
    }
  });
  const onDeck = Array.from(onDeckByRing.values()).sort((a, b) => (a.ringNumber || 0) - (b.ringNumber || 0));

  const brandColor = tournament.brandPrimaryColor || '#DC2626';

  return (
    <div className="min-h-screen bg-surface-950 text-white">
      {/* Header - enhanced for readability at distance */}
      <div className="border-b border-surface-700" style={{ borderBottomColor: brandColor, borderBottomWidth: '6px' }}>
        <div className="container mx-auto px-8 py-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-6xl font-bold mb-3 tracking-tight">{tournament.name}</h1>
              <p className="text-surface-300 text-2xl font-medium">
                {tournament.brandName || 'Tournament Announcer'}
              </p>
            </div>
            <div className="text-right text-surface-300">
              <div className="text-5xl font-mono font-bold tracking-wide">
                {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div className="text-lg mt-2 font-medium">
                {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8 space-y-8">
        {/* NOW COMPETING - enhanced for distance readability */}
        <section>
          <h2 className="text-5xl font-black mb-8 uppercase tracking-wider" style={{ color: brandColor }}>
            <span className="inline-block px-4 py-2 rounded-lg" style={{ backgroundColor: brandColor }}>
              <span className="text-white">NOW COMPETING</span>
            </span>
          </h2>
          {nowCompeting.length === 0 ? (
            <div className="bg-surface-900 rounded-xl p-16 text-center border-4 border-surface-700">
              <p className="text-surface-400 text-4xl font-medium">No matches currently in progress</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {nowCompeting.map((match) => (
                <div key={match.id} className="bg-surface-900 rounded-xl p-10 border-4 shadow-2xl" style={{ borderColor: brandColor }}>
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-2xl font-black px-4 py-2 rounded-lg" style={{ backgroundColor: brandColor, color: '#fff' }}>
                      RING {match.ringNumber || '?'}
                    </span>
                    <span className="text-surface-400 text-lg font-semibold">Match {match.matchNumber}</span>
                  </div>
                  <div className="mb-4">
                    <h3 className="text-2xl font-bold text-white truncate">{match.divisionName}</h3>
                  </div>
                  <div className="space-y-4 mt-6">
                    <div className="bg-surface-800 rounded-lg p-6 border-2 border-surface-600">
                      <p className="text-3xl font-bold truncate text-white">{match.competitor1Name || 'TBD'}</p>
                      {match.competitor1School && <p className="text-surface-300 text-lg mt-2 truncate font-medium">{match.competitor1School}</p>}
                    </div>
                    <div className="text-center text-surface-500 font-black text-2xl py-2">VS</div>
                    <div className="bg-surface-800 rounded-lg p-6 border-2 border-surface-600">
                      <p className="text-3xl font-bold truncate text-white">{match.competitor2Name || 'TBD'}</p>
                      {match.competitor2School && <p className="text-surface-300 text-lg mt-2 truncate font-medium">{match.competitor2School}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* UP NEXT - enhanced for distance readability */}
        <section>
          <h2 className="text-5xl font-black mb-8 uppercase tracking-wider text-warning">
            <span className="inline-block px-4 py-2 rounded-lg bg-warning">
              <span className="text-surface-900">UP NEXT</span>
            </span>
          </h2>
          {upNext.length === 0 ? (
            <div className="bg-surface-900 rounded-xl p-16 text-center border-4 border-surface-700">
              <p className="text-surface-400 text-4xl font-medium">No matches ready</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {upNext.map((match) => (
                <div key={match.id} className="bg-surface-900 rounded-xl p-10 border-4 border-warning shadow-2xl">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-2xl font-black px-4 py-2 rounded-lg bg-warning text-surface-900">
                      RING {match.ringNumber || '?'}
                    </span>
                    <span className="text-surface-400 text-lg font-semibold">Match {match.matchNumber}</span>
                  </div>
                  <div className="mb-4">
                    <h3 className="text-2xl font-bold text-white truncate">{match.divisionName}</h3>
                  </div>
                  <div className="space-y-4 mt-6">
                    <div className="bg-surface-800 rounded-lg p-6 border-2 border-warning/50">
                      <p className="text-3xl font-bold truncate text-white">{match.competitor1Name || 'TBD'}</p>
                      {match.competitor1School && <p className="text-surface-300 text-lg mt-2 truncate font-medium">{match.competitor1School}</p>}
                    </div>
                    <div className="text-center text-warning font-black text-2xl py-2">VS</div>
                    <div className="bg-surface-800 rounded-lg p-6 border-2 border-warning/50">
                      <p className="text-3xl font-bold truncate text-white">{match.competitor2Name || 'TBD'}</p>
                      {match.competitor2School && <p className="text-surface-300 text-lg mt-2 truncate font-medium">{match.competitor2School}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ON DECK - enhanced for distance readability */}
        <section>
          <h2 className="text-5xl font-black mb-8 uppercase tracking-wider text-info">
            <span className="inline-block px-4 py-2 rounded-lg bg-info">
              <span className="text-white">ON DECK</span>
            </span>
          </h2>
          {onDeck.length === 0 ? (
            <div className="bg-surface-900 rounded-xl p-16 text-center border-4 border-surface-700">
              <p className="text-surface-400 text-4xl font-medium">No matches on deck</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {onDeck.map((match) => (
                <div key={match.id} className="bg-surface-900 rounded-xl p-8 border-4 border-info shadow-lg">
                  <div className="flex items-center justify-between mb-5">
                    <span className="text-xl font-bold px-3 py-1 rounded-lg bg-info text-white">
                      RING {match.ringNumber || '?'}
                    </span>
                    <span className="text-surface-400 text-base font-semibold">Match {match.matchNumber}</span>
                  </div>
                  <div className="mb-3">
                    <h3 className="text-xl font-bold text-white truncate">{match.divisionName}</h3>
                  </div>
                  <div className="space-y-3 mt-4">
                    <div className="bg-surface-800 rounded-lg p-4 border border-info/30">
                      <p className="text-2xl font-bold truncate text-white">{match.competitor1Name || 'TBD'}</p>
                      {match.competitor1School && <p className="text-surface-300 text-base mt-1 truncate">{match.competitor1School}</p>}
                    </div>
                    <div className="text-center text-info font-bold text-xl py-1">VS</div>
                    <div className="bg-surface-800 rounded-lg p-4 border border-info/30">
                      <p className="text-2xl font-bold truncate text-white">{match.competitor2Name || 'TBD'}</p>
                      {match.competitor2School && <p className="text-surface-300 text-base mt-1 truncate">{match.competitor2School}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="text-center py-8 text-surface-500 text-lg font-medium">
        Auto-refreshes every 10 seconds
      </div>
    </div>
  );
}

export default AnnouncerView;
