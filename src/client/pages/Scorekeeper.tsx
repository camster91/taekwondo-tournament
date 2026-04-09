import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Keyboard,
  Timer,
} from 'lucide-react';
import MatchTimer from '../components/MatchTimer';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getSportProfile } from '../../shared/constants/sport-profiles';

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

interface Tournament {
  id: string;
  sportProfileSlug: string | null;
}

type ResultType = 'win' | 'dq' | 'forfeit' | 'injury';

export default function Scorekeeper() {
  const { tournamentId } = useParams();
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const [selectedRing, setSelectedRing] = useState<number | null>(null);
  const [selectedDivision, setSelectedDivision] = useState<string | null>(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [score1, setScore1] = useState('');
  const [score2, setScore2] = useState('');
  const [selectedWinner, setSelectedWinner] = useState<string | null>(null);
  const [resultType, setResultType] = useState<ResultType>('win');
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [showTimer, setShowTimer] = useState(true);
  const [penalties1, setPenalties1] = useState(0); // {sportProfile.scoringConfig.penaltyName} for competitor 1
  const [penalties2, setPenalties2] = useState(0); // {sportProfile.scoringConfig.penaltyName} for competitor 2
  const [divisionSearch, setDivisionSearch] = useState('');

  // Fetch tournament for sport profile
  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['tournament', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournament');
      return res.json();
    },
  });

  const sportProfile = useMemo(() => {
    const slug = tournament?.sportProfileSlug || 'taekwondo';
    return getSportProfile(slug) ?? getSportProfile('taekwondo')!;
  }, [tournament]);

  const getEventLabel = (eventType: string) => {
    const idx = eventType === 'patterns' ? 0 : 1;
    return sportProfile.eventTypes[idx]?.name ?? eventType;
  };

  // Fetch divisions with brackets
  const { data: divisions, isLoading } = useQuery<Division[]>({
    queryKey: ['scorekeeper-divisions', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${tournamentId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch divisions');
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
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          winnerId: data.winnerId,
          score1: data.score1,
          score2: data.score2,
          status: 'completed',
          notes: data.notes,
        }),
      });
      if (!res.ok) throw new Error('Failed to record match result');
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
    onError: (error: Error) => {
      addToast(error.message || 'Operation failed', 'error');
    },
  });

  // Undo match result mutation
  const undoMatchResult = useMutation({
    mutationFn: async (matchId: string) => {
      const res = await fetch(`/api/brackets/match/${matchId}/undo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error('Failed to undo match result');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scorekeeper-divisions'] });
      addToast('Match result undone', 'success');
    },
    onError: (error: Error) => {
      addToast(error.message || 'Operation failed', 'error');
    },
  });

  const resetForm = () => {
    setScore1('');
    setScore2('');
    setSelectedWinner(null);
    setResultType('win');
    setNotes('');
    setPenalties1(0);
    setPenalties2(0);
  };

  const handleSubmit = () => {
    if (!currentMatch || !selectedWinner) return;

    // Build notes with penalties and result type
    let noteText = '';
    if (penalties1 > 0 || penalties2 > 0) {
      const penaltyNotes = [];
      const penaltyName = sportProfile.scoringConfig.penaltyName.toLowerCase();
      if (penalties1 > 0) penaltyNotes.push(`${getCompetitorName(currentMatch.competitor1).split(' ')[0]}: ${penalties1} ${penaltyName}`);
      if (penalties2 > 0) penaltyNotes.push(`${getCompetitorName(currentMatch.competitor2).split(' ')[0]}: ${penalties2} ${penaltyName}`);
      noteText = `Penalties: ${penaltyNotes.join(', ')}`;
    }
    if (resultType !== 'win') {
      noteText = noteText ? `${noteText}. ${resultType.toUpperCase()}` : resultType.toUpperCase();
    }
    if (notes) {
      noteText = noteText ? `${noteText}. ${notes}` : notes;
    }

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

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // In confirmation modal
      if (showConfirm) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setShowConfirm(false);
        }
        return;
      }

      // Match scoring view shortcuts
      if (selectedDivision && currentMatch) {
        switch (e.key) {
          case '1':
          case 'ArrowUp':
            e.preventDefault();
            if (currentMatch.competitor1) {
              setSelectedWinner(currentMatch.competitor1.id);
            }
            break;
          case '2':
          case 'ArrowDown':
            e.preventDefault();
            if (currentMatch.competitor2) {
              setSelectedWinner(currentMatch.competitor2.id);
            }
            break;
          case 'ArrowLeft':
            e.preventDefault();
            setCurrentMatchIndex((prev) => Math.max(0, prev - 1));
            break;
          case 'ArrowRight':
            e.preventDefault();
            setCurrentMatchIndex((prev) => Math.min(readyMatches.length - 1, prev + 1));
            break;
          case 'Enter':
            e.preventDefault();
            if (selectedWinner) {
              setShowConfirm(true);
            }
            break;
          case 'Escape':
            e.preventDefault();
            setSelectedDivision(null);
            break;
          case 'w':
            e.preventDefault();
            setResultType('win');
            break;
          case 'd':
            e.preventDefault();
            setResultType('dq');
            break;
          case 'f':
            e.preventDefault();
            setResultType('forfeit');
            break;
          case 'i':
            e.preventDefault();
            setResultType('injury');
            break;
          case '?':
            e.preventDefault();
            setShowKeyboardHelp((prev) => !prev);
            break;
          case 't':
            e.preventDefault();
            setShowTimer((prev) => !prev);
            break;
        }
      }
    },
    [showConfirm, selectedDivision, currentMatch, selectedWinner, readyMatches.length, handleSubmit]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

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
              <input
                type="text"
                placeholder="Search divisions..."
                value={divisionSearch}
                onChange={(e) => setDivisionSearch(e.target.value)}
                className="w-full px-4 py-2 mb-4 rounded-lg bg-gray-800 text-white border border-gray-700 focus:border-yellow-500 focus:outline-none"
              />
              <div className="grid gap-3">
                {divisions
                  ?.filter((d) => d.bracket && (!divisionSearch || d.name.toLowerCase().includes(divisionSearch.toLowerCase())))
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
                              {getEventLabel(division.eventType)}
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTimer(!showTimer)}
              className={`flex items-center text-sm px-2 py-1 rounded ${showTimer ? 'bg-green-600' : 'bg-gray-700'}`}
              title="Toggle timer"
            >
              <Timer className="h-4 w-4 mr-1" />
              Timer
            </button>
            <button
              onClick={() => setShowKeyboardHelp(true)}
              className="flex items-center text-gray-400 hover:text-white text-sm"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Match Timer */}
      {showTimer && division?.eventType === 'sparring' && sportProfile.eventTypes[1]?.isCombat && (
        <div className="p-4 border-b border-gray-800">
          <MatchTimer
            defaultRoundTime={120}
            defaultRounds={2}
            defaultBreakTime={30}
          />
        </div>
      )}

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
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (currentMatch.competitor1) {
                    setSelectedWinner(currentMatch.competitor1.id);
                  }
                }}
                disabled={!currentMatch.competitor1}
                className={`flex-1 p-6 rounded-xl text-left transition-all ${
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
                    {penalties1 > 0 && (
                      <div className="text-red-400 text-sm mt-1">
                        {penalties1} {sportProfile.scoringConfig.penaltyName} ({penalties1} pts to opponent)
                      </div>
                    )}
                  </div>
                  {selectedWinner === currentMatch.competitor1?.id && (
                    <Award className="h-10 w-10 text-yellow-400" />
                  )}
                </div>
              </button>
              {/* Penalty Controls for Competitor 1 */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties1(p => p + 1); }}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-bold"
                  title={`Add ${sportProfile.scoringConfig.penaltyName}`}
                >
                  +{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties1(p => Math.max(0, p - 1)); }}
                  disabled={penalties1 === 0}
                  className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm disabled:opacity-50"
                  title={`Remove ${sportProfile.scoringConfig.penaltyName}`}
                >
                  -{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <div className="text-center text-xl font-bold text-red-400">
                  {penalties1}
                </div>
              </div>
            </div>

            <div className="text-center text-gray-500 font-bold">VS</div>

            {/* Competitor 2 */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (currentMatch.competitor2) {
                    setSelectedWinner(currentMatch.competitor2.id);
                  }
                }}
                disabled={!currentMatch.competitor2}
                className={`flex-1 p-6 rounded-xl text-left transition-all ${
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
                    {penalties2 > 0 && (
                      <div className="text-red-400 text-sm mt-1">
                        {penalties2} {sportProfile.scoringConfig.penaltyName} ({penalties2} pts to opponent)
                      </div>
                    )}
                  </div>
                  {selectedWinner === currentMatch.competitor2?.id && (
                    <Award className="h-10 w-10 text-yellow-400" />
                  )}
                </div>
              </button>
              {/* Penalty Controls for Competitor 2 */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties2(p => p + 1); }}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-bold"
                  title={`Add ${sportProfile.scoringConfig.penaltyName}`}
                >
                  +{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties2(p => Math.max(0, p - 1)); }}
                  disabled={penalties2 === 0}
                  className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm disabled:opacity-50"
                  title={`Remove ${sportProfile.scoringConfig.penaltyName}`}
                >
                  -{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <div className="text-center text-xl font-bold text-red-400">
                  {penalties2}
                </div>
              </div>
            </div>
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

      {/* Recent Results */}
      {(() => {
        const completedMatches = divisions
          ?.find((d) => d.id === selectedDivision)
          ?.bracket?.matches.filter((m) => m.status === 'completed')
          .slice(-5)
          .reverse() || [];

        if (completedMatches.length === 0) return null;

        return (
          <div className="p-4 border-t border-gray-700">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">Recent Results</h3>
            <div className="space-y-2">
              {completedMatches.map((match) => {
                const winnerName =
                  match.winnerId === match.competitor1?.id
                    ? getCompetitorName(match.competitor1)
                    : getCompetitorName(match.competitor2);
                const loserName =
                  match.winnerId === match.competitor1?.id
                    ? getCompetitorName(match.competitor2)
                    : getCompetitorName(match.competitor1);

                return (
                  <div
                    key={match.id}
                    className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2"
                  >
                    <div className="text-sm">
                      <span className="text-gray-500 mr-2">#{match.matchNumber}</span>
                      <span className="text-green-400 font-medium">{winnerName}</span>
                      <span className="text-gray-500 mx-1">def.</span>
                      <span className="text-gray-400">{loserName}</span>
                      {match.score1 && match.score2 && (
                        <span className="text-gray-500 ml-2">
                          ({match.score1}-{match.score2})
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => undoMatchResult.mutate(match.id)}
                      disabled={undoMatchResult.isPending}
                      className="px-3 py-1 text-xs bg-red-600 hover:bg-red-500 disabled:bg-gray-600 rounded font-medium"
                    >
                      Undo
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

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
                Cancel <span className="text-xs text-gray-400">(Esc)</span>
              </button>
              <button
                onClick={handleSubmit}
                disabled={recordResult.isPending}
                className="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-semibold"
              >
                {recordResult.isPending ? 'Saving...' : 'Confirm'}{' '}
                <span className="text-xs text-green-200">(Enter)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help Modal */}
      {showKeyboardHelp && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold flex items-center">
                <Keyboard className="h-5 w-5 mr-2" />
                Keyboard Shortcuts
              </h3>
              <button
                onClick={() => setShowKeyboardHelp(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-400 mb-2">Select Winner</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Competitor 1</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">1</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Competitor 2</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">2</kbd>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-400 mb-2">Navigation</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Previous match</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">←</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Next match</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">→</kbd>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-400 mb-2">Result Type</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Win</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">W</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>DQ</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">D</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Forfeit</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">F</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Injury</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">I</kbd>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-400 mb-2">Actions</div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Submit / Confirm</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">Enter</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Cancel / Back</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">Esc</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Show this help</span>
                    <kbd className="bg-gray-600 px-2 py-1 rounded text-xs">?</kbd>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowKeyboardHelp(false)}
              className="w-full mt-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
