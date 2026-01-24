import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Users,
  LayoutGrid,
  Settings,
  Plus,
  Trash2,
  Check,
  ArrowRight,
  Wand2,
  Calendar,
  ClipboardCheck,
  Timer,
  FileDown,
  Monitor,
  Medal,
  LayoutDashboard,
} from 'lucide-react';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  status: string;
  _count: {
    registrations: number;
    divisions: number;
  };
}

interface Competitor {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  belt: string;
  danRank: number | null;
  weightLbs: number | null;
  schoolDojang: string | null;
}

interface Registration {
  id: string;
  competitorId: string;
  patterns: boolean;
  sparring: boolean;
  ageAtTournament: number | null;
  competitor: Competitor;
}

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([]);
  const [registerPatterns, setRegisterPatterns] = useState(true);
  const [registerSparring, setRegisterSparring] = useState(true);

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: ['tournament', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}`);
      return res.json();
    },
  });

  const { data: registrations, isLoading: regsLoading } = useQuery<Registration[]>({
    queryKey: ['registrations', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/registrations`);
      return res.json();
    },
  });

  const { data: allCompetitors } = useQuery({
    queryKey: ['competitors', 'all'],
    queryFn: async () => {
      const res = await fetch('/api/competitors?limit=1000');
      return res.json();
    },
    enabled: showAddModal,
  });

  const bulkRegisterMutation = useMutation({
    mutationFn: async (data: {
      competitorIds: string[];
      patterns: boolean;
      sparring: boolean;
    }) => {
      const res = await fetch(`/api/tournaments/${id}/registrations/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setShowAddModal(false);
      setSelectedCompetitors([]);
    },
  });

  const removeRegistrationMutation = useMutation({
    mutationFn: async (regId: string) => {
      await fetch(`/api/tournaments/${id}/registrations/${regId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
    },
  });

  const updateRegistrationMutation = useMutation({
    mutationFn: async ({
      regId,
      patterns,
      sparring,
    }: {
      regId: string;
      patterns: boolean;
      sparring: boolean;
    }) => {
      const res = await fetch(`/api/tournaments/${id}/registrations/${regId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patterns, sparring }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations', id] });
    },
  });

  const registeredIds = new Set(registrations?.map((r) => r.competitorId) || []);
  const availableCompetitors =
    allCompetitors?.competitors?.filter(
      (c: Competitor) => !registeredIds.has(c.id)
    ) || [];

  const getBeltColor = (belt: string) => {
    const lower = belt.toLowerCase();
    if (lower.includes('black')) return 'bg-gray-900 text-white';
    if (lower.includes('red')) return 'bg-red-500 text-white';
    if (lower.includes('blue')) return 'bg-blue-500 text-white';
    if (lower.includes('green')) return 'bg-green-500 text-white';
    if (lower.includes('yellow')) return 'bg-yellow-400 text-gray-900';
    if (lower.includes('white')) return 'bg-white text-gray-900 border';
    return 'bg-gray-200';
  };

  if (tournamentLoading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!tournament) {
    return <div className="text-center py-12 text-gray-500">Tournament not found</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{tournament.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {new Date(tournament.date).toLocaleDateString()}
            {tournament.location && ` • ${tournament.location}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to={`/tournaments/${id}/settings`} className="btn btn-secondary">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Link>
          <Link to={`/tournaments/${id}/schedule`} className="btn btn-secondary">
            <Calendar className="h-4 w-4 mr-2" />
            Schedule
          </Link>
          <Link to={`/tournaments/${id}/divisions`} className="btn btn-primary">
            <LayoutGrid className="h-4 w-4 mr-2" />
            Manage Divisions
            <ArrowRight className="h-4 w-4 ml-2" />
          </Link>
        </div>
      </div>

      {/* Tournament Day Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <Link
          to={`/tournaments/${id}/director`}
          className="card hover:shadow-lg transition-shadow border-2 border-primary-200"
        >
          <div className="card-body flex items-center">
            <div className="bg-primary-600 p-3 rounded-lg">
              <LayoutDashboard className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Director Dashboard</p>
              <p className="text-sm text-gray-500">Tournament control center</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </Link>

        <Link
          to={`/checkin/${id}`}
          className="card hover:shadow-lg transition-shadow"
        >
          <div className="card-body flex items-center">
            <div className="bg-blue-500 p-3 rounded-lg">
              <ClipboardCheck className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Check-In</p>
              <p className="text-sm text-gray-500">Verify competitor attendance</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </Link>

        <Link
          to={`/scorekeeper/${id}`}
          className="card hover:shadow-lg transition-shadow"
        >
          <div className="card-body flex items-center">
            <div className="bg-green-500 p-3 rounded-lg">
              <Timer className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Scorekeeper</p>
              <p className="text-sm text-gray-500">Record match results</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </Link>

        <a
          href={`/api/brackets/tournament/${id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="card hover:shadow-lg transition-shadow"
        >
          <div className="card-body flex items-center">
            <div className="bg-purple-500 p-3 rounded-lg">
              <FileDown className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Export Brackets</p>
              <p className="text-sm text-gray-500">Download all bracket PDFs</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </a>

        <Link
          to={`/display/${id}`}
          target="_blank"
          className="card hover:shadow-lg transition-shadow"
        >
          <div className="card-body flex items-center">
            <div className="bg-yellow-500 p-3 rounded-lg">
              <Monitor className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Live Scoreboard</p>
              <p className="text-sm text-gray-500">Public display for spectators</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </Link>

        <Link
          to={`/tournaments/${id}/results`}
          className="card hover:shadow-lg transition-shadow"
        >
          <div className="card-body flex items-center">
            <div className="bg-red-500 p-3 rounded-lg">
              <Medal className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Results</p>
              <p className="text-sm text-gray-500">View standings and medals</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="card">
          <div className="card-body flex items-center">
            <div className="bg-blue-500 p-3 rounded-lg">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">Registered</p>
              <p className="text-2xl font-semibold">{registrations?.length || 0}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body flex items-center">
            <div className="bg-green-500 p-3 rounded-lg">
              <LayoutGrid className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">Divisions</p>
              <p className="text-2xl font-semibold">{tournament._count.divisions}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body flex items-center">
            <div className="bg-purple-500 p-3 rounded-lg">
              <Settings className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">Status</p>
              <p className="text-2xl font-semibold capitalize">{tournament.status}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Registrations */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-medium">Registered Competitors</h2>
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus className="h-4 w-4 mr-2" />
            Add Competitors
          </button>
        </div>
        <div className="card-body p-0">
          {regsLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : registrations && registrations.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Age</th>
                  <th>Belt</th>
                  <th>Weight</th>
                  <th>School</th>
                  <th>Patterns</th>
                  <th>Sparring</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {registrations.map((reg) => (
                  <tr key={reg.id}>
                    <td className="font-medium">
                      {reg.competitor.firstName} {reg.competitor.lastName}
                    </td>
                    <td>{reg.ageAtTournament || '-'}</td>
                    <td>
                      <span
                        className={`inline-flex px-2 py-1 rounded text-xs font-medium ${getBeltColor(
                          reg.competitor.belt
                        )}`}
                      >
                        {reg.competitor.belt}
                        {reg.competitor.danRank && ` ${reg.competitor.danRank}D`}
                      </span>
                    </td>
                    <td>
                      {reg.competitor.weightLbs
                        ? `${reg.competitor.weightLbs} lbs`
                        : '-'}
                    </td>
                    <td>{reg.competitor.schoolDojang || '-'}</td>
                    <td>
                      <button
                        onClick={() =>
                          updateRegistrationMutation.mutate({
                            regId: reg.id,
                            patterns: !reg.patterns,
                            sparring: reg.sparring,
                          })
                        }
                        className={`w-6 h-6 rounded flex items-center justify-center ${
                          reg.patterns
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-200 text-gray-400'
                        }`}
                      >
                        {reg.patterns && <Check className="h-4 w-4" />}
                      </button>
                    </td>
                    <td>
                      <button
                        onClick={() =>
                          updateRegistrationMutation.mutate({
                            regId: reg.id,
                            patterns: reg.patterns,
                            sparring: !reg.sparring,
                          })
                        }
                        className={`w-6 h-6 rounded flex items-center justify-center ${
                          reg.sparring
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-200 text-gray-400'
                        }`}
                      >
                        {reg.sparring && <Check className="h-4 w-4" />}
                      </button>
                    </td>
                    <td>
                      <button
                        onClick={() => {
                          if (confirm('Remove this registration?')) {
                            removeRegistrationMutation.mutate(reg.id);
                          }
                        }}
                        className="text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-gray-500">
              <Users className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2">No competitors registered yet</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 text-primary-600 hover:text-primary-700"
              >
                Add competitors
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add Competitors Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden m-4">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold">Add Competitors</h2>
              <div className="mt-4 flex gap-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={registerPatterns}
                    onChange={(e) => setRegisterPatterns(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="ml-2 text-sm">Patterns</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={registerSparring}
                    onChange={(e) => setRegisterSparring(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="ml-2 text-sm">Sparring</span>
                </label>
              </div>
            </div>
            <div className="p-6 overflow-y-auto max-h-96">
              {availableCompetitors.length > 0 ? (
                <div className="space-y-2">
                  <button
                    onClick={() =>
                      setSelectedCompetitors(
                        selectedCompetitors.length === availableCompetitors.length
                          ? []
                          : availableCompetitors.map((c: Competitor) => c.id)
                      )
                    }
                    className="text-sm text-primary-600 hover:text-primary-700"
                  >
                    {selectedCompetitors.length === availableCompetitors.length
                      ? 'Deselect All'
                      : 'Select All'}
                  </button>
                  {availableCompetitors.map((c: Competitor) => (
                    <label
                      key={c.id}
                      className="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCompetitors.includes(c.id)}
                        onChange={(e) =>
                          setSelectedCompetitors(
                            e.target.checked
                              ? [...selectedCompetitors, c.id]
                              : selectedCompetitors.filter((id) => id !== c.id)
                          )
                        }
                        className="rounded border-gray-300"
                      />
                      <span className="ml-3 flex-1">
                        {c.firstName} {c.lastName}
                      </span>
                      <span
                        className={`px-2 py-1 rounded text-xs ${getBeltColor(
                          c.belt
                        )}`}
                      >
                        {c.belt}
                      </span>
                      <span className="ml-2 text-sm text-gray-500">
                        {c.schoolDojang || ''}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  No available competitors. Import some first!
                </div>
              )}
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-between">
              <span className="text-sm text-gray-500">
                {selectedCompetitors.length} selected
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setSelectedCompetitors([]);
                  }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    bulkRegisterMutation.mutate({
                      competitorIds: selectedCompetitors,
                      patterns: registerPatterns,
                      sparring: registerSparring,
                    })
                  }
                  disabled={
                    bulkRegisterMutation.isPending ||
                    selectedCompetitors.length === 0
                  }
                  className="btn btn-primary"
                >
                  {bulkRegisterMutation.isPending
                    ? 'Adding...'
                    : `Add ${selectedCompetitors.length} Competitors`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
