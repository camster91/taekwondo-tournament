import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Download,
  Users,
  Trophy,
  Shuffle,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Spinner from '../components/ui/Spinner';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface Competitor {
  id: string;
  firstName: string;
  lastName: string;
  schoolDojang: string | null;
}

interface Registration {
  id: string;
  competitor: Competitor;
}

interface Match {
  id: string;
  matchNumber: number;
  roundNumber: number;
  bracketType: string;
  competitor1Id: string | null;
  competitor2Id: string | null;
  winnerId: string | null;
  status: string;
  competitor1: { competitor: Competitor } | null;
  competitor2: { competitor: Competitor } | null;
  winner: { competitor: Competitor } | null;
}

interface Bracket {
  id: string;
  structure: string;
  matches: Match[];
}

interface Division {
  id: string;
  name: string;
  beltLevel: string;
  gender: string;
  eventType: string;
  ageMin: number;
  ageMax: number;
  assignments: Array<{
    id: string;
    registration: Registration;
  }>;
  bracket: Bracket | null;
}

export default function BracketEditor() {
  const { tournamentId, divisionId } = useParams<{
    tournamentId: string;
    divisionId: string;
  }>();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [showReseedConfirm, setShowReseedConfirm] = useState(false);

  const { data: division, isLoading } = useQuery<Division>({
    queryKey: ['division', divisionId],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/${divisionId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch division');
      return res.json();
    },
  });

  const generateBracketMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/brackets/division/${divisionId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ seedingStrategy: 'school_spread' }),
      });
      if (!res.ok) throw new Error('Failed to generate bracket');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['division', divisionId] });
    },
  });

  const updateMatchMutation = useMutation({
    mutationFn: async ({
      matchId,
      winnerId,
    }: {
      matchId: string;
      winnerId: string;
    }) => {
      const res = await fetch(`/api/brackets/match/${matchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ winnerId, status: 'completed' }),
      });
      if (!res.ok) throw new Error('Failed to update match');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['division', divisionId] });
    },
  });

  const resetBracketMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/brackets/division/${divisionId}/reset`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['division', divisionId] });
    },
  });

  const exportPDF = async () => {
    if (!division) return;
    try {
      const res = await fetch(`/api/brackets/division/${divisionId}/pdf`);
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${division.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      addToast('Error exporting PDF. Please try again.', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (!division) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        Division not found
      </div>
    );
  }

  const winnersMatches =
    division.bracket?.matches.filter((m) => m.bracketType === 'winners') || [];
  const losersMatches =
    division.bracket?.matches.filter((m) => m.bracketType === 'losers') || [];
  const finalsMatches =
    division.bracket?.matches.filter((m) => m.bracketType === 'finals') || [];

  return (
    <div>
      {/* Page Header */}
      <div className="page-header mb-6">
        <div>
          <Link
            to={`/tournaments/${tournamentId}/divisions`}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Divisions
          </Link>
          <h1 className="page-title">{division.name}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {division.assignments.length} competitors
          </p>
        </div>
        <div className="flex gap-2 sm:gap-3">
          {division.bracket ? (
            <>
              <button
                onClick={() => setShowReseedConfirm(true)}
                disabled={generateBracketMutation.isPending}
                className="btn btn-secondary"
              >
                {generateBracketMutation.isPending ? (
                  <Spinner size="sm" className="mr-2" />
                ) : (
                  <Shuffle className="h-4 w-4 mr-2" />
                )}
                <span className="hidden sm:inline">Reseed</span>
              </button>
              <button onClick={exportPDF} className="btn btn-secondary">
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Export PDF</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => generateBracketMutation.mutate()}
              disabled={generateBracketMutation.isPending}
              className="btn btn-primary"
            >
              {generateBracketMutation.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Generate Bracket
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Competitors List */}
      <div className="card mb-6">
        <div className="card-header">
          <h3 className="font-medium text-gray-900 dark:text-white flex items-center">
            <Users className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
            Competitors ({division.assignments.length})
          </h3>
        </div>
        <div className="card-body">
          <div className="flex flex-wrap gap-2">
            {division.assignments.map((a, i) => (
              <span
                key={a.id}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <span className="font-medium mr-1">{i + 1}.</span>
                {a.registration.competitor.firstName}{' '}
                {a.registration.competitor.lastName}
                {a.registration.competitor.schoolDojang && (
                  <span className="ml-1 text-gray-500 dark:text-gray-400 text-xs">
                    ({a.registration.competitor.schoolDojang})
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Bracket Visualization */}
      {division.bracket ? (
        <div className="card">
          <div className="card-header">
            <h3 className="font-medium text-gray-900 dark:text-white flex items-center">
              <Trophy className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Bracket
            </h3>
          </div>
          <div className="card-body overflow-x-auto">
            {/* Winners Bracket */}
            <div className="mb-8">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                Winners Bracket
              </h4>
              <div className="flex gap-8">
                {[1, 2, 3].map((round) => (
                  <div key={round} className="space-y-4">
                    <div className="text-xs text-gray-500 dark:text-gray-400 text-center mb-2">
                      Round {round}
                    </div>
                    {winnersMatches
                      .filter((m) => m.roundNumber === round)
                      .map((match) => (
                        <MatchCard
                          key={match.id}
                          match={match}
                          onSelectWinner={(winnerId) =>
                            updateMatchMutation.mutate({
                              matchId: match.id,
                              winnerId,
                            })
                          }
                        />
                      ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Losers Bracket */}
            <div className="mb-8">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                Losers Bracket
              </h4>
              <div className="flex gap-8">
                {[1, 2, 3, 4].map((round) => {
                  const roundMatches = losersMatches.filter(
                    (m) => m.roundNumber === round
                  );
                  if (roundMatches.length === 0) return null;
                  return (
                    <div key={round} className="space-y-4">
                      <div className="text-xs text-gray-500 dark:text-gray-400 text-center mb-2">
                        Round {round}
                      </div>
                      {roundMatches.map((match) => (
                        <MatchCard
                          key={match.id}
                          match={match}
                          onSelectWinner={(winnerId) =>
                            updateMatchMutation.mutate({
                              matchId: match.id,
                              winnerId,
                            })
                          }
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Grand Finals */}
            {finalsMatches.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                  Grand Finals
                </h4>
                <div className="flex gap-8">
                  {finalsMatches.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      onSelectWinner={(winnerId) =>
                        updateMatchMutation.mutate({
                          matchId: match.id,
                          winnerId,
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-body text-center py-12">
            <Trophy className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" />
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
              No bracket generated
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Generate a bracket to start the competition.
            </p>
            <button
              onClick={() => generateBracketMutation.mutate()}
              disabled={generateBracketMutation.isPending}
              className="mt-4 btn btn-primary"
            >
              {generateBracketMutation.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Generating...
                </>
              ) : (
                'Generate Bracket'
              )}
            </button>
          </div>
        </div>
      )}

      {/* Reseed Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showReseedConfirm}
        onClose={() => setShowReseedConfirm(false)}
        onConfirm={() => {
          generateBracketMutation.mutate();
          setShowReseedConfirm(false);
        }}
        title="Regenerate Bracket"
        message="Are you sure you want to regenerate the bracket? This will reset all match results and reseed competitors."
        confirmText="Reseed Bracket"
        variant="warning"
      />
    </div>
  );
}

function MatchCard({
  match,
  onSelectWinner,
}: {
  match: Match;
  onSelectWinner: (winnerId: string) => void;
}) {
  const name1 = match.competitor1
    ? `${match.competitor1.competitor.firstName} ${match.competitor1.competitor.lastName}`
    : match.competitor1Id
    ? 'TBD'
    : 'BYE';

  const name2 = match.competitor2
    ? `${match.competitor2.competitor.firstName} ${match.competitor2.competitor.lastName}`
    : match.competitor2Id
    ? 'TBD'
    : 'BYE';

  const isReady = match.competitor1Id && match.competitor2Id && !match.winnerId;
  const isComplete = !!match.winnerId;

  return (
    <div
      className={`w-48 border rounded-lg overflow-hidden ${
        isComplete
          ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30'
          : isReady
          ? 'border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/30'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
      }`}
    >
      <div className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400 flex justify-between">
        <span>Match {match.matchNumber}</span>
        <span className="capitalize">{match.status}</span>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        <button
          onClick={() =>
            isReady && match.competitor1Id && onSelectWinner(match.competitor1Id)
          }
          disabled={!isReady}
          className={`w-full px-3 py-2 text-left text-sm truncate text-gray-900 dark:text-gray-100 ${
            match.winnerId === match.competitor1Id
              ? 'bg-green-100 dark:bg-green-800/50 font-semibold'
              : isReady
              ? 'hover:bg-gray-50 dark:hover:bg-gray-700'
              : ''
          }`}
        >
          {name1}
          {match.competitor1?.competitor.schoolDojang && (
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
              ({match.competitor1.competitor.schoolDojang.substring(0, 8)})
            </span>
          )}
        </button>
        <button
          onClick={() =>
            isReady && match.competitor2Id && onSelectWinner(match.competitor2Id)
          }
          disabled={!isReady}
          className={`w-full px-3 py-2 text-left text-sm truncate text-gray-900 dark:text-gray-100 ${
            match.winnerId === match.competitor2Id
              ? 'bg-green-100 dark:bg-green-800/50 font-semibold'
              : isReady
              ? 'hover:bg-gray-50 dark:hover:bg-gray-700'
              : ''
          }`}
        >
          {name2}
          {match.competitor2?.competitor.schoolDojang && (
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
              ({match.competitor2.competitor.schoolDojang.substring(0, 8)})
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
