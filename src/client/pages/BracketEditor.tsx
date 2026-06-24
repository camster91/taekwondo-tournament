import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Download,
  Users,
  Trophy,
  Shuffle,
  Printer,
  Plus,
  X,
  ArrowLeftRight,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Spinner from '../components/ui/Spinner';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';

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
  const [pendingWinner, setPendingWinner] = useState<{ matchId: string; winnerId: string; name: string } | null>(null);

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
    onError: (error: Error) => {
      addToast(error.message || 'Operation failed', 'error');
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
    onError: (error: Error) => {
      addToast(error.message || 'Operation failed', 'error');
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
    onError: (error: Error) => {
      addToast(error.message || 'Operation failed', 'error');
    },
  });

  // Swap the two competitors in a match. Closes H2 from the UI audit —
  // directors can now manually fix a bad auto-seed (e.g. two best
  // kids landing in the same half of the bracket) without losing all
  // completed matches. Backend at POST /api/brackets/match/:id/swap
  // just exchanges competitor1Id and competitor2Id.
  const swapMutation = useMutation({
    mutationFn: async (matchId: string) => {
      const res = await fetch(`/api/brackets/match/${matchId}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error('Failed to swap competitors');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['division', divisionId] });
      addToast?.('Competitors swapped.', 'success');
    },
    onError: (error: Error) => {
      addToast(error.message || 'Swap failed', 'error');
    },
  });

  // Pull all the tournament's registrations that AREN'T already
  // assigned to this division, so the director can drop late entries
  // into the bracket via the "+ Add" picker.
  const { data: unassignedData } = useQuery<{ registrations: Array<{ id: string; competitor: Competitor }> }>({
    queryKey: ['unassigned-registrations', tournamentId, divisionId],
    queryFn: async () => {
      const r = await fetch(
        `/api/tournaments/${tournamentId}/registrations?notInDivision=${divisionId}`,
        { headers: getAuthHeaders() },
      );
      if (!r.ok) return { registrations: [] };
      return r.json();
    },
    enabled: !!division && !!tournamentId,
  });

  const [showAddPicker, setShowAddPicker] = useState(false);
  const addCompetitorMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      const res = await fetch(`/api/divisions/${divisionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ registrationId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Add failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['division', divisionId] });
      queryClient.invalidateQueries({ queryKey: ['unassigned-registrations', tournamentId, divisionId] });
      addToast?.('Competitor added to division. Regenerate bracket to include them.', 'success');
    },
    onError: (error: Error) => {
      addToast(error.message || 'Add failed', 'error');
    },
  });

  const removeCompetitorMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const res = await fetch(`/api/divisions/${divisionId}/assign/${assignmentId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Remove failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['division', divisionId] });
      queryClient.invalidateQueries({ queryKey: ['unassigned-registrations', tournamentId, divisionId] });
      addToast?.('Removed from division. Regenerate bracket if needed.', 'success');
    },
    onError: (error: Error) => {
      addToast(error.message || 'Remove failed', 'error');
    },
  });

  const exportPDF = async () => {
    if (!division) return;
    try {
      const res = await fetch(`/api/brackets/division/${divisionId}/pdf`, { headers: getAuthHeaders() });
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

  // All hooks must be declared BEFORE any early returns so the hook order is
  // stable across renders. (See the Rules of Hooks — early returns below
  // these hooks would otherwise fire on a different number of hooks per
  // render, causing "Rendered more hooks than during the previous render".)

  // Roving-tabindex keyboard navigation for the bracket grid.
  // The "grid" is organised: each column = a round, each match within a column
  // is stacked vertically. Adjacent rounds have different match counts, so
  // we use a simple 1D pattern that maps cleanly:
  //   - Left / Right: previous / next match within the same round
  //   - Up / Down: previous / next round (focus the match at the same vertical
  //                position if it exists, else clamp to the nearest match)
  //   - Tab / Shift+Tab: next / previous cell in the bracket as a flat list
  // The first cell of the first column starts as the only tabbable cell; after
  // any focus event inside the grid we update tabindex via the effect below.
  const bracketGridRef = useRef<HTMLDivElement>(null);
  const handleBracketKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const grid = bracketGridRef.current;
      if (!grid) return;
      const target = e.target as HTMLElement;
      if (!target.matches('[data-bracket-cell]')) return;
      const cell = target.closest<HTMLElement>('[data-bracket-cell]');
      if (!cell) return;

      const allCells = Array.from(
        grid.querySelectorAll<HTMLElement>('[data-bracket-cell]')
      );
      // Group cells by column. Within a column they're in DOM order.
      const byCol = new Map<number, HTMLElement[]>();
      for (const el of allCells) {
        const c = parseInt(el.dataset.col ?? '-1', 10);
        if (c < 0) continue;
        if (!byCol.has(c)) byCol.set(c, []);
        byCol.get(c)!.push(el);
      }
      const cols = Array.from(byCol.keys()).sort((a, b) => a - b);
      if (cols.length === 0) return;

      const col = parseInt(cell.dataset.col ?? '-1', 10);
      const cellsInCol = byCol.get(col) ?? [];
      const idxInCol = cellsInCol.indexOf(cell);

      const tryFocus = (el: HTMLElement | undefined) => {
        if (el) {
          e.preventDefault();
          el.focus();
        }
      };

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        const dir = e.key === 'ArrowLeft' ? -1 : 0; // Up moves to previous round
        if (e.key === 'ArrowLeft') {
          // Previous match within the same round.
          tryFocus(cellsInCol[idxInCol - 1]);
        } else {
          const nextColIdx = cols.indexOf(col) - 1;
          if (nextColIdx < 0) return;
          const nextCol = cols[nextColIdx];
          const nextColCells = byCol.get(nextCol) ?? [];
          // Pick the cell at the same vertical position, clamped.
          const targetIdx = Math.min(idxInCol, nextColCells.length - 1);
          tryFocus(nextColCells[targetIdx]);
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (e.key === 'ArrowRight') {
          tryFocus(cellsInCol[idxInCol + 1]);
        } else {
          const nextColIdx = cols.indexOf(col) + 1;
          if (nextColIdx >= cols.length) return;
          const nextCol = cols[nextColIdx];
          const nextColCells = byCol.get(nextCol) ?? [];
          const targetIdx = Math.min(idxInCol, nextColCells.length - 1);
          tryFocus(nextColCells[targetIdx]);
        }
        return;
      }
    },
    []
  );

  // Sync the roving tabindex: the first cell of the first column is the tab stop,
  // all others are tabindex=-1. After any focus event, recompute which cell is the active one.
  useEffect(() => {
    const grid = bracketGridRef.current;
    if (!grid) return;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-bracket-cell]'));
    if (cells.length === 0) return;

    const setActive = (el: HTMLElement) => {
      cells.forEach((c) => {
        if (c === el) c.setAttribute('tabindex', '0');
        else c.setAttribute('tabindex', '-1');
      });
    };

    // Initial: first cell is tabbable, rest are not.
    setActive(cells[0]);
    const onFocusIn = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.matches('[data-bracket-cell]')) setActive(t);
    };
    grid.addEventListener('focusin', onFocusIn);
    return () => grid.removeEventListener('focusin', onFocusIn);
  }, [division?.bracket?.id]);

  // Live region announcement for bracket update success/failure.
  const [bracketAnnounce, setBracketAnnounce] = useState('');
  useEffect(() => {
    if (updateMatchMutation.isSuccess) {
      setBracketAnnounce('Winner recorded. Bracket updated.');
    }
  }, [updateMatchMutation.isSuccess]);
  useEffect(() => {
    if (updateMatchMutation.isError) {
      setBracketAnnounce(
        `Failed to record winner: ${(updateMatchMutation.error as Error)?.message ?? 'Unknown error'}`
      );
    }
  }, [updateMatchMutation.isError]);

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
      <div className="text-center py-12">
        <div className="text-gray-600 dark:text-gray-400">Division not found</div>
      </div>
    );
  }

  const winnersMatches =
    division.bracket?.matches?.filter((m) => m.bracketType === 'winners') || [];
  const losersMatches =
    division.bracket?.matches?.filter((m) => m.bracketType === 'losers') || [];
  const finalsMatches =
    division.bracket?.matches?.filter((m) => m.bracketType === 'finals') || [];

  // Sort each bracket by (roundNumber, matchNumber) so we can derive a stable
  // 1-indexed per-bracket position. The display label uses this position so
  // losers matches restart numbering at 1 (L1, L2, ...) instead of continuing
  // the global matchNumber from the winners bracket.
  const sortBracket = (arr: Match[]) =>
    [...arr].sort((a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber);

  const winnersMatchesSorted = sortBracket(winnersMatches);
  const losersMatchesSorted = sortBracket(losersMatches);
  const finalsMatchesSorted = sortBracket(finalsMatches);

  // Build a lookup: match.id -> display label. Winners/Losers restart at 1;
  // Finals are labeled "GF" (Grand Finals). Falls back to the raw matchNumber
  // if the bracketType is unknown.
  const matchLabelById = new Map<string, string>();
  winnersMatchesSorted.forEach((m, i) => matchLabelById.set(m.id, `W${i + 1}`));
  losersMatchesSorted.forEach((m, i) => matchLabelById.set(m.id, `L${i + 1}`));
  finalsMatchesSorted.forEach((m) => matchLabelById.set(m.id, 'GF'));
  const getMatchLabel = (match: Match) =>
    matchLabelById.get(match.id) ?? `M${match.matchNumber}`;

  const winnersRounds = [...new Set(winnersMatches.map(m => m.roundNumber))].sort((a, b) => a - b);
  const losersRounds = [...new Set(losersMatches.map(m => m.roundNumber))].sort((a, b) => a - b);

  const handleSelectWinner = (matchId: string, winnerId: string, match: Match) => {
    const comp = match.competitor1Id === winnerId ? match.competitor1 : match.competitor2;
    const name = comp
      ? `${comp.competitor.firstName} ${comp.competitor.lastName}`
      : 'Unknown';
    setPendingWinner({ matchId, winnerId, name });
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title={division.name}
        description={`${division.assignments.length} competitors`}
        actions={
          <div className="flex gap-2 sm:gap-3">
            {division.bracket ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowReseedConfirm(true)}
                  loading={generateBracketMutation.isPending}
                  aria-label="Reseed bracket"
                >
                  <Shuffle className="h-4 w-4 mr-2" aria-hidden="true" />
                  <span className="hidden sm:inline">Reseed</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={exportPDF}
                  aria-label={`Export ${division.name} bracket as PDF`}
                >
                  <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                  <span className="hidden sm:inline">Export PDF</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => window.print()}
                  aria-label={`Print ${division.name} bracket`}
                >
                  <Printer className="h-4 w-4 mr-2" aria-hidden="true" />
                  <span className="hidden sm:inline">Print</span>
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => generateBracketMutation.mutate()}
                loading={generateBracketMutation.isPending}
                aria-label={`Generate bracket for ${division.name}`}
              >
                <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" /> Generate Bracket
              </Button>
            )}
          </div>
        }
      />

      {/* Back link */}
      <Link
        to={`/tournaments/${tournamentId}/divisions`}
        className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center"
        aria-label="Back to Divisions"
      >
        <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" /> Back to Divisions
      </Link>

      {/* Competitors List */}
      <Card>
        <CardHeader
          title={`Competitors (${division.assignments.length})`}
          action={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowAddPicker((v) => !v)}
                aria-label="Add a competitor from the tournament's unassigned registrations"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
              <Users className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            </div>
          }
        />
        <CardBody>
          {/* Inline "Add competitor" picker. Shows registrations registered
              to the same tournament but not yet assigned to this division.
              Closes H2 from the UI audit — directors can fix a kid who
              showed up unregistered without rebuilding everything. */}
          {showAddPicker && (
            <div className="mb-3 p-3 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30">
              <div className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 mb-2">
                Add from this tournament
              </div>
              {unassignedData?.registrations && unassignedData.registrations.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {unassignedData.registrations.map((r) => (
                    <Button
                      key={r.id}
                      size="sm"
                      variant="secondary"
                      loading={addCompetitorMutation.isPending && addCompetitorMutation.variables === r.id}
                      onClick={() => addCompetitorMutation.mutate(r.id)}
                    >
                      + {r.competitor.firstName} {r.competitor.lastName}
                      {r.competitor.schoolDojang && <span className="text-xs ml-1 opacity-70">({r.competitor.schoolDojang})</span>}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Every registered competitor is already assigned to a division.
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {division.assignments.map((a, i) => (
              <span
                key={a.id}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 gap-2"
              >
                <span className="font-medium mr-1">{i + 1}.</span>
                {a.registration.competitor.firstName}{' '}
                {a.registration.competitor.lastName}
                {a.registration.competitor.schoolDojang && (
                  <span className="ml-1 text-gray-600 dark:text-gray-400 text-xs">
                    ({a.registration.competitor.schoolDojang})
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Remove ${a.registration.competitor.firstName} ${a.registration.competitor.lastName} from this division? Their bracket slot will be freed; regenerate the bracket to refill.`)) {
                      removeCompetitorMutation.mutate(a.id);
                    }
                  }}
                  aria-label={`Remove ${a.registration.competitor.firstName} ${a.registration.competitor.lastName} from this division`}
                  className="ml-1 text-gray-500 hover:text-red-600 dark:hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 rounded-full"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Bracket Visualization */}
      {division.bracket ? (
        <Card>
          <CardHeader
            title="Bracket"
            action={<Trophy className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />}
          />
          <CardBody className="overflow-x-auto">
            <div
              ref={bracketGridRef}
              role="grid"
              aria-label={`${division.name} bracket — use arrow keys to move between matches`}
              onKeyDown={handleBracketKeyDown}
            >
            {/* Winners / Losers / Grand Finals sections — all rendered as
                horizontal columns (rounds left-to-right, matches stacked
                vertically within each round column) via the shared
                <BracketSection> component. Adding the same component to all
                three sections guarantees the losers bracket cannot drift
                out of alignment with the winners layout. */}
            <BracketSection
              ariaLabel="Winners bracket"
              title="Winners Bracket"
              rounds={winnersRounds}
              matches={winnersMatches}
              colOffset={0}
              getMatchLabel={getMatchLabel}
              onSelectWinner={handleSelectWinner}
              onSwap={(matchId) => {
                if (confirm('Swap the two competitors in this match? Used to fix a bad auto-seed (e.g. two best kids landing in the same half).')) {
                  swapMutation.mutate(matchId);
                }
              }}
            />

            {losersRounds.length > 0 && (
              <BracketSection
                ariaLabel="Losers bracket"
                title="Losers Bracket"
                rounds={losersRounds}
                matches={losersMatches}
                colOffset={winnersRounds.length}
                getMatchLabel={getMatchLabel}
                onSelectWinner={handleSelectWinner}
                onSwap={(matchId) => {
                  if (confirm('Swap the two competitors in this match?')) {
                    swapMutation.mutate(matchId);
                  }
                }}
              />
            )}

            {finalsMatches.length > 0 && (
              <BracketSection
                ariaLabel="Grand finals"
                title="Grand Finals"
                subtitle="After Losers Final"
                rounds={[0]}
                matches={finalsMatches}
                colOffset={winnersRounds.length + losersRounds.length}
                getMatchLabel={getMatchLabel}
                onSelectWinner={handleSelectWinner}
                onSwap={(matchId) => {
                  if (confirm('Swap the two competitors in this match?')) {
                    swapMutation.mutate(matchId);
                  }
                }}
                showMatchLabels
                matchLabelPrefix="Match"
              />
            )}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="text-center py-12">
            <Trophy className="mx-auto h-12 w-12 text-gray-600 dark:text-gray-500" aria-hidden="true" />
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
              No bracket generated
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Generate a bracket to start the competition.
            </p>
            <Button
              variant="primary"
              className="mt-4"
              onClick={() => generateBracketMutation.mutate()}
              loading={generateBracketMutation.isPending}
              aria-label={`Generate bracket for ${division.name}`}
            >
              Generate Bracket
            </Button>
          </CardBody>
        </Card>
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

      {/* Winner Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!pendingWinner}
        onClose={() => setPendingWinner(null)}
        onConfirm={() => {
          if (pendingWinner) {
            updateMatchMutation.mutate({
              matchId: pendingWinner.matchId,
              winnerId: pendingWinner.winnerId,
            });
            setPendingWinner(null);
          }
        }}
        title="Confirm Winner"
        message={`Record ${pendingWinner?.name ?? ''} as the winner of this match?`}
        confirmText="Record Winner"
        variant="info"
        isLoading={updateMatchMutation.isPending}
      />

      {/* Live region for bracket update announcements. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {bracketAnnounce}
      </div>
    </div>
  );
}

/**
 * Render one bracket section (Winners, Losers, or Grand Finals) as a
 * horizontal row of round columns, with matches stacked vertically inside
 * each column. Shared by all three sections so the Losers bracket cannot
 * drift out of horizontal alignment with the Winners bracket.
 */
function BracketSection({
  ariaLabel,
  title,
  subtitle,
  rounds,
  matches,
  colOffset,
  getMatchLabel,
  onSelectWinner,
  onSwap,
  showMatchLabels = false,
  matchLabelPrefix = 'Match',
}: {
  ariaLabel: string;
  title: string;
  subtitle?: string;
  rounds: number[];
  matches: Match[];
  colOffset: number;
  getMatchLabel: (match: Match) => string;
  onSelectWinner: (matchId: string, winnerId: string, match: Match) => void;
  onSwap?: (matchId: string) => void;
  showMatchLabels?: boolean;
  matchLabelPrefix?: string;
}) {
  // Group matches by round so each column gets its own list. For Grand
  // Finals (rounds=[0]) we just dump every match into a single column.
  const matchesByRound = new Map<number, Match[]>();
  matches.forEach((m) => {
    const key = rounds.length === 1 ? 0 : m.roundNumber;
    const list = matchesByRound.get(key) ?? [];
    list.push(m);
    matchesByRound.set(key, list);
  });

  return (
    <div className="mb-8 last:mb-0" role="rowgroup" aria-label={ariaLabel}>
      <h4
        className={`text-sm font-semibold text-gray-700 dark:text-gray-300 ${
          subtitle ? 'mb-1' : 'mb-4'
        }`}
      >
        {title}
      </h4>
      {subtitle && (
        <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
          {subtitle}
        </p>
      )}
      <div className="flex gap-8">
        {rounds.map((round, colIdx) => {
          const columnMatches = matchesByRound.get(round) ?? [];
          return (
            <div
              key={round}
              className="min-w-max space-y-4"
              role="row"
              aria-label={
                rounds.length === 1 ? ariaLabel : `${ariaLabel} round ${round}`
              }
            >
              {rounds.length > 1 && (
                <div className="text-xs text-gray-600 dark:text-gray-400 text-center mb-2">
                  Round {round}
                </div>
              )}
              {columnMatches.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  label={getMatchLabel(match)}
                  bracketCol={colOffset + colIdx}
                  onSelectWinner={(winnerId) =>
                    onSelectWinner(match.id, winnerId, match)
                  }
                  onSwap={onSwap ? () => onSwap(match.id) : undefined}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MatchCard({
  match,
  bracketCol,
  onSelectWinner,
  onSwap,
  label,
}: {
  match: Match;
  bracketCol: number;
  onSelectWinner: (winnerId: string) => void;
  onSwap?: () => void;
  label: string;
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
  const cardStatus = isComplete ? 'complete' : isReady ? 'ready' : match.status;

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
      <div className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-400 flex justify-between">
        <span>Match {label}</span>
        <span className="capitalize" aria-label={`Status: ${cardStatus}`}>{cardStatus}</span>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        <button
          onClick={() =>
            isReady && match.competitor1Id && onSelectWinner(match.competitor1Id)
          }
          disabled={!isReady}
          data-bracket-cell="true"
          data-col={bracketCol}
          data-row={0}
          aria-pressed={match.winnerId === match.competitor1Id}
          aria-label={
            `Match ${label}, ${name1}` +
            (match.winnerId === match.competitor1Id ? ' (winner)' : '') +
            (isReady ? ' — press Enter to record as winner' : '')
          }
          className={`w-full px-3 py-2 text-left text-sm truncate text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
            match.winnerId === match.competitor1Id
              ? 'bg-green-100 dark:bg-green-800/50 font-semibold'
              : isReady
              ? 'hover:bg-gray-50 dark:hover:bg-gray-700'
              : ''
          }`}
        >
          {name1}
          {match.competitor1?.competitor.schoolDojang && (
            <span className="text-xs text-gray-600 dark:text-gray-500 ml-1">
              ({match.competitor1.competitor.schoolDojang.substring(0, 20)})
            </span>
          )}
        </button>
        <button
          onClick={() =>
            isReady && match.competitor2Id && onSelectWinner(match.competitor2Id)
          }
          disabled={!isReady}
          data-bracket-cell="true"
          data-col={bracketCol}
          data-row={1}
          aria-pressed={match.winnerId === match.competitor2Id}
          aria-label={
            `Match ${label}, ${name2}` +
            (match.winnerId === match.competitor2Id ? ' (winner)' : '') +
            (isReady ? ' — press Enter to record as winner' : '')
          }
          className={`w-full px-3 py-2 text-left text-sm truncate text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
            match.winnerId === match.competitor2Id
              ? 'bg-green-100 dark:bg-green-800/50 font-semibold'
              : isReady
              ? 'hover:bg-gray-50 dark:hover:bg-gray-700'
              : ''
          }`}
        >
          {name2}
          {match.competitor2?.competitor.schoolDojang && (
            <span className="text-xs text-gray-600 dark:text-gray-500 ml-1">
              ({match.competitor2.competitor.schoolDojang.substring(0, 20)})
            </span>
          )}
        </button>
      </div>
      {onSwap && match.competitor1Id && match.competitor2Id && (
        <button
          onClick={onSwap}
          aria-label={`Swap competitors in match ${label}`}
          title="Swap competitors (useful for fixing a bad auto-seed)"
          className="w-full px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center justify-center gap-1"
        >
          <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
          Swap
        </button>
      )}
    </div>
  );
}
