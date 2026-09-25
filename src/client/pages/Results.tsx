import { useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import { calculateResultsStats } from '../utils/results-stats';
import OperationStatus, { type OperationState } from '../components/ui/OperationStatus';
import { downloadBlob, fetchAuthenticatedBlob } from '../utils/authenticated-export';

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
  // Route param is :id (matches TournamentDetail.tsx and other tournament-scoped routes).
  const { id: tournamentId } = useParams();
  const [filterEvent, setFilterEvent] = useState<'all' | 'patterns' | 'sparring'>('all');
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'schools' | 'divisions' | 'breakdown'>('schools');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ state: OperationState; message: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportLockRef = useRef(false);

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
  const resultCounts = calculateResultsStats(divisions ?? []);
  const overallStats = {
    ...resultCounts,
    schools: schoolStats.length,
  };

  const getMedalIcon = (place: number) => {
    if (place === 1) return <Medal className="h-5 w-5 text-warning500" />;
    if (place === 2) return <Medal className="h-5 w-5 text-surface-600" />;
    if (place === 3) return <Medal className="h-5 w-5 text-warning600" />;
    return <span className="text-surface-600 text-sm">{place}th</span>;
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
  // is in the pure builder; here we just trigger the browser download. xlsx
  // is dynamically imported so its ~490KB chunk only downloads on click.
  const exportExcel = async () => {
    if (exportLockRef.current) return;
    exportLockRef.current = true;
    const eventSuffix = filterEvent === 'all' ? '' : `_${filterEvent}`;
    setShowExportMenu(false);
    setExporting(true);
    setExportStatus({ state: 'pending', message: 'Preparing the complete Excel results report.' });
    try {
      const XLSX = await import('xlsx');
      const wb = await buildResultsWorkbook(schoolStats, filteredDivisions ?? []);
      XLSX.writeFile(wb, `tournament_results${eventSuffix}.xlsx`);
      setExportStatus({ state: 'resolved', message: 'Excel results report download started.' });
    } catch (error) {
      setExportStatus({ state: 'rejected', message: error instanceof Error ? error.message : 'Excel export failed.' });
    } finally {
      setExporting(false);
      exportLockRef.current = false;
    }
  };

  const exportPDF = async (kind: 'results' | 'certificates', place?: number) => {
    if (exportLockRef.current || !tournamentId) return;
    exportLockRef.current = true;
    setShowExportMenu(false);
    setExporting(true);
    const label = kind === 'results' ? 'results PDF' : place ? `${getPlaceName(place)} certificates` : 'all certificates';
    setExportStatus({ state: 'pending', message: `Preparing ${label}.` });
    try {
      const query = place ? `?place=${place}` : '';
      const path = kind === 'results' ? 'results/pdf' : `certificates${query}`;
      const blob = await fetchAuthenticatedBlob(fetch, `/api/brackets/tournament/${tournamentId}/${path}`, 'application/pdf', getAuthHeaders());
      const safeName = (tournament?.name || 'Tournament').replace(/[^a-zA-Z0-9]/g, '_');
      downloadBlob(blob, `${safeName}_${kind === 'results' ? 'Results' : place ? `${getPlaceName(place)}_Certificates` : 'Certificates'}.pdf`);
      setExportStatus({ state: 'resolved', message: `${label.charAt(0).toUpperCase()}${label.slice(1)} download started.` });
    } catch (error) {
      setExportStatus({ state: 'rejected', message: error instanceof Error ? error.message : `${label} export failed.` });
    } finally {
      setExporting(false);
      exportLockRef.current = false;
    }
  };

  return (
    <div className="min-h-screen bg-surface-100 dark:bg-surface-900">
      {/* Header */}
      <div className="bg-white dark:bg-surface-800 shadow">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Link
                to={`/tournaments/${tournamentId}`}
                className="mr-3 text-surface-600 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300"
              >
                <ChevronLeft className="h-6 w-6" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-surface-900 dark:text-white">Tournament Results</h1>
                <p className="text-sm text-surface-600 dark:text-surface-400">{tournament?.name}</p>
              </div>
            </div>
            <div className="relative">
              <Button variant="secondary" disabled={exporting} onClick={() => setShowExportMenu(!showExportMenu)}>
                <Download className="h-4 w-4 mr-2" />
                <span className="sr-only sm:not-sr-only">Export</span>
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>

              {showExportMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowExportMenu(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-surface-800 rounded-lg shadow-lg border border-surface-200 dark:border-surface-700 z-20">
                    <div className="py-1">
                      <div className="px-3 py-2 text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase">
                        PDF Export
                      </div>
                      <button
                        type="button"
                        disabled={exporting}
                        className="flex items-center px-4 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
                        onClick={() => void exportPDF('results')}
                      >
                        <Download className="h-4 w-4 mr-3 text-danger500 dark:text-danger400" />
                        Results PDF
                      </button>

                      <div className="border-t border-surface-200 dark:border-surface-700 my-1" />
                      <div className="px-3 py-2 text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase">
                        CSV Export
                      </div>
                      <button
                        onClick={exportSchoolsCSV}
                        className="w-full flex items-center px-4 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-3 text-success500 dark:text-success400" />
                        School Standings
                      </button>
                      <button
                        onClick={exportResultsCSV}
                        className="w-full flex items-center px-4 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-3 text-success500 dark:text-success400" />
                        All Results by Division
                      </button>
                      <button
                        onClick={exportCompetitorsCSV}
                        className="w-full flex items-center px-4 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-3 text-success500 dark:text-success400" />
                        All Results by Competitor
                      </button>

                      <div className="border-t border-surface-200 dark:border-surface-700 my-1" />
                      <div className="px-3 py-2 text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase">
                        Excel Export
                      </div>
                      <button
                        onClick={exportExcel}
                        disabled={exporting}
                        className="w-full flex items-center px-4 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
                      >
                        <FileDown className="h-4 w-4 mr-3 text-info500 dark:text-info400" />
                        Complete Excel Report
                      </button>

                      <div className="border-t border-surface-200 dark:border-surface-700 my-1" />
                      <div className="px-3 py-2 text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase">
                        Certificates
                      </div>
                      <button
                        type="button"
                        disabled={exporting}
                        className="flex items-center px-4 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
                        onClick={() => void exportPDF('certificates')}
                      >
                        <Award className="h-4 w-4 mr-3 text-warning500 dark:text-warning400" />
                        All Certificates (1st-3rd)
                      </button>
                      <button
                        type="button"
                        disabled={exporting}
                        className="flex items-center px-4 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
                        onClick={() => void exportPDF('certificates', 1)}
                      >
                        <Medal className="h-4 w-4 mr-3 text-warning500 dark:text-warning400" />
                        Gold Only (1st Place)
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {exportStatus && (
        <div className="px-4 pt-4">
          <OperationStatus
            state={exportStatus.state}
            message={exportStatus.message}
            actionLabel={exportStatus.state === 'rejected' ? 'Dismiss' : undefined}
            onAction={exportStatus.state === 'rejected' ? () => setExportStatus(null) : undefined}
          />
        </div>
      )}

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
          onChange={(e) => setFilterEvent(e.target.value as 'all' | 'patterns' | 'sparring')}
          className="text-sm"
        >
          <option value="all">All Events</option>
          <option value="patterns">Patterns</option>
          <option value="sparring">Sparring</option>
        </Select>

        <div className="flex bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
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
                    <th className="text-center"><Medal className="h-4 w-4 inline text-warning500" /> Gold</th>
                    <th className="text-center"><Medal className="h-4 w-4 inline text-surface-600" /> Silver</th>
                    <th className="text-center"><Medal className="h-4 w-4 inline text-warning600" /> Bronze</th>
                    <th className="text-center">Total</th>
                  </TableHead>
                  <TableBody>
                    {schoolStats.map((school, index) => (
                      <tr
                        key={school.name}
                        className={`hover:bg-surface-50 dark:hover:bg-surface-700 cursor-pointer ${
                          selectedSchool === school.name ? 'bg-info/50 dark:bg-info/900/30' : ''
                        }`}
                        onClick={() =>
                          setSelectedSchool(selectedSchool === school.name ? null : school.name)
                        }
                      >
                        <td>
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                              index === 0
                                ? 'bg-warning/100 dark:bg-warning/900/50 text-warning800 dark:text-warning300'
                                : index === 1
                                ? 'bg-surface-100 dark:bg-surface-600 text-surface-800 dark:text-surface-200'
                                : index === 2
                                ? 'bg-warning/100 dark:bg-warning/900/50 text-warning800 dark:text-warning300'
                                : 'bg-surface-50 dark:bg-surface-700 text-surface-600 dark:text-surface-400'
                            }`}
                          >
                            {index + 1}
                          </div>
                        </td>
                        <td className="font-medium text-surface-900 dark:text-white">{school.name}</td>
                        <td className="text-center text-lg font-bold text-warning600 dark:text-warning400">{school.gold}</td>
                        <td className="text-center text-lg font-bold text-surface-600">{school.silver}</td>
                        <td className="text-center text-lg font-bold text-warning600 dark:text-warning400">{school.bronze}</td>
                        <td className="text-center text-lg font-semibold text-surface-700 dark:text-surface-300">
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
                    <h3 className="font-semibold text-lg text-surface-900 dark:text-white">{selectedSchool} - All Placements</h3>
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
                      <span className="sr-only sm:not-sr-only">Download Report</span>
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
                            className="flex items-center justify-between p-3 bg-surface-50 dark:bg-surface-700/50 rounded-lg"
                          >
                            <div className="flex items-center">
                              {getMedalIcon(placement.place)}
                              <div className="ml-3">
                                <div className="font-medium text-surface-900 dark:text-white">
                                  {placement.registration.competitor.firstName}{' '}
                                  {placement.registration.competitor.lastName}
                                </div>
                                <div className="text-sm text-surface-600 dark:text-surface-400">{division.name}</div>
                              </div>
                            </div>
                            <span
                              className={`text-sm font-medium ${
                                placement.place === 1
                                  ? 'text-warning600 dark:text-warning400'
                                  : placement.place === 2
                                  ? 'text-surface-500 dark:text-surface-400'
                                  : placement.place === 3
                                  ? 'text-warning600 dark:text-warning400'
                                  : 'text-surface-400 dark:text-surface-500'
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
              <div className="text-center py-12 text-surface-600 dark:text-surface-400">
                No completed divisions with results yet.
              </div>
            ) : (
              filteredDivisions?.map((division) => (
                <Card key={division.id}>
                  <CardBody className="p-0">
                    <div className="px-4 py-3 bg-surface-50 dark:bg-surface-700 border-b border-surface-200 dark:border-surface-600 flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-surface-900 dark:text-white">{division.name}</h3>
                        <span className="text-xs text-surface-600 dark:text-surface-400 capitalize">{division.eventType}</span>
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
                        <p className="text-surface-600 dark:text-surface-400 text-sm">No placements recorded</p>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {division.bracket?.placements
                              ?.sort((a, b) => a.place - b.place)
                              .slice(0, 3)
                              .map((placement) => (
                                <div
                                  key={placement.registrationId}
                                  className={`p-4 rounded-lg border-2 ${
                                    placement.place === 1
                                      ? 'border-warning300 dark:border-warning700 bg-warning/50 dark:bg-warning/900/30'
                                      : placement.place === 2
                                      ? 'border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-700'
                                      : 'border-warning300 dark:border-warning700 bg-warning/50 dark:bg-warning/900/30'
                                  }`}
                                >
                                  <div className="flex items-center mb-2">
                                    {getMedalIcon(placement.place)}
                                    <span className="ml-2 text-sm font-medium text-surface-600 dark:text-surface-400">
                                      {getPlaceName(placement.place)}
                                    </span>
                                  </div>
                                  <div className="font-semibold text-surface-900 dark:text-white">
                                    {placement.registration.competitor.firstName}{' '}
                                    {placement.registration.competitor.lastName}
                                  </div>
                                  <div className="text-sm text-surface-600 dark:text-surface-400">
                                    {placement.registration.competitor.schoolDojang || 'Independent'}
                                  </div>
                                </div>
                              ))}
                          </div>
                          {/* Match Videos Section (P2-9 follow-up) */}
                          {division.bracket?.matches?.some(m => m.videoUrl) && (
                            <div className="mt-4 border-t border-surface-200 dark:border-surface-600 pt-4">
                              <h4 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-2">Match Videos</h4>
                              <div className="space-y-2">
                                {division.bracket.matches
                                  .filter(m => m.videoUrl && m.status === 'completed')
                                  .sort((a, b) => a.matchNumber - b.matchNumber)
                                  .map(match => (
                                    <div key={match.id} className="flex items-center justify-between text-sm bg-surface-50 dark:bg-surface-700/50 p-2 rounded">
                                      <span className="text-surface-700 dark:text-surface-300">
                                        Match #{match.matchNumber}
                                        {match.competitor1 && match.competitor2 && (
                                          <span className="text-surface-500 dark:text-surface-400 ml-1">
                                            ({match.competitor1.competitor.firstName} {match.competitor1.competitor.lastName} vs {match.competitor2.competitor.firstName} {match.competitor2.competitor.lastName})
                                          </span>
                                        )}
                                      </span>
                                      <a
                                        href={match.videoUrl ?? ''}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
                                      >
                                        Watch Video →
                                      </a>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}
                        </>
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
                <div className="px-4 py-3 bg-surface-50 dark:bg-surface-700 border-b border-surface-200 dark:border-surface-600 flex items-center">
                  <BarChart3 className="h-5 w-5 text-surface-600 dark:text-surface-400 mr-2" />
                  <h3 className="font-semibold text-surface-900 dark:text-white">By Belt Level</h3>
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
                              ? 'border-surface-800 dark:border-surface-500 bg-surface-50 dark:bg-surface-700'
                              : 'border-info300 dark:border-info700 bg-info/50 dark:bg-info/900/30'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <span className="font-bold text-lg text-surface-900 dark:text-white">{belt.name}</span>
                            <span className="text-sm text-surface-600 dark:text-surface-400">{belt.divisions} divisions</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-center">
                            <div>
                              <div className="text-2xl font-bold text-warning600 dark:text-warning400">{belt.gold}</div>
                              <div className="text-xs text-surface-600 dark:text-surface-400">Gold</div>
                            </div>
                            <div>
                              <div className="text-2xl font-bold text-surface-600">{belt.silver}</div>
                              <div className="text-xs text-surface-600 dark:text-surface-400">Silver</div>
                            </div>
                            <div>
                              <div className="text-2xl font-bold text-warning600 dark:text-warning400">{belt.bronze}</div>
                              <div className="text-xs text-surface-600 dark:text-surface-400">Bronze</div>
                            </div>
                            <div>
                              <div className="text-2xl font-bold text-surface-700 dark:text-surface-300">{total}</div>
                              <div className="text-xs text-surface-600 dark:text-surface-400">Total</div>
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
                <div className="px-4 py-3 bg-surface-50 dark:bg-surface-700 border-b border-surface-200 dark:border-surface-600 flex items-center">
                  <Users className="h-5 w-5 text-surface-600 dark:text-surface-400 mr-2" />
                  <h3 className="font-semibold text-surface-900 dark:text-white">By Age Group</h3>
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
                        <tr key={age.name} className="hover:bg-surface-50 dark:hover:bg-surface-700">
                          <td className="font-medium text-surface-900 dark:text-white">{age.name} years</td>
                          <td className="text-center text-surface-600 dark:text-surface-400">{age.divisions}</td>
                          <td className="text-center font-bold text-warning600 dark:text-warning400">{age.gold}</td>
                          <td className="text-center font-bold text-surface-600">{age.silver}</td>
                          <td className="text-center font-bold text-warning600 dark:text-warning400">{age.bronze}</td>
                          <td className="text-center font-semibold text-surface-900 dark:text-white">{age.gold + age.silver + age.bronze}</td>
                        </tr>
                      ))}
                      <tr className="bg-surface-50 dark:bg-surface-700 font-semibold">
                        <td className="text-surface-900 dark:text-white">Total</td>
                        <td className="text-center text-surface-700 dark:text-surface-300">{ageBreakdown.reduce((s, a) => s + a.divisions, 0)}</td>
                        <td className="text-center text-warning600 dark:text-warning400">{ageBreakdown.reduce((s, a) => s + a.gold, 0)}</td>
                        <td className="text-center text-surface-600">{ageBreakdown.reduce((s, a) => s + a.silver, 0)}</td>
                        <td className="text-center text-warning600 dark:text-warning400">{ageBreakdown.reduce((s, a) => s + a.bronze, 0)}</td>
                        <td className="text-center text-surface-900 dark:text-white">{ageBreakdown.reduce((s, a) => s + a.gold + a.silver + a.bronze, 0)}</td>
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
