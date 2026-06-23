import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Trophy,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertTriangle,
  Clock,
  Users,
  Award,
  Keyboard,
  Timer,
} from 'lucide-react';
import MatchTimer from '../components/MatchTimer';
import { getAuthHeaders } from '../context/AuthContext';
import CloseButton from '../components/ui/CloseButton';
import { useToast } from '../context/ToastContext';
import { getSportProfile } from '../../shared/constants/sport-profiles';
import { Card, CardBody } from '../components/ui';
import { Button } from '../components/ui';
import { StatTile } from '../components/ui';

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
  const [penalties1, setPenalties1] = useState(0);
  const [penalties2, setPenalties2] = useState(0);
  const [divisionSearch, setDivisionSearch] = useState('');
  // Ref to the live region for announcing match navigation + undo status.
  const liveRegionRef = useRef<HTMLDivElement>(null);
  // Ref to the active match heading — moved on keyboard nav so SR users
  // can follow the scorekeeper through a division without losing their place.
  const matchHeadingRef = useRef<HTMLDivElement>(null);
  const userNavigatedRef = useRef<'keyboard' | 'auto' | null>(null);
  const [announce, setAnnounce] = useState('');

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

  const { data: divisions, isLoading } = useQuery<Division[]>({
    queryKey: ['scorekeeper-divisions', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${tournamentId}?withMatches=true`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch divisions');
      return res.json();
    },
    refetchInterval: 10000,
  });

  // Get ready matches for selected division — safe with optional chaining
  const readyMatches = useMemo(() => {
    const div = divisions?.find((d) => d.id === selectedDivision);
    return div?.bracket?.matches
      ?.filter((m) => m.status === 'ready' || m.status === 'in_progress')
      .sort((a, b) => a.matchNumber - b.matchNumber) || [];
  }, [divisions, selectedDivision]);

  // Total + completed counts for the selected division. Used to distinguish
  // "all done" (truly complete) from "no ready match yet" (still pending/in-progress
  // elsewhere). Closes #36 / #44 where a division with 14 pending matches
  // showed "All Matches Complete!" because no match was in 'ready' state.
  const divisionMatchCounts = useMemo(() => {
    const div = divisions?.find((d) => d.id === selectedDivision);
    const matches = div?.bracket?.matches ?? [];
    return {
      total: matches.length,
      completed: matches.filter((m) => m.status === 'completed').length,
    };
  }, [divisions, selectedDivision]);

  const currentMatch = readyMatches[currentMatchIndex];

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
      queryClient.invalidateQueries({ queryKey: ['director-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['divisions'] });
      const wasLast = currentMatchIndex >= readyMatches.length - 1;
      resetForm();
      setShowConfirm(false);
      if (!wasLast) {
        setCurrentMatchIndex((prev) => prev + 1);
        setAnnounce('Result recorded. Advanced to next match.');
      } else {
        setAnnounce('Result recorded. No more ready matches in this division.');
      }
    },
    onError: (error: Error) => {
      addToast(error.message || 'Operation failed', 'error');
      setAnnounce(`Error recording result: ${error.message || 'Operation failed'}`);
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ['director-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['divisions'] });
      addToast('Match result undone', 'success');
      setAnnounce('Last result undone.');
    },
    onError: (error: Error) => {
      addToast(error.message || 'Operation failed', 'error');
      setAnnounce(`Undo failed: ${error.message || 'Operation failed'}`);
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

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (showConfirm) {
      if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
      else if (e.key === 'Escape') { e.preventDefault(); setShowConfirm(false); }
      return;
    }

    if (selectedDivision && currentMatch) {
      switch (e.key) {
        case '1':
        case 'ArrowUp':
          e.preventDefault();
          if (currentMatch.competitor1) setSelectedWinner(currentMatch.competitor1.id);
          break;
        case '2':
        case 'ArrowDown':
          e.preventDefault();
          if (currentMatch.competitor2) setSelectedWinner(currentMatch.competitor2.id);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setCurrentMatchIndex((prev) => {
            if (prev > 0) {
              userNavigatedRef.current = 'keyboard';
              setAnnounce(`Previous match. ${prev} of ${readyMatches.length}.`);
            }
            return Math.max(0, prev - 1);
          });
          break;
        case 'ArrowRight':
          e.preventDefault();
          setCurrentMatchIndex((prev) => {
            if (prev < readyMatches.length - 1) {
              userNavigatedRef.current = 'keyboard';
              setAnnounce(`Next match. ${prev + 2} of ${readyMatches.length}.`);
            }
            return Math.min(readyMatches.length - 1, prev + 1);
          });
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedWinner) setShowConfirm(true);
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
  }, [showConfirm, selectedDivision, currentMatch, selectedWinner, readyMatches.length]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // After arrow-key navigation, move focus to the active match heading so
  // screen reader and keyboard users follow the scorekeeper through a division.
  // Auto-advance after submit does NOT steal focus — only keyboard navigation does.
  useEffect(() => {
    if (userNavigatedRef.current === 'keyboard' && matchHeadingRef.current) {
      matchHeadingRef.current.focus({ preventScroll: false });
    }
    userNavigatedRef.current = null;
  }, [currentMatchIndex]);

  // Division selector view
  if (!selectedDivision) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4">
        {/* Live region — exists on the division-list view too so SR users hear
            announcements regardless of which view they're in. */}
        <div
          ref={liveRegionRef}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {announce}
        </div>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <Trophy className="h-8 w-8 text-yellow-500 mr-3" />
              <h1 className="text-2xl font-bold">Scorekeeper</h1>
            </div>
            <Link to={`/tournaments/${tournamentId}`} className="text-gray-600 hover:text-white">
              Exit
            </Link>
          </div>

          {isLoading ? (
            <div className="text-center py-12 text-gray-600">Loading divisions...</div>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-4 text-gray-300">Select Division</h2>
              <div className="relative mb-4">
                <label htmlFor="division-search" className="sr-only">
                  Search divisions
                </label>
                <input
                  id="division-search"
                  type="text"
                  placeholder="Search divisions..."
                  value={divisionSearch}
                  onChange={(e) => setDivisionSearch(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-gray-800 text-white border border-gray-700 focus:border-yellow-500 focus:outline-none"
                />
              </div>
              <div className="grid gap-3">
                {divisions && divisions.length === 0 && (
                  <div className="text-center py-12 text-gray-600">
                    <Trophy className="h-12 w-12 mx-auto mb-3 text-gray-600" aria-hidden="true" />
                    <p className="text-base font-medium mb-1">No divisions to score yet</p>
                    <p className="text-sm text-gray-600 mb-4">
                      Brackets need to be generated before matches can be scored.
                    </p>
                  </div>
                )}
                {divisions
                  ?.filter((d) => d.bracket && (!divisionSearch || d.name.toLowerCase().includes(divisionSearch.toLowerCase())))
                  .map((division) => {
                    const readyCount = division.bracket?.matches?.filter((m) => m.status === 'ready' || m.status === 'in_progress').length || 0;
                    const completedCount = division.bracket?.matches?.filter((m) => m.status === 'completed').length || 0;
                    const totalCount = division.bracket?.matches?.length || 0;

                    return (
                      <button
                        key={division.id}
                        onClick={() => { setSelectedDivision(division.id); setCurrentMatchIndex(0); resetForm(); }}
                        aria-label={
                          `${division.name}, ${getEventLabel(division.eventType)}, ` +
                          (readyCount > 0
                            ? `${readyCount} ready, ${completedCount} of ${totalCount} complete`
                            : totalCount === 0
                            ? `no matches scheduled`
                            : completedCount === totalCount
                            ? `complete, all ${totalCount} matches done`
                            : `no ready matches, ${completedCount} of ${totalCount} complete`)
                        }
                        className={`p-4 rounded-lg text-left transition-colors ${
                          readyCount > 0
                            ? 'bg-green-900 hover:bg-green-800 border-2 border-green-500'
                            : totalCount > 0 && completedCount === totalCount
                            ? 'bg-gray-800 hover:bg-gray-700 opacity-50'
                            : 'bg-gray-800 hover:bg-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-lg">{division.name}</div>
                            <div className="text-sm text-gray-600 mt-1">{getEventLabel(division.eventType)}</div>
                          </div>
                          <div className="text-right">
                            {readyCount > 0 ? (
                              <span className="text-green-400 font-bold">{readyCount} ready</span>
                            ) : totalCount > 0 && completedCount === totalCount ? (
                              <span className="text-gray-600">Complete</span>
                            ) : totalCount === 0 ? (
                              <span className="text-yellow-500">No bracket</span>
                            ) : (
                              <span className="text-blue-400">No ready</span>
                            )}
                            <div className="text-xs text-gray-600 mt-1">
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
      {/* Live region for keyboard nav / undo / result announcements.
          aria-live="polite" lets the SR finish reading current content first.
          Lives at the top of the page so it exists on every view (division list + match view). */}
      <div
        ref={liveRegionRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announce}
      </div>
      {/* Header */}
      <div className="bg-gray-800 p-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setSelectedDivision(null)} className="flex items-center text-gray-600 hover:text-white">
            <ChevronLeft className="h-5 w-5 mr-1" /> Back
          </button>
          <div className="text-center">
            <div
              ref={matchHeadingRef}
              tabIndex={-1}
              className="font-semibold focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-gray-800 rounded px-2"
              aria-label={`${division?.name} match ${currentMatchIndex + 1} of ${readyMatches.length}`}
            >
              {division?.name}
            </div>
            <div className="text-sm text-gray-600" aria-live="polite">
              Match {currentMatchIndex + 1} of {readyMatches.length}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTimer(!showTimer)}
              className={`flex items-center text-sm px-2 py-1 rounded ${showTimer ? 'bg-green-600' : 'bg-gray-700'}`}
              title="Toggle timer"
              aria-label={showTimer ? 'Hide match timer' : 'Show match timer'}
              aria-pressed={showTimer}
            >
              <Timer className="h-4 w-4 mr-1" aria-hidden="true" /> Timer
            </button>
            <button
              onClick={() => setShowKeyboardHelp(true)}
              className="flex items-center text-gray-600 hover:text-white text-sm"
              title="Keyboard shortcuts (?)"
              aria-label="Show keyboard shortcuts"
            >
              <Keyboard className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Match Timer */}
      {showTimer && division?.eventType === 'sparring' && sportProfile.eventTypes[1]?.isCombat && (
        <div className="p-4 border-b border-gray-800">
          <MatchTimer defaultRoundTime={120} defaultRounds={2} defaultBreakTime={30} />
        </div>
      )}

      {!currentMatch ? (
        <div className="p-8 text-center">
          {divisionMatchCounts.total > 0 && divisionMatchCounts.completed === divisionMatchCounts.total ? (
            <>
              <Check className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">All Matches Complete!</h2>
              <p className="text-gray-600 mb-6">
                {divisionMatchCounts.completed} of {divisionMatchCounts.total} matches done.
              </p>
              <Button variant="primary" className="px-8 py-3" onClick={() => setSelectedDivision(null)}>
                Select Another Division
              </Button>
            </>
          ) : divisionMatchCounts.total === 0 ? (
            <>
              <AlertTriangle className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">No bracket generated</h2>
              <p className="text-gray-600 mb-6">
                This division doesn't have a bracket yet. Generate brackets from the Divisions page.
              </p>
              <Button variant="primary" className="px-8 py-3" onClick={() => setSelectedDivision(null)}>
                Select Another Division
              </Button>
            </>
          ) : (
            <>
              <Clock className="h-16 w-16 text-blue-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">No ready matches</h2>
              <p className="text-gray-600 mb-6">
                {divisionMatchCounts.completed} of {divisionMatchCounts.total} done — matches are pending or being seeded from prior rounds. Check back shortly.
              </p>
              <Button variant="primary" className="px-8 py-3" onClick={() => setSelectedDivision(null)}>
                Select Another Division
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Match Navigation */}
          <div className="flex items-center justify-between p-2 bg-gray-800/50">
            <button
              onClick={() => setCurrentMatchIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentMatchIndex === 0}
              className="p-2 rounded-lg bg-gray-700 disabled:opacity-30"
              aria-label="Previous match"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
            <div className="text-sm text-gray-600" aria-hidden="true">
              Match #{currentMatch.matchNumber} - Round {currentMatch.roundNumber} ({currentMatch.bracketType})
            </div>
            <button
              onClick={() => setCurrentMatchIndex((prev) => Math.min(readyMatches.length - 1, prev + 1))}
              disabled={currentMatchIndex === readyMatches.length - 1}
              className="p-2 rounded-lg bg-gray-700 disabled:opacity-30"
              aria-label="Next match"
            >
              <ChevronRight className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>

          {/* Competitor Cards */}
          <div className="p-4 space-y-4">
            {/* Competitor 1 */}
            <div className="flex gap-3">
              <button
                onClick={() => { if (currentMatch.competitor1) setSelectedWinner(currentMatch.competitor1.id); }}
                disabled={!currentMatch.competitor1}
                aria-pressed={selectedWinner === currentMatch.competitor1?.id}
                aria-label={`${getCompetitorName(currentMatch.competitor1)} — select as winner (press 1)`}
                className={`flex-1 p-6 rounded-xl text-left transition-all ${
                  selectedWinner === currentMatch.competitor1?.id
                    ? 'bg-green-600 ring-4 ring-green-400'
                    : 'bg-gray-800 hover:bg-gray-700'
                } ${!currentMatch.competitor1 ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold">{getCompetitorName(currentMatch.competitor1)}</div>
                    <div className="text-gray-600 mt-1">{getCompetitorSchool(currentMatch.competitor1)}</div>
                    {penalties1 > 0 && (
                      <div className="text-red-400 text-sm mt-1">
                        {penalties1} {sportProfile.scoringConfig.penaltyName} ({penalties1} pts to opponent)
                      </div>
                    )}
                  </div>
                  {selectedWinner === currentMatch.competitor1?.id && (
                    <Award className="h-10 w-10 text-yellow-400" aria-hidden="true" />
                  )}
                </div>
              </button>
              {/* Penalty Controls for Competitor 1 */}
              <div className="flex flex-col gap-2" role="group" aria-label={`${getCompetitorName(currentMatch.competitor1)} penalty controls`}>
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties1(p => p + 1); }}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-bold"
                  title={`Add ${sportProfile.scoringConfig.penaltyName}`}
                  aria-label={`Add ${sportProfile.scoringConfig.penaltyName} to ${getCompetitorName(currentMatch.competitor1)}`}
                >
                  +{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties1(p => Math.max(0, p - 1)); }}
                  disabled={penalties1 === 0}
                  className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm disabled:opacity-50"
                  title={`Remove ${sportProfile.scoringConfig.penaltyName}`}
                  aria-label={`Remove ${sportProfile.scoringConfig.penaltyName} from ${getCompetitorName(currentMatch.competitor1)}`}
                >
                  -{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <div className={`text-center text-xl font-bold ${penalties1 > 0 ? 'text-red-400' : 'text-gray-500'}`} aria-live="polite" aria-atomic="true">
                  {penalties1}
                </div>
              </div>
            </div>

            <div className="text-center text-gray-600 font-bold">VS</div>

            {/* Competitor 2 */}
            <div className="flex gap-3">
              <button
                onClick={() => { if (currentMatch.competitor2) setSelectedWinner(currentMatch.competitor2.id); }}
                disabled={!currentMatch.competitor2}
                aria-pressed={selectedWinner === currentMatch.competitor2?.id}
                aria-label={`${getCompetitorName(currentMatch.competitor2)} — select as winner (press 2)`}
                className={`flex-1 p-6 rounded-xl text-left transition-all ${
                  selectedWinner === currentMatch.competitor2?.id
                    ? 'bg-green-600 ring-4 ring-green-400'
                    : 'bg-gray-800 hover:bg-gray-700'
                } ${!currentMatch.competitor2 ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold">{getCompetitorName(currentMatch.competitor2)}</div>
                    <div className="text-gray-600 mt-1">{getCompetitorSchool(currentMatch.competitor2)}</div>
                    {penalties2 > 0 && (
                      <div className="text-red-400 text-sm mt-1">
                        {penalties2} {sportProfile.scoringConfig.penaltyName} ({penalties2} pts to opponent)
                      </div>
                    )}
                  </div>
                  {selectedWinner === currentMatch.competitor2?.id && (
                    <Award className="h-10 w-10 text-yellow-400" aria-hidden="true" />
                  )}
                </div>
              </button>
              {/* Penalty Controls for Competitor 2 */}
              <div className="flex flex-col gap-2" role="group" aria-label={`${getCompetitorName(currentMatch.competitor2)} penalty controls`}>
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties2(p => p + 1); }}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-bold"
                  title={`Add ${sportProfile.scoringConfig.penaltyName}`}
                  aria-label={`Add ${sportProfile.scoringConfig.penaltyName} to ${getCompetitorName(currentMatch.competitor2)}`}
                >
                  +{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties2(p => Math.max(0, p - 1)); }}
                  disabled={penalties2 === 0}
                  className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm disabled:opacity-50"
                  title={`Remove ${sportProfile.scoringConfig.penaltyName}`}
                  aria-label={`Remove ${sportProfile.scoringConfig.penaltyName} from ${getCompetitorName(currentMatch.competitor2)}`}
                >
                  -{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <div className={`text-center text-xl font-bold ${penalties1 > 0 ? 'text-red-400' : 'text-gray-500'}`} aria-live="polite" aria-atomic="true">
                  {penalties2}
                </div>
              </div>
            </div>
          </div>

          {/* Score Entry */}
          <div className="p-4 bg-gray-800/50">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="scorekeeper-score1" className="block text-sm text-gray-600 mb-1">
                  {getCompetitorName(currentMatch.competitor1)} Score
                </label>
                <input
                  id="scorekeeper-score1"
                  type="number"
                  inputMode="numeric"
                  value={score1}
                  onChange={(e) => setScore1(e.target.value)}
                  className="w-full p-4 text-2xl text-center bg-gray-700 rounded-lg"
                  placeholder="0"
                />
              </div>
              <div>
                <label htmlFor="scorekeeper-score2" className="block text-sm text-gray-600 mb-1">
                  {getCompetitorName(currentMatch.competitor2)} Score
                </label>
                <input
                  id="scorekeeper-score2"
                  type="number"
                  inputMode="numeric"
                  value={score2}
                  onChange={(e) => setScore2(e.target.value)}
                  className="w-full p-4 text-2xl text-center bg-gray-700 rounded-lg"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Result Type — only matters for non-WIN results (DQ, FORFEIT,
                INJURY all imply a winner). Show a hint next to the group
                indicating which competitor "won" via this result. */}
            <fieldset className="border-0 p-0 m-0 mb-4">
              <legend className="sr-only">Result type</legend>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-600 uppercase tracking-wider">Result</span>
                {selectedWinner && resultType !== 'win' && (
                  <span className="text-xs text-gray-600">
                    {getCompetitorName(
                      currentMatch.competitor1?.id === selectedWinner
                        ? currentMatch.competitor1
                        : currentMatch.competitor2
                    )}
                    {' wins by '}
                    <span className="text-red-400 font-semibold uppercase">{resultType}</span>
                  </span>
                )}
              </div>
              <div className="flex gap-2" role="radiogroup" aria-label={`Result type${selectedWinner ? ' — winner: ' + getCompetitorName(selectedWinner === currentMatch.competitor1?.id ? currentMatch.competitor1 : currentMatch.competitor2) : ''}`}>
                {(['win', 'dq', 'forfeit', 'injury'] as ResultType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setResultType(type)}
                    aria-pressed={resultType === type}
                    aria-label={`Result type: ${type.toUpperCase()}`}
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
            </fieldset>

            {/* Notes */}
            {resultType !== 'win' && (
              <div>
                <label htmlFor="scorekeeper-notes" className="sr-only">
                  Notes
                </label>
                <input
                  id="scorekeeper-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes (optional)"
                  className="w-full p-3 bg-gray-700 rounded-lg mb-4"
                />
              </div>
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
        const div = divisions?.find((d) => d.id === selectedDivision);
        const completedMatches = div?.bracket?.matches
          ?.filter((m) => m.status === 'completed')
          .slice(-5)
          .reverse() || [];

        if (completedMatches.length === 0) return null;

        return (
          <div className="p-4 border-t border-gray-700">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">Recent Results</h3>
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
                  <div key={match.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                    <div className="text-sm">
                      <span className="text-gray-600 mr-2">#{match.matchNumber}</span>
                      <span className="text-green-400 font-medium">{winnerName}</span>
                      <span className="text-gray-600 mx-1">def.</span>
                      <span className="text-gray-600">{loserName}</span>
                      {match.score1 && match.score2 && (
                        <span className="text-gray-600 ml-2">({match.score1}-{match.score2})</span>
                      )}
                    </div>
                    <button
                      onClick={() => undoMatchResult.mutate(match.id)}
                      disabled={undoMatchResult.isPending}
                      aria-label={`Undo result: ${winnerName} defeated ${loserName} (match ${match.matchNumber})`}
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
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              // Minimal focus trap: cycle focus between Cancel and Confirm.
              const focusables = (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
              );
              if (focusables.length === 0) return;
              const first = focusables[0];
              const last = focusables[focusables.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-result-title"
            className="bg-gray-800 rounded-xl p-6 max-w-md w-full"
          >
            <h3 id="confirm-result-title" className="text-xl font-bold mb-4">Confirm Result</h3>
            <div className="bg-gray-700 rounded-lg p-4 mb-4">
              <div className="text-lg font-semibold text-green-400">
                Winner:{' '}
                {selectedWinner === currentMatch.competitor1?.id
                  ? getCompetitorName(currentMatch.competitor1)
                  : getCompetitorName(currentMatch.competitor2)}
              </div>
              <div className="text-gray-600 mt-2">Score: {score1 || '0'} - {score2 || '0'}</div>
              {resultType !== 'win' && (
                <div className="text-red-400 mt-1">Result: {resultType.toUpperCase()}</div>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setShowConfirm(false)}>
                Cancel <span className="text-xs text-gray-600" aria-hidden="true">(Esc)</span>
              </Button>
              <Button variant="primary" className="flex-1" loading={recordResult.isPending} onClick={handleSubmit}>
                Confirm <span className="text-xs text-green-200" aria-hidden="true">(Enter)</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help Modal */}
      {showKeyboardHelp && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              const focusables = (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
              );
              if (focusables.length === 0) return;
              const first = focusables[0];
              const last = focusables[focusables.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyboard-help-title"
            className="bg-gray-800 rounded-xl p-6 max-w-md w-full"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id="keyboard-help-title" className="text-xl font-bold flex items-center">
                <Keyboard className="h-5 w-5 mr-2" aria-hidden="true" /> Keyboard Shortcuts
              </h3>
              <CloseButton
                onClose={() => setShowKeyboardHelp(false)}
                label="Close keyboard shortcuts"
                className="!text-gray-600 hover:!text-white"
              />
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-600 mb-2">Select Winner</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Competitor 1</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">1</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Competitor 2</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">2</kbd>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 mb-2">Navigation</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Previous match</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">←</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Next match</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">→</kbd>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 mb-2">Result Type</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Win</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">W</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>DQ</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">D</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Forfeit</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">F</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Injury</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">I</kbd></div>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 mb-2">Timer (sparring only)</div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Start / pause timer</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">Space</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Show / hide timer panel</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">T</kbd></div>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 mb-2">Actions</div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Submit / Confirm</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">Enter</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Cancel / Back</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">Esc</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Show this help</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">?</kbd></div>
                </div>
              </div>
            </div>
            <Button variant="secondary" className="w-full mt-4" onClick={() => setShowKeyboardHelp(false)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
