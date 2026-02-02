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
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="btn btn-secondary flex items-center"
              >
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="h-4 w-4 ml-1" />
              </button>

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
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-purple-100 dark:bg-purple-900/30 p-2 rounded-lg">
              <Trophy className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="ml-3">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {overallStats.completedDivisions}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Divisions Complete</div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg">
              <Award className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="ml-3">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{overallStats.totalMatches}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Total Matches</div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-green-100 dark:bg-green-900/30 p-2 rounded-lg">
              <Users className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="ml-3">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{overallStats.schools}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Schools Competing</div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-yellow-100 dark:bg-yellow-900/30 p-2 rounded-lg">
              <Medal className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div className="ml-3">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {schoolStats.reduce((sum, s) => sum + s.gold + s.silver + s.bronze, 0)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Total Medals</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 pb-2 flex gap-2 flex-wrap">
        <select
          value={filterEvent}
          onChange={(e) => setFilterEvent(e.target.value as any)}
          className="form-select text-sm"
        >
          <option value="all">All Events</option>
          <option value="patterns">Patterns</option>
          <option value="sparring">Sparring</option>
        </select>

        <div className="flex bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('schools')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'schools'
                ? 'bg-primary-500 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            By School
          </button>
          <button
            onClick={() => setViewMode('divisions')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'divisions'
                ? 'bg-primary-500 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            By Division
          </button>
          <button
            onClick={() => setViewMode('breakdown')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'breakdown'
                ? 'bg-primary-500 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            Breakdown
          </button>
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
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Rank
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      School
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">
                      <Medal className="h-4 w-4 inline" /> Gold
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      <Medal className="h-4 w-4 inline" /> Silver
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                      <Medal className="h-4 w-4 inline" /> Bronze
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
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
                      <td className="px-4 py-3 whitespace-nowrap">
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
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium text-gray-900 dark:text-white">{school.name}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center text-lg font-bold text-yellow-600 dark:text-yellow-400">
                        {school.gold}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center text-lg font-bold text-gray-400">
                        {school.silver}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center text-lg font-bold text-amber-600 dark:text-amber-400">
                        {school.bronze}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center text-lg font-semibold text-gray-700 dark:text-gray-300">
                        {school.gold + school.silver + school.bronze}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* School Detail */}
            {selectedSchool && (
              <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg text-gray-900 dark:text-white">{selectedSchool} - All Placements</h3>
                  <a
                    href={`/api/brackets/tournament/${tournamentId}/school-report?school=${encodeURIComponent(selectedSchool)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary text-sm flex items-center"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Download Report</span>
                  </a>
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
              </div>
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
                <div key={division.id} className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
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
                </div>
              ))
            )}
          </div>
        ) : (
          /* Breakdown View */
          <div className="space-y-6">
            {/* Belt Level Breakdown */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
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
            </div>

            {/* Age Group Breakdown */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center">
                <Users className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-2" />
                <h3 className="font-semibold text-gray-900 dark:text-white">By Age Group</h3>
              </div>
              <div className="p-4 overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="py-2 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Age Group</th>
                      <th className="py-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400">Divisions</th>
                      <th className="py-2 text-center text-sm font-medium text-yellow-600 dark:text-yellow-400">Gold</th>
                      <th className="py-2 text-center text-sm font-medium text-gray-400">Silver</th>
                      <th className="py-2 text-center text-sm font-medium text-amber-600 dark:text-amber-400">Bronze</th>
                      <th className="py-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ageBreakdown.map((age) => (
                      <tr key={age.name} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="py-3 font-medium text-gray-900 dark:text-white">{age.name} years</td>
                        <td className="py-3 text-center text-gray-500 dark:text-gray-400">{age.divisions}</td>
                        <td className="py-3 text-center font-bold text-yellow-600 dark:text-yellow-400">{age.gold}</td>
                        <td className="py-3 text-center font-bold text-gray-400">{age.silver}</td>
                        <td className="py-3 text-center font-bold text-amber-600 dark:text-amber-400">{age.bronze}</td>
                        <td className="py-3 text-center font-semibold text-gray-900 dark:text-white">{age.gold + age.silver + age.bronze}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 dark:bg-gray-700 font-semibold">
                      <td className="py-3 text-gray-900 dark:text-white">Total</td>
                      <td className="py-3 text-center text-gray-700 dark:text-gray-300">{ageBreakdown.reduce((s, a) => s + a.divisions, 0)}</td>
                      <td className="py-3 text-center text-yellow-600 dark:text-yellow-400">{ageBreakdown.reduce((s, a) => s + a.gold, 0)}</td>
                      <td className="py-3 text-center text-gray-400">{ageBreakdown.reduce((s, a) => s + a.silver, 0)}</td>
                      <td className="py-3 text-center text-amber-600 dark:text-amber-400">{ageBreakdown.reduce((s, a) => s + a.bronze, 0)}</td>
                      <td className="py-3 text-center text-gray-900 dark:text-white">{ageBreakdown.reduce((s, a) => s + a.gold + a.silver + a.bronze, 0)}</td>
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
