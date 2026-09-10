import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Trophy,
  Medal,
  TrendingUp,
  Calendar,
  MapPin,
  Award,
  Activity,
  Target,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { StatTile } from '../components/ui';
import { DataTable, TableHead, TableBody } from '../components/ui';
import { Badge } from '../components/ui';
import { TableSkeleton } from '../components/ui/Skeleton';
import { getAuthHeaders } from '../context/AuthContext';

interface Competitor {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  belt: string;
  danRank: number | null;
  schoolDojang: string | null;
}

interface TournamentHistory {
  id: string;
  tournamentId: string;
  divisionName: string;
  eventType: string;
  placement: number;
  matchesWon: number;
  matchesLost: number;
  points: number;
  createdAt: string;
  tournament: {
    id: string;
    name: string;
    date: string;
    location: string | null;
  };
}

interface Rating {
  id: string;
  eventType: string;
  rating: number;
  peakRating: number;
  matchesPlayed: number;
  lastMatchDate: string | null;
  lastUpdated: string;
}

interface Stats {
  overall: {
    matches: number;
    wins: number;
    losses: number;
    winRate: number;
    medals: {
      gold: number;
      silver: number;
      bronze: number;
    };
    tournaments: number;
  };
  patterns: {
    matches: number;
    wins: number;
    losses: number;
    medals: {
      gold: number;
      silver: number;
      bronze: number;
    };
    rating?: Rating;
  };
  sparring: {
    matches: number;
    wins: number;
    losses: number;
    medals: {
      gold: number;
      silver: number;
      bronze: number;
    };
    rating?: Rating;
  };
}

interface CompetitorHistoryData {
  competitor: Competitor;
  history: TournamentHistory[];
  stats: Stats;
}

export default function CompetitorProfile() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery<CompetitorHistoryData>({
    queryKey: ['competitor-history', id],
    queryFn: async () => {
      const res = await fetch(`/api/competitors/${id}/history`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch competitor history');
      return res.json();
    },
  });

  const competitor = data?.competitor;
  const history = data?.history ?? [];
  const stats = data?.stats;

  const getMedalBadge = (placement: number) => {
    if (placement === 1) return <Badge variant="success">🥇 1st</Badge>;
    if (placement === 2) return <Badge variant="info">🥈 2nd</Badge>;
    if (placement === 3) return <Badge variant="warning">🥉 3rd</Badge>;
    return <Badge>{placement}th</Badge>;
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Competitor Profile" description="Loading..." />
        <TableSkeleton />
      </div>
    );
  }

  if (!competitor || !stats) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Competitor Profile" description="Competitor not found" />
        <Link
          to="/competitors"
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Competitors
        </Link>
      </div>
    );
  }

  const age = Math.floor(
    (new Date().getTime() - new Date(competitor.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <PageHeader
        title={`${competitor.firstName} ${competitor.lastName}`}
        description={`${competitor.belt}${competitor.danRank ? ` (${competitor.danRank} Dan)` : ''} • Age ${age} • ${competitor.schoolDojang || 'Independent'}`}
      >
        <Link
          to="/competitors"
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Competitors
        </Link>
      </PageHeader>

      {/* Overall Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          icon={Trophy}
          label="Tournaments"
          value={stats.overall.tournaments}
          accent="blue"
        />
        <StatTile
          icon={Activity}
          label="Overall Record"
          value={`${stats.overall.wins}-${stats.overall.losses}`}
          accent="purple"
          trend={`${stats.overall.winRate.toFixed(1)}% Win Rate`}
        />
        <StatTile
          icon={Medal}
          label="Gold Medals"
          value={stats.overall.medals.gold}
          accent="yellow"
        />
        <StatTile
          icon={Award}
          label="Total Medals"
          value={stats.overall.medals.gold + stats.overall.medals.silver + stats.overall.medals.bronze}
          accent="green"
        />
      </div>

      {/* Event Type Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Patterns Stats */}
        <Card>
          <CardHeader title="Patterns" />
          <CardBody>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Record</span>
                <span className="font-semibold">
                  {stats.patterns.wins}-{stats.patterns.losses}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Medals</span>
                <div className="flex gap-2">
                  <span className="text-yellow-500">🥇 {stats.patterns.medals.gold}</span>
                  <span className="text-gray-500">🥈 {stats.patterns.medals.silver}</span>
                  <span className="text-amber-600">🥉 {stats.patterns.medals.bronze}</span>
                </div>
              </div>
              {stats.patterns.rating && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Current Rating</span>
                    <span className="font-semibold flex items-center gap-1">
                      <Target className="h-4 w-4 text-blue-500" />
                      {Math.round(stats.patterns.rating.rating)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Peak Rating</span>
                    <span className="font-semibold flex items-center gap-1">
                      <TrendingUp className="h-4 w-4 text-green-500" />
                      {Math.round(stats.patterns.rating.peakRating)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Sparring Stats */}
        <Card>
          <CardHeader title="Sparring" />
          <CardBody>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Record</span>
                <span className="font-semibold">
                  {stats.sparring.wins}-{stats.sparring.losses}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Medals</span>
                <div className="flex gap-2">
                  <span className="text-yellow-500">🥇 {stats.sparring.medals.gold}</span>
                  <span className="text-gray-500">🥈 {stats.sparring.medals.silver}</span>
                  <span className="text-amber-600">🥉 {stats.sparring.medals.bronze}</span>
                </div>
              </div>
              {stats.sparring.rating && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Current Rating</span>
                    <span className="font-semibold flex items-center gap-1">
                      <Target className="h-4 w-4 text-blue-500" />
                      {Math.round(stats.sparring.rating.rating)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Peak Rating</span>
                    <span className="font-semibold flex items-center gap-1">
                      <TrendingUp className="h-4 w-4 text-green-500" />
                      {Math.round(stats.sparring.rating.peakRating)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Tournament History */}
      <Card>
        <CardHeader title="Tournament History" />
        <CardBody>
          {history.length === 0 ? (
            <p className="text-center text-gray-600 dark:text-gray-400 py-8">
              No tournament history yet
            </p>
          ) : (
            <DataTable>
              <TableHead>
                <tr>
                  <th className="text-left">Tournament</th>
                  <th className="text-left">Date</th>
                  <th className="text-left">Division</th>
                  <th className="text-left">Event</th>
                  <th className="text-center">Record</th>
                  <th className="text-center">Placement</th>
                </tr>
              </TableHead>
              <TableBody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <Link
                        to={`/tournaments/${entry.tournamentId}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {entry.tournament.name}
                      </Link>
                      {entry.tournament.location && (
                        <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center mt-1">
                          <MapPin className="h-3 w-3 mr-1" />
                          {entry.tournament.location}
                        </div>
                      )}
                    </td>
                    <td className="text-sm">
                      <div className="flex items-center">
                        <Calendar className="h-4 w-4 mr-1 text-gray-400" />
                        {new Date(entry.tournament.date).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="text-sm">{entry.divisionName}</td>
                    <td>
                      <Badge variant={entry.eventType === 'patterns' ? 'purple' : 'info'}>
                        {entry.eventType.charAt(0).toUpperCase() + entry.eventType.slice(1)}
                      </Badge>
                    </td>
                    <td className="text-center text-sm">
                      <span className="text-green-600 dark:text-green-400 font-medium">
                        {entry.matchesWon}W
                      </span>
                      {' - '}
                      <span className="text-red-600 dark:text-red-400 font-medium">
                        {entry.matchesLost}L
                      </span>
                    </td>
                    <td className="text-center">{getMedalBadge(entry.placement)}</td>
                  </tr>
                ))}
              </TableBody>
            </DataTable>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
