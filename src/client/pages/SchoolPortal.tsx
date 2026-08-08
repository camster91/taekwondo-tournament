import { useState, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Trophy,
  Users,
  CheckCircle,
  XCircle,
  Swords,
  Medal,
  Search,
  ChevronLeft,
  Clock,
  MapPin,
  Calendar,
  Building2,
  Zap,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import Badge, { StatusBadge } from '../components/ui/Badge';
import { PageLoader } from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';

interface SchoolData {
  tournament: {
    id: string;
    name: string;
    date: string;
    location: string | null;
    status: string;
    sportProfileSlug: string | null;
  };
  schoolName: string;
  stats: {
    totalCompetitors: number;
    checkedIn: number;
    competingNow: number;
    medalsWon: number;
  };
  competitors: Array<{
    id: string;
    registrationId: string;
    firstName: string;
    lastName: string;
    belt: string;
    danRank: number | null;
    age: number | null;
    gender: string;
    patterns: boolean;
    sparring: boolean;
    checkedIn: boolean;
    checkInTime: string | null;
    divisions: Array<{
      id: string;
      name: string;
      eventType: string;
      seedPosition: number | null;
    }>;
    matches: Array<{
      id: string;
      matchNumber: number;
      roundNumber: number;
      bracketType: string;
      status: string;
      score1: string | null;
      score2: string | null;
      winnerId: string | null;
      ringNumber: number | null;
      divisionId: string;
      divisionName: string;
      competitor1Name: string | null;
      competitor2Name: string | null;
      isCompetitor1: boolean;
    }>;
    placements: Array<{
      divisionId: string;
      divisionName: string;
      placement: number | null;
    }>;
    nextMatch: {
      id: string;
      matchNumber: number;
      status: string;
      ringNumber: number | null;
      divisionName: string;
    } | null;
  }>;
  upcomingMatches: Array<{
    id: string;
    matchNumber: number;
    status: string;
    ringNumber: number | null;
    divisionName: string;
    competitorName: string;
    opponentName: string | null;
    opponentSchool: string | null;
  }>;
}

interface SchoolListData {
  tournament: { id: string; name: string };
  schools: string[];
}

export default function SchoolPortal() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const schoolName = searchParams.get('name') || '';
  const shareSlug = searchParams.get('slug') || '';
  const [schoolSearch, setSchoolSearch] = useState('');
  const [competitorSearch, setCompetitorSearch] = useState('');

  // Fetch schools list — requires ?slug=<publicSlug> matching the
  // tournament's share link (same gate as the public scoreboard).
  const { data: schoolList, isLoading: schoolsLoading, error: schoolsError } = useQuery<SchoolListData>({
    queryKey: ['school-list', tournamentId, shareSlug],
    queryFn: async () => {
      const res = await fetch(
        `/api/public/tournaments/${tournamentId}/schools?slug=${encodeURIComponent(shareSlug)}`
      );
      if (!res.ok) throw new Error('Failed to fetch schools');
      return res.json();
    },
    enabled: !!tournamentId && !!shareSlug,
  });

  // Fetch school data when a school is selected
  const { data: schoolData, isLoading: dataLoading, error: schoolDataError } = useQuery<SchoolData>({
    queryKey: ['school-portal', tournamentId, schoolName, shareSlug],
    queryFn: async () => {
      const res = await fetch(
        `/api/public/tournaments/${tournamentId}/school/${encodeURIComponent(schoolName)}?slug=${encodeURIComponent(shareSlug)}`
      );
      if (!res.ok) throw new Error('Failed to fetch school data');
      return res.json();
    },
    enabled: !!schoolName && !!shareSlug,
    refetchInterval: 15000, // Refresh every 15 seconds when visible
    // Pause polling when the tab is in the background so a director
    // leaving the page open all day doesn't hammer the API with
    // ~5,760 polls. Resumes automatically when they refocus.
    refetchIntervalInBackground: false,
  });

  const filteredSchools = useMemo(() => {
    if (!schoolList?.schools) return [];
    if (!schoolSearch) return schoolList.schools;
    return schoolList.schools.filter((s) =>
      s.toLowerCase().includes(schoolSearch.toLowerCase())
    );
  }, [schoolList?.schools, schoolSearch]);

  const filteredCompetitors = useMemo(() => {
    if (!schoolData?.competitors) return [];
    if (!competitorSearch) return schoolData.competitors;
    const query = competitorSearch.toLowerCase();
    return schoolData.competitors.filter(
      (c) =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(query) ||
        c.belt.toLowerCase().includes(query)
    );
  }, [schoolData?.competitors, competitorSearch]);

  const selectSchool = (name: string) => {
    const next: Record<string, string> = { name };
    if (shareSlug) next.slug = shareSlug;
    setSearchParams(next);
    setCompetitorSearch('');
  };

  const getBeltColor = (belt: string) => {
    const lower = belt.toLowerCase();
    if (lower.includes('black')) return 'bg-gray-900 text-white';
    if (lower.includes('red')) return 'bg-red-500 text-white';
    if (lower.includes('blue')) return 'bg-blue-500 text-white';
    if (lower.includes('green')) return 'bg-green-500 text-white';
    if (lower.includes('yellow')) return 'bg-yellow-400 text-gray-900';
    if (lower.includes('white')) return 'bg-white text-gray-900 border border-gray-300';
    return 'bg-gray-200 text-gray-800';
  };

  const getPlacementBadge = (placement: number | null) => {
    if (placement === null) return null;
    if (placement === 1)
      return (
        <Badge variant="warning" size="sm">
          1st
        </Badge>
      );
    if (placement === 2)
      return (
        <Badge variant="default" size="sm">
          2nd
        </Badge>
      );
    if (placement === 3)
      return (
        <Badge variant="info" size="sm">
          3rd
        </Badge>
      );
    return null;
  };

  const tournamentName = schoolData?.tournament?.name || schoolList?.tournament?.name || 'Tournament';

  if (!shareSlug) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8 max-w-md w-full">
          <EmptyState
            icon={AlertCircle}
            title="Share link required"
            description="Open this portal from the tournament share link (Settings → Share Link), or ask your director for the school portal URL that includes the slug."
          />
        </div>
      </div>
    );
  }

  // Show school selection if no school is selected
  if (!schoolName) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary-500 to-accent-500 px-6 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
              <Building2 className="h-8 w-8 text-white/90" />
              <h1 className="text-2xl font-bold text-white">School / Dojang Portal</h1>
            </div>
            <p className="text-primary-200 text-sm">{tournamentName}</p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-6 py-8">
          {schoolsLoading ? (
            <PageLoader />
          ) : schoolsError ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8">
              <EmptyState
                icon={AlertCircle}
                title="Couldn't load the school list"
                description="The server returned an error. Try refreshing in a moment."
              />
            </div>
          ) : !schoolList || schoolList.schools.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8">
              <EmptyState
                icon={Building2}
                title="No schools registered"
                description="No schools or dojangs have been registered for this tournament yet."
              />
            </div>
          ) : (
            <>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select your school or dojang
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search schools..."
                    value={schoolSearch}
                    onChange={(e) => setSchoolSearch(e.target.value)}
                    aria-label="Search schools"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredSchools.map((school) => (
                  <button
                    key={school}
                    onClick={() => selectSchool(school)}
                    className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-500 hover:shadow-md transition-all text-left group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-primary-100 dark:bg-primary-900/30 p-2 rounded-lg group-hover:bg-primary-200 dark:group-hover:bg-primary-900/50 transition-colors">
                        <Building2 className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                      </div>
                      <span className="font-medium text-gray-900 dark:text-white text-sm">
                        {school}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {filteredSchools.length === 0 && schoolSearch && (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">
                  No schools matching "{schoolSearch}"
                </p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // School data view
  if (dataLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <div className="bg-gradient-to-r from-primary-500 to-accent-500 px-6 py-8">
          <div className="max-w-6xl mx-auto">
            <h1 className="text-2xl font-bold text-white">Loading...</h1>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <PageLoader />
        </div>
      </div>
    );
  }

  if (!schoolData) {
    // Distinguish "the school genuinely has no competitors" from
    // "the API 500'd and we have no data". Without this branch both
    // cases render "School not found" which is misleading when the
    // real problem is a server outage or rate-limit.
    if (schoolDataError) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8">
            <EmptyState
              icon={AlertCircle}
              title="Couldn't load school data"
              description="The server returned an error. Try refreshing in a moment."
              action={{ label: 'Choose another school', onClick: () => setSearchParams({}) }}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8">
          <EmptyState
            icon={Building2}
            title="School not found"
            description="No competitors from this school are registered."
            action={{ label: 'Choose another school', onClick: () => setSearchParams({}) }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary-500 to-accent-500 px-6 py-6">
        <div className="max-w-6xl mx-auto">
          <button
            onClick={() => setSearchParams({})}
            className="inline-flex items-center text-sm text-primary-200 hover:text-white mb-3 transition-colors"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Change School
          </button>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <Building2 className="h-7 w-7 text-white/90" />
                <h1 className="text-2xl font-bold text-white">{schoolData.schoolName}</h1>
              </div>
              <div className="flex items-center gap-4 mt-2 text-primary-200 text-sm">
                <span className="flex items-center gap-1">
                  <Trophy className="h-4 w-4" />
                  {schoolData.tournament.name}
                </span>
                {schoolData.tournament.date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {new Date(schoolData.tournament.date).toLocaleDateString()}
                  </span>
                )}
                {schoolData.tournament.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {schoolData.tournament.location}
                  </span>
                )}
              </div>
            </div>
            <Link
              to={`/display/${tournamentId}`}
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Live Scoreboard
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Competitors</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {schoolData.stats.totalCompetitors}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="bg-green-100 dark:bg-green-900/30 p-2 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Checked In</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {schoolData.stats.checkedIn}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="bg-yellow-100 dark:bg-yellow-900/30 p-2 rounded-lg">
                <Swords className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Competing Now</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {schoolData.stats.competingNow}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="bg-purple-100 dark:bg-purple-900/30 p-2 rounded-lg">
                <Medal className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Medals Won</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {schoolData.stats.medalsWon}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Upcoming Matches */}
        {schoolData.upcomingMatches.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm mb-6">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Upcoming Matches
                </h2>
                <Badge variant="warning" size="sm">
                  {schoolData.upcomingMatches.length}
                </Badge>
              </div>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {schoolData.upcomingMatches.map((match) => (
                <div key={match.id} className="px-6 py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-600 dark:text-gray-300">
                        #{match.matchNumber}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate">
                          {match.competitorName}
                          <span className="text-gray-400 mx-2">vs</span>
                          {match.opponentName || 'TBD'}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {match.divisionName}
                          {match.opponentSchool && (
                            <span className="ml-2 text-gray-400">({match.opponentSchool})</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {match.ringNumber && (
                        <Badge variant="info" size="sm">
                          Ring {match.ringNumber}
                        </Badge>
                      )}
                      <StatusBadge status={match.status} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Competitor Schedule */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Competitor Schedule
              </h2>
              {schoolData.competitors.length > 3 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search competitors..."
                    value={competitorSearch}
                    onChange={(e) => setCompetitorSearch(e.target.value)}
                    aria-label="Search competitors"
                    className="pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 w-full sm:w-56"
                  />
                </div>
              )}
            </div>
          </div>

          {filteredCompetitors.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Users}
                title="No competitors found"
                description={
                  competitorSearch
                    ? 'No competitors match your search.'
                    : 'No competitors from this school are registered.'
                }
              />
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700/50">
                      <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Competitor
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Events
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Check-in
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Divisions
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Next Match
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Placement
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {filteredCompetitors.map((comp) => (
                      <tr
                        key={comp.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/30"
                      >
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {comp.firstName} {comp.lastName}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${getBeltColor(
                                comp.belt
                              )}`}
                            >
                              {comp.belt}
                              {comp.danRank ? ` ${comp.danRank}D` : ''}
                            </span>
                            {comp.age && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                Age {comp.age}
                              </span>
                            )}
                            <span className="text-xs text-gray-400">
                              {comp.gender === 'M' ? 'Male' : 'Female'}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-1.5">
                            {comp.patterns && (
                              <Badge variant="purple" size="sm">
                                Patterns
                              </Badge>
                            )}
                            {comp.sparring && (
                              <Badge variant="danger" size="sm">
                                Sparring
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {comp.checkedIn ? (
                            <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                              <CheckCircle className="h-4 w-4" />
                              <span className="text-sm">Yes</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-500 dark:text-red-400">
                              <XCircle className="h-4 w-4" />
                              <span className="text-sm">No</span>
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {comp.divisions.length > 0 ? (
                            <div className="space-y-1">
                              {comp.divisions.map((div) => (
                                <div
                                  key={div.id}
                                  className="text-sm text-gray-700 dark:text-gray-300"
                                >
                                  {div.name}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">Not assigned</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {comp.nextMatch ? (
                            <div>
                              <div className="flex items-center gap-1.5">
                                <StatusBadge status={comp.nextMatch.status} />
                                <span className="text-sm text-gray-600 dark:text-gray-300">
                                  #{comp.nextMatch.matchNumber}
                                </span>
                              </div>
                              {comp.nextMatch.ringNumber && (
                                <span className="text-xs text-gray-500 mt-1 block">
                                  Ring {comp.nextMatch.ringNumber}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">
                              {comp.divisions.length > 0 ? 'No active match' : '--'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            {comp.placements
                              .filter((p) => p.placement !== null)
                              .map((p) => (
                                <div key={p.divisionId} className="flex items-center gap-1.5">
                                  {getPlacementBadge(p.placement)}
                                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]">
                                    {p.divisionName}
                                  </span>
                                </div>
                              ))}
                            {comp.placements.every((p) => p.placement === null) && (
                              <span className="text-sm text-gray-400">--</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
                {filteredCompetitors.map((comp) => (
                  <div key={comp.id} className="px-4 py-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {comp.firstName} {comp.lastName}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${getBeltColor(
                              comp.belt
                            )}`}
                          >
                            {comp.belt}
                            {comp.danRank ? ` ${comp.danRank}D` : ''}
                          </span>
                          {comp.age && (
                            <span className="text-xs text-gray-500">Age {comp.age}</span>
                          )}
                        </div>
                      </div>
                      <div>
                        {comp.checkedIn ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-400" />
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {comp.patterns && (
                        <Badge variant="purple" size="sm">
                          Patterns
                        </Badge>
                      )}
                      {comp.sparring && (
                        <Badge variant="danger" size="sm">
                          Sparring
                        </Badge>
                      )}
                    </div>

                    {comp.divisions.length > 0 && (
                      <div className="space-y-1">
                        {comp.divisions.map((div) => (
                          <div
                            key={div.id}
                            className="text-sm text-gray-600 dark:text-gray-400"
                          >
                            {div.name}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      {comp.nextMatch ? (
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-600 dark:text-gray-300">
                            Match #{comp.nextMatch.matchNumber}
                          </span>
                          <StatusBadge status={comp.nextMatch.status} />
                          {comp.nextMatch.ringNumber && (
                            <Badge variant="info" size="sm">
                              Ring {comp.nextMatch.ringNumber}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span />
                      )}
                      <div className="flex gap-1">
                        {comp.placements
                          .filter((p) => p.placement !== null)
                          .map((p) => (
                            <span key={p.divisionId}>{getPlacementBadge(p.placement)}</span>
                          ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
