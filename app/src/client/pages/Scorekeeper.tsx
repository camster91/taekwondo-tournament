import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Trophy,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  AlertTriangle,
  Clock,
  Users,
  Award,
} from 'lucide-react';

interface Match {
  id: string;
  matchNumber: number;
  roundNumber: number;
  bracketType: string;
  status: string;
  score1: string | null;
  score2: string | null;
  winnerId: string | null;
  competitor1: {
    id: string;
    competitor: { firstName: string; lastName: string; schoolDojang: string | null };
  } | null;
  competitor2: {
    id: string;
    competitor: { firstName: string; lastName: string; schoolDojang: string | null };
  } | null;
}

interface Division {
  id: string;
  name: string;
  eventType: string;
  bracket: {
    id: string;
    matches: Match[];
  } | null;
}

type ResultType = 'win' | 'dq' | 'forfeit' | 'injury';

export default function Scorekeeper() {
  const { tournamentId } = useParams();
  const queryClient = useQueryClient();

  const [selectedRing, setSelectedRing] = useState<number | null>(null);
  const [selectedDivision, setSelectedDivision] = useState<string | null>(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [score1, setScore1] = useState('');
  const [score2, setScore2] = useState('');
  const [selectedWinner, setSelectedWinner] = useState<string | null>(null);
  const [resultType, setResultType] = useState<ResultType>('win');
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  // Fetch divisions with brackets
  const { data: divisions, isLoading } = useQuery<Division[]>({
    queryKey: ['scorekeeper-divisions', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${tournamentId}`);
      return res.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Get ready matches for selected division
  const readyMatches =
    divisions
      ?.find((d) => d.id === selectedDivision)
      ?.bracket?.matches.filter((m) => m.status === 'ready' || m.status === 'in_progress')
      .sort((a, b) => a.matchNumber - b.matchNumber) || [];

  const currentMatch = readyMatches[currentMatchIndex];

  // Record result mutation
  const recordResult = useMutation({
    mutationFn: async (data: {
      matchId: string;
      winnerId: string;
      score1: string;
      score2: string;
      notes: string;
    }) => {
      const res = await fetch(`/api/brackets/match/${data.matchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winnerId: data.winnerId,
          score1: data.score1,
          score2: data.score2,
          status: 'completed',
          notes: data.notes,
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scorekeeper-divisions'] });
      resetForm();
      setShowConfirm(false);
      // Move to next match
      if (currentMatchIndex < readyMatches.length - 1) {
        setCurrentMatchIndex((prev) => prev + 1);
      }
    },
  });

  const resetForm = () => {
    setScore1('');
    setScore2('');
    setSelectedWinner(null);
    setResultType('win');
    setNotes('');
  };

  const handleSubmit = () => {
    if (!currentMatch || !selectedWinner) return;

    const noteText =
      resultType === 'win'
        ? notes
        : `${resultType.toUpperCase()}${notes ? `: ${notes}` : ''}`;

    recordResult.mutate({
      matchId: currentMatch.id,
      winnerId: selectedWinner,
      score1,
      score2,
      notes: noteText,
    });
  };

  const getCompetitorName = (competitor: Match['competitor1']) => {
    if (!competitor) return 'BYE';
    return `${competitor.competitor.firstName} ${competitor.competitor.lastName}`;
  };

  const getCompetitorSchool = (competitor: Match['competitor1']) => {
    if (!competitor) return '';
    return competitor.competitor.schoolDojang || 'No School';
  };

  // Division selector view
  if (!selectedDivision) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <Trophy className="h-8 w-8 text-yellow-500 mr-3" />
              <h1 className="text-2xl font-bold">Scorekeeper</h1>
            </div>
            <Link to={`/tournaments/${tournamentId}`} className="text-gray-400 hover:text-white">
              Exit
            </Link>
          </div>

          {isLoading ? (
            <div className="text-center py-12 text-gray-400">Loading divisions...</div>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-4 text-gray-300">Select Division</h2>
              <div className="grid gap-3">
                {divisions
                  ?.filter((d) => d.bracket)
                  .map((division) => {
                    const readyCount =
                      division.bracket?.matches.filter(
                        (m) => m.status === 'ready' || m.status === 'in_progress'
                      ).length || 0;
                    const completedCount =
                      division.bracket?.matches.filter((m) => m.status === 'completed').length || 0;
                    const totalCount = division.bracket?.matches.length || 0;

                    return (
                      <button
                        key={division.id}
                        onClick={() => {
                          setSelectedDivision(division.id);
                          setCurrentMatchIndex(0);
                          resetForm();
                        }}
                        className={`p-4 rounded-lg text-left transition-colors ${
                          readyCount > 0
                            ? 'bg-green-900 hover:bg-green-800 border-2 border-green-500'
                            : completedCount === totalCount
                            ? 'bg-gray-800 hover:bg-gray-700 opacity-50'
                            : 'bg-gray-800 hover:bg-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-lg">{division.name}</div>
                            <div className="text-sm text-gray-400 mt-1">
                              {division.eventType === 'patterns' ? 'Patterns' : 'Sparring'}
                            </div>
                          </div>
                          <div className="text-right">
                            {readyCount > 0 ? (
                              <span className="text-green-400 font-bold">{readyCount} ready</span>
                            ) : completedCount === totalCount ? (
                              <span className="text-gray-500">Complete</span>
                            ) : (
                              <span className="text-gray-500">Pending</span>
                            )}
                            <div className="text-xs text-gray-500 mt-1">
                              {completedCount}/{totalCount} done
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Match scoring view
  const division = divisions?.find((d) => d.id === selectedDivision);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedDivision(null)}
            className="flex items-center text-gray-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5 mr-1" />
            Back
          </button>
          <div className="text-center">
            <div className="font-semibold">{division?.name}</div>
            <div className="text-sm text-gray-400">
              Match {currentMatchIndex + 1} of {readyMatches.length}
            </div>
          </div>
          <div className="w-16" />
        </div>
      </div>

      {!currentMatch ? (
        <div className="p-8 text-center">
          <Check className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">All Matches Complete!</h2>
          <p className="text-gray-400 mb-6">No more ready matches in this division.</p>
          <button
            onClick={() => setSelectedDivision(null)}
            className="btn btn-primary px-8 py-3"
          >
            Select Another Division
          </button>
        </div>
      ) : (
        <>
          {/* Match Navigation */}
          <div className="flex items-center justify-between p-2 bg-gray-800/50">
            <button
              onClick={() => setCurrentMatchIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentMatchIndex === 0}
              className="p-2 rounded-lg bg-gray-700 disabled:opacity-30"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div className="text-sm text-gray-400">
              Match #{currentMatch.matchNumber} - Round {currentMatch.roundNumber} (
              {currentMatch.bracketType})
            </div>
            <button
              onClick={() =>
                setCurrentMatchIndex((prev) => Math.min(readyMatches.length - 1, prev + 1))
              }
              disabled={currentMatchIndex === readyMatches.length - 1}
              className="p-2 rounded-lg bg-gray-700 disabled:opacity-30"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>

          {/* Competitor Cards */}
          <div className="p-4 space-y-4">
            {/* Competitor 1 */}
            <button
              onClick={() => {
                if (currentMatch.competitor1) {
                  setSelectedWinner(currentMatch.competitor1.id);
                }
              }}
              disabled={!currentMatch.competitor1}
              className={`w-full p-6 rounded-xl text-left transition-all ${
                selectedWinner === currentMatch.competitor1?.id
                  ? 'bg-green-600 ring-4 ring-green-400'
                  : 'bg-gray-800 hover:bg-gray-700'
              } ${!currentMatch.competitor1 ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">
                    {getCompetitorName(currentMatch.competitor1)}
                  </div>
                  <div className="text-gray-400 mt-1">
                    {getCompetitorSchool(currentMatch.competitor1)}
                  </div>
                </div>
                {selectedWinner === currentMatch.competitor1?.id && (
                  <Award className="h-10 w-10 text-yellow-400" />
                )}
              </div>
            </button>

            <div className="text-center text-gray-500 font-bold">VS</div>

            {/* Competitor 2 */}
            <button
              onClick={() => {
                if (currentMatch.competitor2) {
                  setSelectedWinner(currentMatch.competitor2.id);
                }
              }}
              disabled={!currentMatch.competitor2}
              className={`w-full p-6 rounded-xl text-left transition-all ${
                selectedWinner === currentMatch.competitor2?.id
                  ? 'bg-green-600 ring-4 ring-green-400'
                  : 'bg-gray-800 hover:bg-gray-700'
              } ${!currentMatch.competitor2 ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">
                    {getCompetitorName(currentMatch.competitor2)}
                  </div>
                  <div className="text-gray-400 mt-1">
                    {getCompetitorSchool(currentMatch.competitor2)}
                  </div>
                </div>
                {selectedWinner === currentMatch.competitor2?.id && (
                  <Award className="h-10 w-10 text-yellow-400" />
                )}
              </div>
            </button>
          </div>

          {/* Score Entry */}
          <div className="p-4 bg-gray-800/50">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  {getCompetitorName(currentMatch.competitor1)} Score
                </label>
                <input
                  type="number"
                  value={score1}
                  onChange={(e) => setScore1(e.target.value)}
                  className="w-full p-4 text-2xl text-center bg-gray-700 rounded-lg"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  {getCompetitorName(currentMatch.competitor2)} Score
                </label>
                <input
                  type="number"
                  value={score2}
                  onChange={(e) => setScore2(e.target.value)}
                  className="w-full p-4 text-2xl text-center bg-gray-700 rounded-lg"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Result Type */}
            <div className="flex gap-2 mb-4">
              {(['win', 'dq', 'forfeit', 'injury'] as ResultType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setResultType(type)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    resultType === type
                      ? type === 'win'
                        ? 'bg-green-600'
                        : 'bg-red-600'
                      : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Notes */}
            {resultType !== 'win' && (
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes (optional)"
                className="w-full p-3 bg-gray-700 rounded-lg mb-4"
              />
            )}

            {/* Submit Button */}
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!selectedWinner}
              className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-xl text-xl font-bold transition-colors"
            >
              Record Result
            </button>
          </div>
        </>
      )}

      {/* Confirmation Modal */}
      {showConfirm && currentMatch && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Confirm Result</h3>

            <div className="bg-gray-700 rounded-lg p-4 mb-4">
              <div className="text-lg font-semibold text-green-400">
                Winner:{' '}
                {selectedWinner === currentMatch.competitor1?.id
                  ? getCompetitorName(currentMatch.competitor1)
                  : getCompetitorName(currentMatch.competitor2)}
              </div>
              <div className="text-gray-400 mt-2">
                Score: {score1 || '0'} - {score2 || '0'}
              </div>
              {resultType !== 'win' && (
                <div className="text-red-400 mt-1">Result: {resultType.toUpperCase()}</div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 bg-gray-600 hover:bg-gray-500 rounded-lg font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={recordResult.isPending}
                className="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-semibold"
              >
                {recordResult.isPending ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
