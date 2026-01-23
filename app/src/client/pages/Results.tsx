import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Trophy,
  Medal,
  Users,
  ChevronLeft,
  Filter,
  Download,
  Award,
  TrendingUp,
} from 'lucide-react';

interface Placement {
  place: number;
  registrationId: string;
  registration: {
    competitor: {
      id: string;
      firstName: string;
      lastName: string;
      schoolDojang: string | null;
    };
  };
}

interface Division {
  id: string;
  name: string;
  eventType: string;
  bracket: {
    id: string;
    status: string;
    placements: Placement[];
    matches: {
      id: string;
      status: string;
    }[];
  } | null;
}

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
}

interface SchoolStats {
  name: string;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
  competitors: number;
}

export default function Results() {
  const { tournamentId } = useParams();
  const [filterEvent, setFilterEvent] = useState<'all' | 'patterns' | 'sparring'>('all');
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'schools' | 'divisions'>('schools');

  // Fetch tournament
  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['results-tournament', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}`);
      return res.json();
    },
  });

  // Fetch divisions with brackets and placements
  const { data: divisions, isLoading } = useQuery<Division[]>({
    queryKey: ['results-divisions', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${tournamentId}`);
      return res.json();
    },
  });

  // Filter divisions
  const filteredDivisions = divisions?.filter((d) => {
    if (!d.bracket || d.bracket.status !== 'completed') return false;
    if (filterEvent === 'all') return true;
    return d.eventType === filterEvent;
  });

  // Calculate school statistics
  const schoolStats: SchoolStats[] = (() => {
    const stats: Record<string, SchoolStats> = {};

    filteredDivisions?.forEach((division) => {
      division.bracket?.placements?.forEach((placement) => {
        const school = placement.registration.competitor.schoolDojang || 'Independent';

        if (!stats[school]) {
          stats[school] = { name: school, gold: 0, silver: 0, bronze: 0, total: 0, competitors: 0 };
        }

        if (placement.place === 1) stats[school].gold++;
        else if (placement.place === 2) stats[school].silver++;
        else if (placement.place === 3) stats[school].bronze++;

        stats[school].total++;
      });
    });

    // Sort by gold, then silver, then bronze
    return Object.values(stats).sort((a, b) => {
      if (b.gold !== a.gold) return b.gold - a.gold;
      if (b.silver !== a.silver) return b.silver - a.silver;
      return b.bronze - a.bronze;
    });
  })();

  // Overall stats
  const overallStats = {
    totalDivisions: filteredDivisions?.length || 0,
    completedDivisions: filteredDivisions?.filter((d) => d.bracket?.status === 'completed').length || 0,
    totalMatches: filteredDivisions?.reduce((sum, d) => sum + (d.bracket?.matches?.length || 0), 0) || 0,
    schools: schoolStats.length,
  };

  const getMedalIcon = (place: number) => {
    if (place === 1) return <Medal className="h-5 w-5 text-yellow-500" />;
    if (place === 2) return <Medal className="h-5 w-5 text-gray-400" />;
    if (place === 3) return <Medal className="h-5 w-5 text-amber-600" />;
    return <span className="text-gray-500 text-sm">{place}th</span>;
  };

  const getPlaceName = (place: number) => {
    if (place === 1) return '1st Place';
    if (place === 2) return '2nd Place';
    if (place === 3) return '3rd Place';
    return `${place}th Place`;
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Link
                to={`/tournaments/${tournamentId}`}
                className="mr-3 text-gray-400 hover:text-gray-600"
              >
                <ChevronLeft className="h-6 w-6" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Tournament Results</h1>
                <p className="text-sm text-gray-500">{tournament?.name}</p>
              </div>
            </div>
            <a
              href={`/api/brackets/tournament/${tournamentId}/results/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary flex items-center"
            >
              <Download className="h-4 w-4 mr-2" />
              Export PDF
            </a>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-purple-100 p-2 rounded-lg">
              <Trophy className="h-5 w-5 text-purple-600" />
            </div>
            <div className="ml-3">
              <div className="text-2xl font-bold text-gray-900">
                {overallStats.completedDivisions}
              </div>
              <div className="text-xs text-gray-500">Divisions Complete</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Award className="h-5 w-5 text-blue-600" />
            </div>
            <div className="ml-3">
              <div className="text-2xl font-bold text-gray-900">{overallStats.totalMatches}</div>
              <div className="text-xs text-gray-500">Total Matches</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-green-100 p-2 rounded-lg">
              <Users className="h-5 w-5 text-green-600" />
            </div>
            <div className="ml-3">
              <div className="text-2xl font-bold text-gray-900">{overallStats.schools}</div>
              <div className="text-xs text-gray-500">Schools Competing</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-yellow-100 p-2 rounded-lg">
              <Medal className="h-5 w-5 text-yellow-600" />
            </div>
            <div className="ml-3">
              <div className="text-2xl font-bold text-gray-900">
                {schoolStats.reduce((sum, s) => sum + s.gold + s.silver + s.bronze, 0)}
              </div>
              <div className="text-xs text-gray-500">Total Medals</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 pb-2 flex gap-2 flex-wrap">
        <select
          value={filterEvent}
          onChange={(e) => setFilterEvent(e.target.value as any)}
          className="px-3 py-2 border rounded-lg text-sm bg-white"
        >
          <option value="all">All Events</option>
          <option value="patterns">Patterns</option>
          <option value="sparring">Sparring</option>
        </select>

        <div className="flex bg-white border rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('schools')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'schools'
                ? 'bg-primary-500 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            By School
          </button>
          <button
            onClick={() => setViewMode('divisions')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'divisions'
                ? 'bg-primary-500 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            By Division
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading results...</div>
        ) : viewMode === 'schools' ? (
          <>
            {/* School Medal Table */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rank
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      School
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-yellow-600 uppercase tracking-wider">
                      <Medal className="h-4 w-4 inline" /> Gold
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      <Medal className="h-4 w-4 inline" /> Silver
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-amber-600 uppercase tracking-wider">
                      <Medal className="h-4 w-4 inline" /> Bronze
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {schoolStats.map((school, index) => (
                    <tr
                      key={school.name}
                      className={`hover:bg-gray-50 cursor-pointer ${
                        selectedSchool === school.name ? 'bg-blue-50' : ''
                      }`}
                      onClick={() =>
                        setSelectedSchool(selectedSchool === school.name ? null : school.name)
                      }
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                            index === 0
                              ? 'bg-yellow-100 text-yellow-800'
                              : index === 1
                              ? 'bg-gray-100 text-gray-800'
                              : index === 2
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-50 text-gray-600'
                          }`}
                        >
                          {index + 1}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{school.name}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center text-lg font-bold text-yellow-600">
                        {school.gold}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center text-lg font-bold text-gray-400">
                        {school.silver}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center text-lg font-bold text-amber-600">
                        {school.bronze}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center text-lg font-semibold text-gray-700">
                        {school.gold + school.silver + school.bronze}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* School Detail */}
            {selectedSchool && (
              <div className="mt-4 bg-white rounded-lg shadow p-4">
                <h3 className="font-semibold text-lg mb-4">{selectedSchool} - All Placements</h3>
                <div className="space-y-2">
                  {filteredDivisions?.map((division) =>
                    division.bracket?.placements
                      ?.filter(
                        (p) =>
                          (p.registration.competitor.schoolDojang || 'Independent') === selectedSchool
                      )
                      .map((placement) => (
                        <div
                          key={placement.registrationId}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-center">
                            {getMedalIcon(placement.place)}
                            <div className="ml-3">
                              <div className="font-medium">
                                {placement.registration.competitor.firstName}{' '}
                                {placement.registration.competitor.lastName}
                              </div>
                              <div className="text-sm text-gray-500">{division.name}</div>
                            </div>
                          </div>
                          <span
                            className={`text-sm font-medium ${
                              placement.place === 1
                                ? 'text-yellow-600'
                                : placement.place === 2
                                ? 'text-gray-500'
                                : placement.place === 3
                                ? 'text-amber-600'
                                : 'text-gray-400'
                            }`}
                          >
                            {getPlaceName(placement.place)}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Division Results View */
          <div className="space-y-4">
            {filteredDivisions?.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                No completed divisions with results yet.
              </div>
            ) : (
              filteredDivisions?.map((division) => (
                <div key={division.id} className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{division.name}</h3>
                      <span className="text-xs text-gray-500 capitalize">{division.eventType}</span>
                    </div>
                    <Link
                      to={`/tournaments/${tournamentId}/divisions/${division.id}/bracket`}
                      className="text-sm text-primary-600 hover:text-primary-700"
                    >
                      View Bracket →
                    </Link>
                  </div>
                  <div className="p-4">
                    {division.bracket?.placements?.length === 0 ? (
                      <p className="text-gray-500 text-sm">No placements recorded</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {division.bracket?.placements
                          ?.sort((a, b) => a.place - b.place)
                          .slice(0, 3)
                          .map((placement) => (
                            <div
                              key={placement.registrationId}
                              className={`p-4 rounded-lg border-2 ${
                                placement.place === 1
                                  ? 'border-yellow-300 bg-yellow-50'
                                  : placement.place === 2
                                  ? 'border-gray-300 bg-gray-50'
                                  : 'border-amber-300 bg-amber-50'
                              }`}
                            >
                              <div className="flex items-center mb-2">
                                {getMedalIcon(placement.place)}
                                <span className="ml-2 text-sm font-medium text-gray-500">
                                  {getPlaceName(placement.place)}
                                </span>
                              </div>
                              <div className="font-semibold text-gray-900">
                                {placement.registration.competitor.firstName}{' '}
                                {placement.registration.competitor.lastName}
                              </div>
                              <div className="text-sm text-gray-500">
                                {placement.registration.competitor.schoolDojang || 'Independent'}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
