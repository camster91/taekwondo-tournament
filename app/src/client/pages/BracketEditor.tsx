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
import { jsPDF } from 'jspdf';

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
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);

  const { data: division, isLoading } = useQuery<Division>({
    queryKey: ['division', divisionId],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/${divisionId}`);
      return res.json();
    },
  });

  const generateBracketMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/brackets/division/${divisionId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedingStrategy: 'school_spread' }),
      });
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerId, status: 'completed' }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['division', divisionId] });
      setSelectedMatch(null);
    },
  });

  const resetBracketMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/brackets/division/${divisionId}/reset`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['division', divisionId] });
    },
  });

  const exportPDF = () => {
    if (!division) return;

    const doc = new jsPDF('landscape', 'pt', 'letter');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Title
    doc.setFontSize(16);
    doc.text(division.name, pageWidth / 2, 40, { align: 'center' });

    doc.setFontSize(10);
    doc.text('8-Person Double Elimination Bracket', pageWidth / 2, 55, {
      align: 'center',
    });

    // Draw bracket
    if (division.bracket?.matches) {
      const winnersMatches = division.bracket.matches.filter(
        (m) => m.bracketType === 'winners'
      );
      const losersMatches = division.bracket.matches.filter(
        (m) => m.bracketType === 'losers'
      );

      // Winners bracket positions
      const startX = 50;
      const startY = 100;
      const matchWidth = 150;
      const matchHeight = 40;
      const roundGap = 180;
      const verticalGap = 60;

      // Draw winners bracket
      doc.setFontSize(12);
      doc.text('Winners Bracket', startX, startY - 10);

      winnersMatches.forEach((match, idx) => {
        const round = match.roundNumber - 1;
        const matchInRound = match.matchNumber - (round === 0 ? 1 : round === 1 ? 5 : 7);
        const x = startX + round * roundGap;
        const y = startY + matchInRound * (matchHeight + verticalGap) * Math.pow(2, round);

        // Match box
        doc.setDrawColor(200);
        doc.setFillColor(255, 255, 255);
        doc.rect(x, y, matchWidth, matchHeight, 'FD');

        // Competitor names
        doc.setFontSize(9);
        const name1 = match.competitor1
          ? `${match.competitor1.competitor.firstName} ${match.competitor1.competitor.lastName}`
          : 'BYE';
        const name2 = match.competitor2
          ? `${match.competitor2.competitor.firstName} ${match.competitor2.competitor.lastName}`
          : 'BYE';

        doc.text(name1, x + 5, y + 15);
        doc.line(x, y + matchHeight / 2, x + matchWidth, y + matchHeight / 2);
        doc.text(name2, x + 5, y + 35);

        // Match number
        doc.setFontSize(7);
        doc.text(`M${match.matchNumber}`, x + matchWidth - 15, y + 10);
      });

      // Draw losers bracket
      const losersStartY = startY + 250;
      doc.setFontSize(12);
      doc.text('Losers Bracket', startX, losersStartY - 10);

      losersMatches.forEach((match, idx) => {
        const x = startX + (match.roundNumber - 1) * (roundGap * 0.8);
        const y = losersStartY + idx * (matchHeight + 20);

        doc.setDrawColor(200);
        doc.setFillColor(255, 255, 255);
        doc.rect(x, y, matchWidth, matchHeight, 'FD');

        doc.setFontSize(9);
        const name1 = match.competitor1
          ? `${match.competitor1.competitor.firstName} ${match.competitor1.competitor.lastName}`
          : '---';
        const name2 = match.competitor2
          ? `${match.competitor2.competitor.firstName} ${match.competitor2.competitor.lastName}`
          : '---';

        doc.text(name1, x + 5, y + 15);
        doc.line(x, y + matchHeight / 2, x + matchWidth, y + matchHeight / 2);
        doc.text(name2, x + 5, y + 35);

        doc.setFontSize(7);
        doc.text(`M${match.matchNumber}`, x + matchWidth - 15, y + 10);
      });
    }

    // Competitor list
    doc.setFontSize(10);
    doc.text('Competitors:', 50, pageHeight - 80);
    division.assignments.forEach((a, i) => {
      const col = Math.floor(i / 4);
      const row = i % 4;
      doc.setFontSize(8);
      doc.text(
        `${i + 1}. ${a.registration.competitor.firstName} ${a.registration.competitor.lastName} (${
          a.registration.competitor.schoolDojang || 'N/A'
        })`,
        50 + col * 200,
        pageHeight - 65 + row * 12
      );
    });

    doc.save(`${division.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
  };

  if (isLoading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!division) {
    return <div className="text-center py-12 text-gray-500">Division not found</div>;
  }

  const winnersMatches =
    division.bracket?.matches.filter((m) => m.bracketType === 'winners') || [];
  const losersMatches =
    division.bracket?.matches.filter((m) => m.bracketType === 'losers') || [];
  const finalsMatches =
    division.bracket?.matches.filter((m) => m.bracketType === 'finals') || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            to={`/tournaments/${tournamentId}/divisions`}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Divisions
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{division.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {division.assignments.length} competitors
          </p>
        </div>
        <div className="flex gap-3">
          {division.bracket ? (
            <>
              <button
                onClick={() => {
                  if (confirm('Regenerate bracket? This will reset all matches.')) {
                    generateBracketMutation.mutate();
                  }
                }}
                disabled={generateBracketMutation.isPending}
                className="btn btn-secondary"
              >
                <Shuffle className="h-4 w-4 mr-2" />
                Reseed
              </button>
              <button onClick={exportPDF} className="btn btn-secondary">
                <Download className="h-4 w-4 mr-2" />
                Export PDF
              </button>
            </>
          ) : (
            <button
              onClick={() => generateBracketMutation.mutate()}
              disabled={generateBracketMutation.isPending}
              className="btn btn-primary"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {generateBracketMutation.isPending
                ? 'Generating...'
                : 'Generate Bracket'}
            </button>
          )}
        </div>
      </div>

      {/* Competitors List */}
      <div className="card mb-6">
        <div className="card-header">
          <h3 className="font-medium flex items-center">
            <Users className="h-5 w-5 mr-2" />
            Competitors ({division.assignments.length})
          </h3>
        </div>
        <div className="card-body">
          <div className="flex flex-wrap gap-2">
            {division.assignments.map((a, i) => (
              <span
                key={a.id}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100"
              >
                <span className="font-medium mr-1">{i + 1}.</span>
                {a.registration.competitor.firstName}{' '}
                {a.registration.competitor.lastName}
                {a.registration.competitor.schoolDojang && (
                  <span className="ml-1 text-gray-500 text-xs">
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
            <h3 className="font-medium flex items-center">
              <Trophy className="h-5 w-5 mr-2" />
              Bracket
            </h3>
          </div>
          <div className="card-body overflow-x-auto">
            {/* Winners Bracket */}
            <div className="mb-8">
              <h4 className="text-sm font-semibold text-gray-700 mb-4">
                Winners Bracket
              </h4>
              <div className="flex gap-8">
                {[1, 2, 3].map((round) => (
                  <div key={round} className="space-y-4">
                    <div className="text-xs text-gray-500 text-center mb-2">
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
              <h4 className="text-sm font-semibold text-gray-700 mb-4">
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
                      <div className="text-xs text-gray-500 text-center mb-2">
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
                <h4 className="text-sm font-semibold text-gray-700 mb-4">
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
            <Trophy className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">
              No bracket generated
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Generate a bracket to start the competition.
            </p>
            <button
              onClick={() => generateBracketMutation.mutate()}
              disabled={generateBracketMutation.isPending}
              className="mt-4 btn btn-primary"
            >
              Generate Bracket
            </button>
          </div>
        </div>
      )}
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
          ? 'border-green-300 bg-green-50'
          : isReady
          ? 'border-yellow-300 bg-yellow-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="px-2 py-1 bg-gray-100 text-xs text-gray-500 flex justify-between">
        <span>Match {match.matchNumber}</span>
        <span className="capitalize">{match.status}</span>
      </div>
      <div className="divide-y divide-gray-200">
        <button
          onClick={() =>
            isReady && match.competitor1Id && onSelectWinner(match.competitor1Id)
          }
          disabled={!isReady}
          className={`w-full px-3 py-2 text-left text-sm truncate ${
            match.winnerId === match.competitor1Id
              ? 'bg-green-100 font-semibold'
              : isReady
              ? 'hover:bg-gray-50'
              : ''
          }`}
        >
          {name1}
          {match.competitor1?.competitor.schoolDojang && (
            <span className="text-xs text-gray-400 ml-1">
              ({match.competitor1.competitor.schoolDojang.substring(0, 8)})
            </span>
          )}
        </button>
        <button
          onClick={() =>
            isReady && match.competitor2Id && onSelectWinner(match.competitor2Id)
          }
          disabled={!isReady}
          className={`w-full px-3 py-2 text-left text-sm truncate ${
            match.winnerId === match.competitor2Id
              ? 'bg-green-100 font-semibold'
              : isReady
              ? 'hover:bg-gray-50'
              : ''
          }`}
        >
          {name2}
          {match.competitor2?.competitor.schoolDojang && (
            <span className="text-xs text-gray-400 ml-1">
              ({match.competitor2.competitor.schoolDojang.substring(0, 8)})
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
