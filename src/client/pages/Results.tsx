import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Trophy,
  Medal,
  Users,
  ChevronLeft,
  Download,
  Award,
  FileSpreadsheet,
  ChevronDown,
  BarChart3,
  FileDown,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import { getAuthHeaders } from '../context/AuthContext';
import { Card, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Select } from '../components/ui';
import { StatTile } from '../components/ui';
import { DataTable, TableHead, TableBody } from '../components/ui';
import {
  type DivisionLike,
  type SchoolStats,
  buildSchoolsCSV,
  buildResultsCSV,
  buildCompetitorsCSV,
  downloadCSV,
  getPlaceName,
} from '../utils/csv-export';
import {
  buildBeltBreakdown,
  buildAgeBreakdown,
  buildResultsWorkbook,
} from '../utils/excel-export';

// Local interfaces `Division` and `SchoolStats` removed — they now come from
// `../utils/csv-export` as `DivisionLike` and `SchoolStats`. The other shapes
// here are kept local since they don't need to be shared.
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

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
}

// CSV export utility — see ../utils/csv-export.ts for the testable builders
// and the browser-side `downloadCSV` that triggers the file save.
export default function Results() {
  const { tournamentId } = useParams();
  const [filterEvent, setFilterEvent] = useState<'all' | 'patterns' | 'sparring'>('all');
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'schools' | 'divisions' | 'breakdown'>('schools');
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Fetch tournament
  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['results-tournament', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournament');
      return res.json();
    },
  });

  // Fetch divisions with brackets and placements
  const { data: divisions, isLoading } = useQuery<DivisionLike[]>({
    queryKey: ['results-divisions', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${tournamentId}?withMatches=true`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch divisions');
      return res.json();
    },
  });

  // Filter divisions (show completed and in-progress with partial results)
  const filteredDivisions = divisions?.filter((d) => {
    if (!d.bracket) return false;
    const hasCompletedMatches = d.bracket.matches?.some(m => m.status === 'completed');
    if (!hasCompletedMatches) return false;
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

    return Object.values(stats).sort((a, b) => {
      if (b.gold !== a.gold) return b.gold - a.gold;
      if (b.silver !== a.silver) return b.silver - a.silver;
      return b.bronze - a.bronze;
    });
  })();

  // Breakdown data is computed by the pure builders in ../utils/excel-export
  // so the same logic is testable without React. The IIFEs just call them
  // against the current `filteredDivisions` snapshot.
  const beltBreakdown = buildBeltBreakdown(filteredDivisions ?? []);
  const ageBreakdown = buildAgeBreakdown(filteredDivisions ?? []);

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

  // getPlaceName is imported from ../utils/csv-export (it's also used inside
  // the pure builders there for consistency).

  // Export school standings to CSV
  const exportSchoolsCSV = () => {
    const eventSuffix = filterEvent === 'all' ? '' : `_${filterEvent}`;
    const tournamentName = (tournament?.name || 'tournament').replace(/[^a-zA-Z0-9]/g, '_');
    downloadCSV(buildSchoolsCSV(schoolStats), `${tournamentName}_school_standings${eventSuffix}.csv`);
    setShowExportMenu(false);
  };

  // Export all results to CSV
  const exportResultsCSV = () => {
    const eventSuffix = filterEvent === 'all' ? '' : `_${filterEvent}`;
    const tournamentName = (tournament?.name || 'tournament').replace(/[^a-zA-Z0-9]/g, '_');
    downloadCSV(buildResultsCSV(filteredDivisions ?? []), `${tournamentName}_results${eventSuffix}.csv`);
    setShowExportMenu(false);
  };

  // Export all competitors with placements
  const exportCompetitorsCSV = () => {
    const eventSuffix = filterEvent === 'all' ? '' : `_${filterEvent}`;
    const tournamentName = (tournament?.name || 'tournament').replace(/[^a-zA-Z0-9]/g, '_');
    downloadCSV(buildCompetitorsCSV(filteredDivisions ?? []), `${tournamentName}_competitor_results${eventSuffix}.csv`);
    setShowExportMenu(false);
  };

  // Export full results to Excel with multiple sheets. The workbook assembly
  // is in the pure builder; here we just trigger the browser download.
  const exportExcel = () => {
    const eventSuffix = filterEvent === 'all' ? '' : `_${filterEvent}`;
    const wb = buildResultsWorkbook(schoolStats, filteredDivisions ?? []);
    XLSX.writeFile(wb, `tournament_results${eventSuffix}.xlsx`);
    setShowExportMenu(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Link
                to={`/tournaments/${tournamentId}`}
                className="mr-3 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <ChevronLeft className="h-6 w-6" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">Tournament Results</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">{tournament?.name}</p>
              </div>
            </div>
            <div className="relative">
              <Button variant="secondary" onClick={() => setShowExportMenu(!showExportMenu)}>
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>

              {showExportMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowExportMenu(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20">
                    <div className="py-1">
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                        PDF Export
                      </div>
                      <a
                        href={`/api/brackets/tournament/${tournamentId}/results/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => setShowExportMenu(false)}
                      >
                        <Download className="h-4 w-4 mr-3 text-red-500 dark:text-red-400" />
                        Results PDF
                      </a>

                      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                        CSV Export
                      </div>
                      <button
                        onClick={exportSchoolsCSV}
                        className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-3 text-green-500 dark:text-green-400" />
                        School Standings
                      </button>
                      <button
                        onClick={exportResultsCSV}
                        className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-3 text-green-500 dark:text-green-400" />
                        All Results by Division
                      </button>
                      <button
                        onClick={exportCompetitorsCSV}
                        className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-3 text-green-500 dark:text-green-400" />
                        All Results by Competitor
                      </button>

                      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                        Excel Export
                      </div>
                      <button
                        onClick={exportExcel}
                        className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <FileDown className="h-4 w-4 mr-3 text-blue-500 dark:text-blue-400" />
                        Complete Excel Report
                      </button>

                      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                        Certificates
                      </div>
                      <a
                        href={`/api/brackets/tournament/${tournamentId}/certificates`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => setShowExportMenu(false)}
                      >
                        <Award className="h-4 w-4 mr-3 text-yellow-500 dark:text-yellow-400" />
                        All Certificates (1st-3rd)
                      </a>
                      <a
                        href={`/api/brackets/tournament/${tournamentId}/certificates?place=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => setShowExportMenu(false)}
                      >
                        <Medal className="h-4 w-4 mr-3 text-yellow-500 dark:text-yellow-400" />
                        Gold Only (1st Place)
                      </a>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="Divisions Complete"
          value={overallStats.completedDivisions}
          icon={<Trophy className="h-5 w-5" />}
          accent="indigo"
        />
        <StatTile
          label="Total Matches"
          value={overallStats.totalMatches}
          icon={<Award className="h-5 w-5" />}
          accent="default"
        />
        <StatTile
          label="Schools Competing"
          value={overallStats.schools}
          icon={<Users className="h-5 w-5" />}
          accent="success"
        />
        <StatTile
          label="Total Medals"
          value={schoolStats.reduce((sum, s) => sum + s.gold + s.silver + s.bronze, 0)}
          icon={<Medal className="h-5 w-5" />}
          accent="warning"
        />
      </div>

      {/* Filters */}
      <div className="px-4 pb-2 flex gap-2 flex-wrap">
        <Select
          value={filterEvent}
          onChange={(e) => setFilterEvent(e.target.value as any)}
          className="text-sm"
        >
          <option value="all">All Events</option>
          <option value="patterns">Patterns</option>
          <option value="sparring">Sparring</option>
        </Select>

        <div className="flex bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <Button
            variant={viewMode === 'schools' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('schools')}
          >
            By School
          </Button>
          <Button
            variant={viewMode === 'divisions' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('divisions')}
          >
            By Division
          </Button>
          <Button
            variant={viewMode === 'breakdown' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('breakdown')}
          >
            Breakdown
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {isLoading ? (
          <div className="space-y-4">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : viewMode === 'schools' ? (
          <>
            {/* School Medal Table */}
            <Card>
              <CardBody className="p-0">
                <DataTable>
                  <TableHead>
                    <th>Rank</th>
                    <th>School</th>
                    <th className="text-center"><Medal className="h-4 w-4 inline text-yellow-500" /> Gold</th>
                    <th className="text-center"><Medal className="h-4 w-4 inline text-gray-400" /> Silver</th>
                    <th className="text-center"><Medal className="h-4 w-4 inline text-amber-600" /> Bronze</th>
                    <th className="text-center">Total</th>
                  </TableHead>
                  <TableBody>
                    {schoolStats.map((school, index) => (
                      <tr
                        key={school.name}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${
                          selectedSchool === school.name ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                        }`}
                        onClick={() =>
                          setSelectedSchool(selectedSchool === school.name ? null : school.name)
                        }
                      >
                        <td>
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                              index === 0
                                ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300'
                                : index === 1
                                ? 'bg-gray-100 dark:bg-gray-600 text-gray-800 dark:text-gray-200'
                                : index === 2
                                ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
                                : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                            }`}
                          >
                            {index + 1}
                          </div>
                        </td>
                        <td className="font-medium text-gray-900 dark:text-white">{school.name}</td>
                        <td className="text-center text-lg font-bold text-yellow-600 dark:text-yellow-400">{school.gold}</td>
                        <td className="text-center text-lg font-bold text-gray-400">{school.silver}</td>
                        <td className="text-center text-lg font-bold text-amber-600 dark:text-amber-400">{school.bronze}</td>
                        <td className="text-center text-lg font-semibold text-gray-700 dark:text-gray-300">
                          {school.gold + school.silver + school.bronze}
                        </td>
                      </tr>
                    ))}
                  </TableBody>
                </DataTable>
              </CardBody>
            </Card>

            {/* School Detail */}
            {selectedSchool && (
              <Card className="mt-4">
                <CardBody className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-lg text-gray-900 dark:text-white">{selectedSchool} - All Placements</h3>
                    <Button
                      as="a"
                      href={`/api/brackets/tournament/${tournamentId}/school-report?school=${encodeURIComponent(selectedSchool)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="secondary"
                      size="sm"
                      className="flex items-center"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      <span className="hidden sm:inline">Download Report</span>
                    </Button>
                  </div>
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
                            className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                          >
                            <div className="flex items-center">
                              {getMedalIcon(placement.place)}
                              <div className="ml-3">
                                <div className="font-medium text-gray-900 dark:text-white">
                                  {placement.registration.competitor.firstName}{' '}
                                  {placement.registration.competitor.lastName}
                                </div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">{division.name}</div>
                              </div>
                            </div>
                            <span
                              className={`text-sm font-medium ${
                                placement.place === 1
                                  ? 'text-yellow-600 dark:text-yellow-400'
                                  : placement.place === 2
                                  ? 'text-gray-500 dark:text-gray-400'
                                  : placement.place === 3
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-gray-400 dark:text-gray-500'
                              }`}
                            >
                              {getPlaceName(placement.place)}
                            </span>
                          </div>
                        ))
                    )}
                  </div>
                </CardBody>
              </Card>
            )}
          </>
        ) : viewMode === 'divisions' ? (
          /* Division Results View */
          <div className="space-y-4">
            {filteredDivisions?.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                No completed divisions with results yet.
              </div>
            ) : (
              filteredDivisions?.map((division) => (
                <Card key={division.id}>
                  <CardBody className="p-0">
                    <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">{division.name}</h3>
                        <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">{division.eventType}</span>
                      </div>
                      <Link
                        to={`/tournaments/${tournamentId}/divisions/${division.id}/bracket`}
                        className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                      >
                        View Bracket →
                      </Link>
                    </div>
                    <div className="p-4">
                      {division.bracket?.placements?.length === 0 ? (
                        <p className="text-gray-500 dark:text-gray-400 text-sm">No placements recorded</p>
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
                                    ? 'border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/30'
                                    : placement.place === 2
                                    ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700'
                                    : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30'
                                }`}
                              >
                                <div className="flex items-center mb-2">
                                  {getMedalIcon(placement.place)}
                                  <span className="ml-2 text-sm font-medium text-gray-500 dark:text-gray-400">
                                    {getPlaceName(placement.place)}
                                  </span>
                                </div>
                                <div className="font-semibold text-gray-900 dark:text-white">
                                  {placement.registration.competitor.firstName}{' '}
                                  {placement.registration.competitor.lastName}
                                </div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                  {placement.registration.competitor.schoolDojang || 'Independent'}
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </CardBody>
                </Card>
              ))
            )}
          </div>
        ) : (
          /* Breakdown View */
          <div className="space-y-6">
            {/* Belt Level Breakdown */}
            <Card>
              <CardBody className="p-0">
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center">
                  <BarChart3 className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-2" />
                  <h3 className="font-semibold text-gray-900 dark:text-white">By Belt Level</h3>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {beltBreakdown.map((belt) => {
                      const total = belt.gold + belt.silver + belt.bronze;
                      return (
                        <div
                          key={belt.name}
                          className={`p-4 rounded-lg border-2 ${
                            belt.name === 'Black Belt'
                              ? 'border-gray-800 dark:border-gray-500 bg-gray-50 dark:bg-gray-700'
                              : 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <span className="font-bold text-lg text-gray-900 dark:text-white">{belt.name}</span>
                            <span className="text-sm text-gray-500 dark:text-gray-400">{belt.divisions} divisions</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-center">
                            <div>
                              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{belt.gold}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">Gold</div>
                            </div>
                            <div>
                              <div className="text-2xl font-bold text-gray-400">{belt.silver}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">Silver</div>
                            </div>
                            <div>
                              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{belt.bronze}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">Bronze</div>
                            </div>
                            <div>
                              <div className="text-2xl font-bold text-gray-700 dark:text-gray-300">{total}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">Total</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Age Group Breakdown */}
            <Card>
              <CardBody className="p-0">
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center">
                  <Users className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-2" />
                  <h3 className="font-semibold text-gray-900 dark:text-white">By Age Group</h3>
                </div>
                <div className="p-4 overflow-x-auto">
                  <DataTable>
                    <TableHead>
                      <th>Age Group</th>
                      <th className="text-center">Divisions</th>
                      <th className="text-center">Gold</th>
                      <th className="text-center">Silver</th>
                      <th className="text-center">Bronze</th>
                      <th className="text-center">Total</th>
                    </TableHead>
                    <TableBody>
                      {ageBreakdown.map((age) => (
                        <tr key={age.name} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="font-medium text-gray-900 dark:text-white">{age.name} years</td>
                          <td className="text-center text-gray-500 dark:text-gray-400">{age.divisions}</td>
                          <td className="text-center font-bold text-yellow-600 dark:text-yellow-400">{age.gold}</td>
                          <td className="text-center font-bold text-gray-400">{age.silver}</td>
                          <td className="text-center font-bold text-amber-600 dark:text-amber-400">{age.bronze}</td>
                          <td className="text-center font-semibold text-gray-900 dark:text-white">{age.gold + age.silver + age.bronze}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 dark:bg-gray-700 font-semibold">
                        <td className="text-gray-900 dark:text-white">Total</td>
                        <td className="text-center text-gray-700 dark:text-gray-300">{ageBreakdown.reduce((s, a) => s + a.divisions, 0)}</td>
                        <td className="text-center text-yellow-600 dark:text-yellow-400">{ageBreakdown.reduce((s, a) => s + a.gold, 0)}</td>
                        <td className="text-center text-gray-400">{ageBreakdown.reduce((s, a) => s + a.silver, 0)}</td>
                        <td className="text-center text-amber-600 dark:text-amber-400">{ageBreakdown.reduce((s, a) => s + a.bronze, 0)}</td>
                        <td className="text-center text-gray-900 dark:text-white">{ageBreakdown.reduce((s, a) => s + a.gold + a.silver + a.bronze, 0)}</td>
                      </tr>
                    </TableBody>
                  </DataTable>
                </div>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
