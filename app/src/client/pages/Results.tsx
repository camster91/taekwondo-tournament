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

// CSV export utility
function downloadCSV(data: string[][], filename: string) {
  const csvContent = data
    .map((row) => row.map((cell) => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

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

  // Parse division name to extract belt level and age group
  const parseDivisionName = (name: string) => {
    // Extract age group (e.g., "10-11", "18-35", "4-5")
    const ageMatch = name.match(/^(\d+-\d+)/);
    const ageGroup = ageMatch ? ageMatch[1] : 'Unknown';

    // Extract belt level (BB = Black Belt, CB = Colored Belt)
    const isBB = name.includes(' BB') || name.includes('BB-') || name.includes('Black Belt');
    const beltLevel = isBB ? 'Black Belt' : 'Colored Belt';

    return { ageGroup, beltLevel };
  };

  // Calculate breakdown by belt level
  const beltBreakdown = (() => {
    const stats: Record<string, { name: string; divisions: number; gold: number; silver: number; bronze: number }> = {
      'Black Belt': { name: 'Black Belt', divisions: 0, gold: 0, silver: 0, bronze: 0 },
      'Colored Belt': { name: 'Colored Belt', divisions: 0, gold: 0, silver: 0, bronze: 0 },
    };

    filteredDivisions?.forEach((division) => {
      const { beltLevel } = parseDivisionName(division.name);
      stats[beltLevel].divisions++;

      division.bracket?.placements?.forEach((placement) => {
        if (placement.place === 1) stats[beltLevel].gold++;
        else if (placement.place === 2) stats[beltLevel].silver++;
        else if (placement.place === 3) stats[beltLevel].bronze++;
      });
    });

    return Object.values(stats);
  })();

  // Calculate breakdown by age group
  const ageBreakdown = (() => {
    const stats: Record<string, { name: string; divisions: number; gold: number; silver: number; bronze: number }> = {};

    filteredDivisions?.forEach((division) => {
      const { ageGroup } = parseDivisionName(division.name);

      if (!stats[ageGroup]) {
        stats[ageGroup] = { name: ageGroup, divisions: 0, gold: 0, silver: 0, bronze: 0 };
      }
      stats[ageGroup].divisions++;

      division.bracket?.placements?.forEach((placement) => {
        if (placement.place === 1) stats[ageGroup].gold++;
        else if (placement.place === 2) stats[ageGroup].silver++;
        else if (placement.place === 3) stats[ageGroup].bronze++;
      });
    });

    // Sort by age group (numeric)
    return Object.values(stats).sort((a, b) => {
      const aNum = parseInt(a.name.split('-')[0]) || 999;
      const bNum = parseInt(b.name.split('-')[0]) || 999;
      return aNum - bNum;
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

  // Export school standings to CSV
  const exportSchoolsCSV = () => {
    const data: string[][] = [
      ['Rank', 'School', 'Gold', 'Silver', 'Bronze', 'Total'],
    ];

    schoolStats.forEach((school, index) => {
      data.push([
        String(index + 1),
        school.name,
        String(school.gold),
        String(school.silver),
        String(school.bronze),
        String(school.gold + school.silver + school.bronze),
      ]);
    });

    const eventSuffix = filterEvent === 'all' ? '' : `_${filterEvent}`;
    downloadCSV(data, `school_standings${eventSuffix}.csv`);
    setShowExportMenu(false);
  };

  // Export all results to CSV
  const exportResultsCSV = () => {
    const data: string[][] = [
      ['Division', 'Event Type', 'Place', 'Competitor', 'School'],
    ];

    filteredDivisions?.forEach((division) => {
      division.bracket?.placements
        ?.sort((a, b) => a.place - b.place)
        .forEach((placement) => {
          data.push([
            division.name,
            division.eventType,
            getPlaceName(placement.place),
            `${placement.registration.competitor.firstName} ${placement.registration.competitor.lastName}`,
            placement.registration.competitor.schoolDojang || 'Independent',
          ]);
        });
    });

    const eventSuffix = filterEvent === 'all' ? '' : `_${filterEvent}`;
    downloadCSV(data, `tournament_results${eventSuffix}.csv`);
    setShowExportMenu(false);
  };

  // Export all competitors with placements
  const exportCompetitorsCSV = () => {
    const data: string[][] = [
      ['Competitor', 'School', 'Division', 'Event Type', 'Place'],
    ];

    const competitorMap = new Map<string, { competitor: any; placements: { division: string; eventType: string; place: number }[] }>();

    filteredDivisions?.forEach((division) => {
      division.bracket?.placements?.forEach((placement) => {
        const key = placement.registration.competitor.id;
        if (!competitorMap.has(key)) {
          competitorMap.set(key, {
            competitor: placement.registration.competitor,
            placements: [],
          });
        }
        competitorMap.get(key)!.placements.push({
          division: division.name,
          eventType: division.eventType,
          place: placement.place,
        });
      });
    });

    competitorMap.forEach(({ competitor, placements }) => {
      placements.forEach((p) => {
        data.push([
          `${competitor.firstName} ${competitor.lastName}`,
          competitor.schoolDojang || 'Independent',
          p.division,
          p.eventType,
          getPlaceName(p.place),
        ]);
      });
    });

    const eventSuffix = filterEvent === 'all' ? '' : `_${filterEvent}`;
    downloadCSV(data, `competitor_results${eventSuffix}.csv`);
    setShowExportMenu(false);
  };

  // Export full results to Excel with multiple sheets
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: School Standings
    const schoolData = [
      ['Rank', 'School', 'Gold', 'Silver', 'Bronze', 'Total'],
      ...schoolStats.map((school, index) => [
        index + 1,
        school.name,
        school.gold,
        school.silver,
        school.bronze,
        school.gold + school.silver + school.bronze,
      ]),
    ];
    const schoolSheet = XLSX.utils.aoa_to_sheet(schoolData);
    schoolSheet['!cols'] = [{ wch: 6 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, schoolSheet, 'School Standings');

    // Sheet 2: Results by Division
    const divisionData = [
      ['Division', 'Event Type', 'Place', 'Competitor', 'School'],
    ];
    filteredDivisions?.forEach((division) => {
      division.bracket?.placements
        ?.sort((a, b) => a.place - b.place)
        .forEach((placement) => {
          divisionData.push([
            division.name,
            division.eventType,
            getPlaceName(placement.place),
            `${placement.registration.competitor.firstName} ${placement.registration.competitor.lastName}`,
            placement.registration.competitor.schoolDojang || 'Independent',
          ]);
        });
    });
    const divisionSheet = XLSX.utils.aoa_to_sheet(divisionData);
    divisionSheet['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 25 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, divisionSheet, 'By Division');

    // Sheet 3: Belt Level Breakdown
    const beltData = [
      ['Belt Level', 'Divisions', 'Gold', 'Silver', 'Bronze', 'Total'],
      ...beltBreakdown.map((belt) => [
        belt.name,
        belt.divisions,
        belt.gold,
        belt.silver,
        belt.bronze,
        belt.gold + belt.silver + belt.bronze,
      ]),
    ];
    const beltSheet = XLSX.utils.aoa_to_sheet(beltData);
    XLSX.utils.book_append_sheet(wb, beltSheet, 'By Belt Level');

    // Sheet 4: Age Group Breakdown
    const ageData = [
      ['Age Group', 'Divisions', 'Gold', 'Silver', 'Bronze', 'Total'],
      ...ageBreakdown.map((age) => [
        `${age.name} years`,
        age.divisions,
        age.gold,
        age.silver,
        age.bronze,
        age.gold + age.silver + age.bronze,
      ]),
      ['Total',
        ageBreakdown.reduce((s, a) => s + a.divisions, 0),
        ageBreakdown.reduce((s, a) => s + a.gold, 0),
        ageBreakdown.reduce((s, a) => s + a.silver, 0),
        ageBreakdown.reduce((s, a) => s + a.bronze, 0),
        ageBreakdown.reduce((s, a) => s + a.gold + a.silver + a.bronze, 0),
      ],
    ];
    const ageSheet = XLSX.utils.aoa_to_sheet(ageData);
    XLSX.utils.book_append_sheet(wb, ageSheet, 'By Age Group');

    // Download
    const eventSuffix = filterEvent === 'all' ? '' : `_${filterEvent}`;
    XLSX.writeFile(wb, `tournament_results${eventSuffix}.xlsx`);
    setShowExportMenu(false);
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
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="btn btn-secondary flex items-center"
              >
                <Download className="h-4 w-4 mr-2" />
                Export
                <ChevronDown className="h-4 w-4 ml-1" />
              </button>

              {showExportMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowExportMenu(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border z-20">
                    <div className="py-1">
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                        PDF Export
                      </div>
                      <a
                        href={`/api/brackets/tournament/${tournamentId}/results/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => setShowExportMenu(false)}
                      >
                        <Download className="h-4 w-4 mr-3 text-red-500" />
                        Results PDF
                      </a>

                      <div className="border-t my-1" />
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                        CSV Export
                      </div>
                      <button
                        onClick={exportSchoolsCSV}
                        className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-3 text-green-500" />
                        School Standings
                      </button>
                      <button
                        onClick={exportResultsCSV}
                        className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-3 text-green-500" />
                        All Results by Division
                      </button>
                      <button
                        onClick={exportCompetitorsCSV}
                        className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-3 text-green-500" />
                        All Results by Competitor
                      </button>

                      <div className="border-t my-1" />
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                        Excel Export
                      </div>
                      <button
                        onClick={exportExcel}
                        className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <FileDown className="h-4 w-4 mr-3 text-blue-500" />
                        Complete Excel Report
                      </button>

                      <div className="border-t my-1" />
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                        Certificates
                      </div>
                      <a
                        href={`/api/brackets/tournament/${tournamentId}/certificates`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => setShowExportMenu(false)}
                      >
                        <Award className="h-4 w-4 mr-3 text-yellow-500" />
                        All Certificates (1st-3rd)
                      </a>
                      <a
                        href={`/api/brackets/tournament/${tournamentId}/certificates?place=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => setShowExportMenu(false)}
                      >
                        <Medal className="h-4 w-4 mr-3 text-yellow-500" />
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
          <button
            onClick={() => setViewMode('breakdown')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'breakdown'
                ? 'bg-primary-500 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Breakdown
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
        ) : viewMode === 'divisions' ? (
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
        ) : (
          /* Breakdown View */
          <div className="space-y-6">
            {/* Belt Level Breakdown */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center">
                <BarChart3 className="h-5 w-5 text-gray-500 mr-2" />
                <h3 className="font-semibold text-gray-900">By Belt Level</h3>
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
                            ? 'border-gray-800 bg-gray-50'
                            : 'border-blue-300 bg-blue-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-bold text-lg">{belt.name}</span>
                          <span className="text-sm text-gray-500">{belt.divisions} divisions</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div>
                            <div className="text-2xl font-bold text-yellow-600">{belt.gold}</div>
                            <div className="text-xs text-gray-500">Gold</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-gray-400">{belt.silver}</div>
                            <div className="text-xs text-gray-500">Silver</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-amber-600">{belt.bronze}</div>
                            <div className="text-xs text-gray-500">Bronze</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-gray-700">{total}</div>
                            <div className="text-xs text-gray-500">Total</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Age Group Breakdown */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center">
                <Users className="h-5 w-5 text-gray-500 mr-2" />
                <h3 className="font-semibold text-gray-900">By Age Group</h3>
              </div>
              <div className="p-4">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 text-left text-sm font-medium text-gray-500">Age Group</th>
                      <th className="py-2 text-center text-sm font-medium text-gray-500">Divisions</th>
                      <th className="py-2 text-center text-sm font-medium text-yellow-600">Gold</th>
                      <th className="py-2 text-center text-sm font-medium text-gray-400">Silver</th>
                      <th className="py-2 text-center text-sm font-medium text-amber-600">Bronze</th>
                      <th className="py-2 text-center text-sm font-medium text-gray-500">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ageBreakdown.map((age) => (
                      <tr key={age.name} className="border-b hover:bg-gray-50">
                        <td className="py-3 font-medium">{age.name} years</td>
                        <td className="py-3 text-center text-gray-500">{age.divisions}</td>
                        <td className="py-3 text-center font-bold text-yellow-600">{age.gold}</td>
                        <td className="py-3 text-center font-bold text-gray-400">{age.silver}</td>
                        <td className="py-3 text-center font-bold text-amber-600">{age.bronze}</td>
                        <td className="py-3 text-center font-semibold">{age.gold + age.silver + age.bronze}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold">
                      <td className="py-3">Total</td>
                      <td className="py-3 text-center">{ageBreakdown.reduce((s, a) => s + a.divisions, 0)}</td>
                      <td className="py-3 text-center text-yellow-600">{ageBreakdown.reduce((s, a) => s + a.gold, 0)}</td>
                      <td className="py-3 text-center text-gray-400">{ageBreakdown.reduce((s, a) => s + a.silver, 0)}</td>
                      <td className="py-3 text-center text-amber-600">{ageBreakdown.reduce((s, a) => s + a.bronze, 0)}</td>
                      <td className="py-3 text-center">{ageBreakdown.reduce((s, a) => s + a.gold + a.silver + a.bronze, 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
