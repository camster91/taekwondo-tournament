import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Wand2,
  FileDown,
  LayoutGrid,
  Users,
  ChevronRight,
  Trash2,
  PlayCircle,
  ArrowLeft,
} from 'lucide-react';

interface Division {
  id: string;
  name: string;
  beltLevel: string;
  gender: string;
  eventType: string;
  ageMin: number;
  ageMax: number;
  weightClass: string | null;
  divisionNumber: number;
  _count: {
    assignments: number;
  };
  bracket: { id: string } | null;
}

interface Tournament {
  id: string;
  name: string;
}

export default function Divisions() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState({
    beltLevel: '',
    gender: '',
    eventType: '',
  });

  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['tournament', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}`);
      return res.json();
    },
  });

  const { data: divisions, isLoading } = useQuery<Division[]>({
    queryKey: ['divisions', id],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${id}`);
      return res.json();
    },
  });

  const autoGenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${id}/auto-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { divisionThreshold: 8 } }),
      });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      alert(
        `Auto-generation complete!\nDivisions: ${result.divisions}\nAssignments: ${result.assignments}${
          result.warnings?.length
            ? `\n\nWarnings:\n${result.warnings.join('\n')}`
            : ''
        }`
      );
    },
  });

  const generateAllBracketsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/brackets/tournament/${id}/generate-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedingStrategy: 'school_spread' }),
      });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      alert(
        `Generated ${result.generated} brackets (${result.skipped} skipped)`
      );
    },
  });

  const clearDivisionsMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/divisions/tournament/${id}/all`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
    },
  });

  const filteredDivisions = divisions?.filter((d) => {
    if (filter.beltLevel && d.beltLevel !== filter.beltLevel) return false;
    if (filter.gender && d.gender !== filter.gender) return false;
    if (filter.eventType && d.eventType !== filter.eventType) return false;
    return true;
  });

  // Group divisions by category
  const groupedDivisions = filteredDivisions?.reduce(
    (acc, div) => {
      const key = `${div.beltLevel} ${div.gender === 'M' ? 'Males' : 'Females'} ${
        div.eventType === 'patterns' ? 'Patterns' : 'Sparring'
      }`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(div);
      return acc;
    },
    {} as Record<string, Division[]>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            to={`/tournaments/${id}`}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Tournament
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Divisions - {tournament?.name}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {divisions?.length || 0} divisions total
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              if (
                divisions?.length &&
                !confirm(
                  'This will replace existing divisions. Continue?'
                )
              )
                return;
              autoGenerateMutation.mutate();
            }}
            disabled={autoGenerateMutation.isPending}
            className="btn btn-secondary"
          >
            <Wand2 className="h-4 w-4 mr-2" />
            {autoGenerateMutation.isPending
              ? 'Generating...'
              : 'Auto-Generate Divisions'}
          </button>
          <button
            onClick={() => generateAllBracketsMutation.mutate()}
            disabled={
              generateAllBracketsMutation.isPending || !divisions?.length
            }
            className="btn btn-primary"
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            {generateAllBracketsMutation.isPending
              ? 'Generating...'
              : 'Generate All Brackets'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="card-body">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="form-label">Belt Level</label>
              <select
                value={filter.beltLevel}
                onChange={(e) =>
                  setFilter({ ...filter, beltLevel: e.target.value })
                }
                className="form-input"
              >
                <option value="">All</option>
                <option value="BB">Black Belt</option>
                <option value="CB">Colored Belt</option>
              </select>
            </div>
            <div>
              <label className="form-label">Gender</label>
              <select
                value={filter.gender}
                onChange={(e) =>
                  setFilter({ ...filter, gender: e.target.value })
                }
                className="form-input"
              >
                <option value="">All</option>
                <option value="M">Males</option>
                <option value="F">Females</option>
              </select>
            </div>
            <div>
              <label className="form-label">Event</label>
              <select
                value={filter.eventType}
                onChange={(e) =>
                  setFilter({ ...filter, eventType: e.target.value })
                }
                className="form-input"
              >
                <option value="">All</option>
                <option value="patterns">Patterns</option>
                <option value="sparring">Sparring</option>
              </select>
            </div>
            {divisions?.length ? (
              <div className="ml-auto self-end">
                <button
                  onClick={() => {
                    if (confirm('Clear all divisions?')) {
                      clearDivisionsMutation.mutate();
                    }
                  }}
                  className="btn btn-secondary text-red-600"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Divisions */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : divisions && divisions.length > 0 ? (
        <div className="space-y-6">
          {Object.entries(groupedDivisions || {}).map(([category, divs]) => (
            <div key={category} className="card">
              <div className="card-header">
                <h3 className="font-semibold text-gray-900">{category}</h3>
                <span className="text-sm text-gray-500">
                  {divs.length} division{divs.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="divide-y divide-gray-200">
                {divs.map((div) => (
                  <div
                    key={div.id}
                    className="p-4 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex items-center">
                      <LayoutGrid className="h-5 w-5 text-gray-400 mr-3" />
                      <div>
                        <p className="font-medium text-gray-900">{div.name}</p>
                        <p className="text-sm text-gray-500">
                          {div.ageMin}-{div.ageMax} years
                          {div.weightClass && ` • ${div.weightClass}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center text-sm text-gray-500">
                        <Users className="h-4 w-4 mr-1" />
                        {div._count.assignments}
                      </div>
                      <span
                        className={`badge ${
                          div.bracket ? 'badge-green' : 'badge-gray'
                        }`}
                      >
                        {div.bracket ? 'Bracket Ready' : 'No Bracket'}
                      </span>
                      <Link
                        to={`/tournaments/${id}/divisions/${div.id}/bracket`}
                        className="text-primary-600 hover:text-primary-700 flex items-center"
                      >
                        View
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="card-body text-center py-12">
            <LayoutGrid className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">
              No divisions yet
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Auto-generate divisions based on tournament rules.
            </p>
            <button
              onClick={() => autoGenerateMutation.mutate()}
              disabled={autoGenerateMutation.isPending}
              className="mt-4 btn btn-primary"
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Auto-Generate Divisions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
