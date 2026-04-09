import { useState, useMemo } from 'react';
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
  Scissors,
  Download,
  AlertTriangle,
  Eye,
  Check,
  X,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getSportProfile } from '../../shared/constants/sport-profiles';

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
  sportProfileSlug: string | null;
}

interface PreviewDivision {
  name: string;
  beltLevel: string;
  gender: string;
  eventType: string;
  ageMin: number;
  ageMax: number;
  weightClass: string | null;
  competitorCount: number;
  competitors: { name: string; school: string }[];
}

interface PreviewResult {
  divisions: PreviewDivision[];
  totalCompetitors: number;
  warnings: string[];
}

export default function Divisions() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState({
    beltLevel: '',
    gender: '',
    eventType: '',
  });
  const [exportingAll, setExportingAll] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Division | null>(null);
  const [splitTarget, setSplitTarget] = useState<Division | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [regenerateConfirm, setRegenerateConfirm] = useState(false);
  const [resultMessage, setResultMessage] = useState<{ title: string; message: string } | null>(null);
  const { addToast } = useToast();

  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['tournament', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournament');
      return res.json();
    },
  });

  const sportProfile = useMemo(() => {
    const slug = tournament?.sportProfileSlug || 'taekwondo';
    return getSportProfile(slug) ?? getSportProfile('taekwondo')!;
  }, [tournament]);

  const getEventLabel = (eventType: string) => {
    // Map internal event keys (patterns/sparring) to sport-specific names
    const idx = eventType === 'patterns' ? 0 : 1;
    return sportProfile.eventTypes[idx]?.name ?? eventType;
  };

  const { data: divisions, isLoading } = useQuery<Division[]>({
    queryKey: ['divisions', id],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch divisions');
      return res.json();
    },
  });

  const autoGenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${id}/auto-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ config: { divisionThreshold: 8 } }),
      });
      if (!res.ok) throw new Error('Failed to auto-generate divisions');
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setResultMessage({
        title: 'Auto-generation Complete',
        message: `Created ${result.divisions} divisions with ${result.assignments} assignments.${
          result.warnings?.length ? `\n\nWarnings:\n${result.warnings.join('\n')}` : ''
        }`,
      });
    },
  });

  const generateAllBracketsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/brackets/tournament/${id}/generate-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ seedingStrategy: 'school_spread' }),
      });
      if (!res.ok) throw new Error('Failed to generate brackets');
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      setResultMessage({
        title: 'Brackets Generated',
        message: `Generated ${result.generated} brackets (${result.skipped} skipped)`,
      });
    },
  });

  const clearDivisionsMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/divisions/tournament/${id}/all`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setClearConfirm(false);
    },
  });

  const deleteDivisionMutation = useMutation({
    mutationFn: async (divisionId: string) => {
      await fetch(`/api/divisions/${divisionId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setDeleteTarget(null);
    },
  });

  const splitDivisionMutation = useMutation({
    mutationFn: async (divisionId: string) => {
      const res = await fetch(`/api/divisions/${divisionId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ splitCount: 2 }),
      });
      if (!res.ok) throw new Error('Failed to split division');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      setSplitTarget(null);
      setResultMessage({
        title: 'Division Split',
        message: 'Division has been split into 2 parts.',
      });
    },
  });

  // Preview divisions before generating
  const fetchPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/divisions/tournament/${id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ config: { divisionThreshold: 8 } }),
      });
      const data = await res.json();
      setPreviewData(data);
      setShowPreview(true);
    } catch (error) {
      console.error('Preview error:', error);
      addToast('Failed to generate preview', 'error');
    }
    setPreviewLoading(false);
  };

  const confirmGenerate = () => {
    setShowPreview(false);
    autoGenerateMutation.mutate();
  };

  const filteredDivisions = divisions?.filter((d) => {
    if (filter.beltLevel && d.beltLevel !== filter.beltLevel) return false;
    if (filter.gender && d.gender !== filter.gender) return false;
    if (filter.eventType && d.eventType !== filter.eventType) return false;
    return true;
  });

  // Calculate stats
  const stats = {
    total: divisions?.length || 0,
    withBrackets: divisions?.filter((d) => d.bracket).length || 0,
    smallDivisions: divisions?.filter((d) => d._count.assignments < 3 && d._count.assignments > 0).length || 0,
    largeDivisions: divisions?.filter((d) => d._count.assignments > 8).length || 0,
    emptyDivisions: divisions?.filter((d) => d._count.assignments === 0).length || 0,
  };

  // Group divisions by category
  const groupedDivisions = filteredDivisions?.reduce(
    (acc, div) => {
      const key = `${div.beltLevel} ${div.gender === 'M' ? 'Males' : 'Females'} ${getEventLabel(div.eventType)}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(div);
      return acc;
    },
    {} as Record<string, Division[]>
  );

  // Export all brackets as PDFs using the server endpoint
  const exportAllPDFs = async () => {
    if (!divisions || divisions.length === 0) return;

    setExportingAll(true);

    try {
      const divisionsWithBrackets = divisions.filter((d) => d.bracket);

      if (divisionsWithBrackets.length === 0) {
        addToast('No brackets to export. Generate brackets first.', 'warning');
        setExportingAll(false);
        return;
      }

      // Use the server-side batch PDF endpoint
      const res = await fetch(`/api/brackets/tournament/${id}/pdf`);
      if (!res.ok) {
        throw new Error('Failed to generate PDF');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tournament?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Tournament'}_All_Brackets.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
      addToast('Error exporting PDFs. Please try again.', 'error');
    }

    setExportingAll(false);
  };

  return (
    <div>
      {/* Page Header */}
      <div className="page-header mb-6">
        <div>
          <Link
            to={`/tournaments/${id}`}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Tournament
          </Link>
          <h1 className="page-title">
            Divisions - {tournament?.name}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {divisions?.length || 0} divisions total
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <button
            onClick={fetchPreview}
            disabled={previewLoading || autoGenerateMutation.isPending}
            className="btn btn-secondary"
          >
            {previewLoading ? <Spinner size="sm" className="mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
            <span className="hidden sm:inline">{previewLoading ? 'Loading...' : 'Preview'}</span>
          </button>
          <button
            onClick={() => {
              if (divisions?.length) {
                setRegenerateConfirm(true);
              } else {
                autoGenerateMutation.mutate();
              }
            }}
            disabled={autoGenerateMutation.isPending}
            className="btn btn-secondary"
          >
            {autoGenerateMutation.isPending ? <Spinner size="sm" className="mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
            <span className="hidden sm:inline">{autoGenerateMutation.isPending ? 'Generating...' : 'Auto-Generate'}</span>
          </button>
          <button
            onClick={() => generateAllBracketsMutation.mutate()}
            disabled={generateAllBracketsMutation.isPending || !divisions?.length}
            className="btn btn-secondary"
          >
            {generateAllBracketsMutation.isPending ? <Spinner size="sm" className="mr-2" /> : <PlayCircle className="h-4 w-4 mr-2" />}
            <span className="hidden sm:inline">{generateAllBracketsMutation.isPending ? 'Generating...' : 'Brackets'}</span>
          </button>
          <button
            onClick={exportAllPDFs}
            disabled={exportingAll || !divisions?.some((d) => d.bracket)}
            className="btn btn-primary"
          >
            {exportingAll ? <Spinner size="sm" className="mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            <span className="hidden sm:inline">{exportingAll ? 'Exporting...' : 'Export PDFs'}</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="card-body">
          <div className="flex flex-wrap gap-4 items-end">
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
                {sportProfile.eventTypes.map((et, i) => (
                  <option key={et.id} value={i === 0 ? 'patterns' : 'sparring'}>{et.name}</option>
                ))}
              </select>
            </div>
            {divisions?.length ? (
              <div className="ml-auto">
                <button
                  onClick={() => setClearConfirm(true)}
                  className="btn btn-secondary text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Warnings */}
      {(stats.smallDivisions > 0 || stats.largeDivisions > 0 || stats.emptyDivisions > 0) && (
        <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex items-start">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-3 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-yellow-800 dark:text-yellow-200">Division Warnings</h3>
              <ul className="mt-1 text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside">
                {stats.emptyDivisions > 0 && (
                  <li>{stats.emptyDivisions} division(s) with no competitors</li>
                )}
                {stats.smallDivisions > 0 && (
                  <li>{stats.smallDivisions} division(s) with fewer than 3 competitors (consider merging)</li>
                )}
                {stats.largeDivisions > 0 && (
                  <li>{stats.largeDivisions} division(s) with more than 8 competitors (consider splitting)</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Stats Summary */}
      {divisions && divisions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Total Divisions</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.withBrackets}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">With Brackets</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-gray-400 dark:text-gray-500">{stats.total - stats.withBrackets}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Without Brackets</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center">
            <div className={`text-2xl font-bold ${stats.smallDivisions > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-400 dark:text-gray-500'}`}>
              {stats.smallDivisions}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Small (&lt;3)</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center">
            <div className={`text-2xl font-bold ${stats.largeDivisions > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`}>
              {stats.largeDivisions}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Large (&gt;8)</div>
          </div>
        </div>
      )}

      {/* Divisions */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : divisions && divisions.length > 0 ? (
        <div className="space-y-6">
          {Object.entries(groupedDivisions || {}).map(([category, divs]) => (
            <div key={category} className="card">
              <div className="card-header flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">{category}</h3>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {divs.length} division{divs.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {divs.map((div) => (
                  <div
                    key={div.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <div className="flex items-center">
                      <LayoutGrid className="h-5 w-5 text-gray-400 dark:text-gray-500 mr-3 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{div.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {div.ageMin}-{div.ageMax} years
                          {div.weightClass && ` • ${div.weightClass}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
                      <div className={`flex items-center text-sm ${
                        div._count.assignments === 0 ? 'text-red-500 dark:text-red-400' :
                        div._count.assignments < 3 ? 'text-yellow-600 dark:text-yellow-400' :
                        div._count.assignments > 8 ? 'text-orange-600 dark:text-orange-400' :
                        'text-gray-500 dark:text-gray-400'
                      }`}>
                        <Users className="h-4 w-4 mr-1" />
                        {div._count.assignments}
                      </div>
                      {div._count.assignments === 0 && (
                        <span className="badge bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300">Empty</span>
                      )}
                      {div._count.assignments > 0 && div._count.assignments < 3 && (
                        <span className="badge bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">Small</span>
                      )}
                      {div._count.assignments > 8 && (
                        <span className="badge bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300">Large</span>
                      )}
                      <span
                        className={`badge ${
                          div.bracket ? 'badge-green' : 'badge-gray'
                        }`}
                      >
                        {div.bracket ? 'Ready' : 'No Bracket'}
                      </span>
                      {div._count.assignments > 8 && (
                        <button
                          onClick={() => setSplitTarget(div)}
                          className="text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 touch-target"
                          title="Split Division"
                        >
                          <Scissors className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteTarget(div)}
                        className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 touch-target"
                        title="Delete Division"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <Link
                        to={`/tournaments/${id}/divisions/${div.id}/bracket`}
                        className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 flex items-center touch-target"
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
          <EmptyState
            icon={LayoutGrid}
            title="No divisions yet"
            description="Auto-generate divisions based on tournament rules."
            action={{
              label: 'Auto-Generate Divisions',
              onClick: () => autoGenerateMutation.mutate(),
            }}
          />
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && previewData && (
        <div className="modal-container flex items-center justify-center p-4">
          <div className="modal-backdrop" onClick={() => setShowPreview(false)} />
          <div className="modal-panel max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Division Preview</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {previewData.divisions.length} divisions • {previewData.totalCompetitors} competitors
                </p>
              </div>
              <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 touch-target">
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Preview Warnings */}
            {previewData.warnings.length > 0 && (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800">
                <div className="flex items-start">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-2 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-yellow-800 dark:text-yellow-200">Warnings:</p>
                    <ul className="text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside">
                      {previewData.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Preview Stats */}
            <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-xl font-bold text-gray-900 dark:text-white">{previewData.divisions.length}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Total Divisions</div>
              </div>
              <div>
                <div className="text-xl font-bold text-green-600 dark:text-green-400">
                  {previewData.divisions.filter(d => d.competitorCount >= 3 && d.competitorCount <= 8).length}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Optimal Size (3-8)</div>
              </div>
              <div>
                <div className="text-xl font-bold text-yellow-600 dark:text-yellow-400">
                  {previewData.divisions.filter(d => d.competitorCount > 0 && d.competitorCount < 3).length}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Small (&lt;3)</div>
              </div>
              <div>
                <div className="text-xl font-bold text-orange-600 dark:text-orange-400">
                  {previewData.divisions.filter(d => d.competitorCount > 8).length}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Large (&gt;8)</div>
              </div>
            </div>

            {/* Division List */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                {previewData.divisions.map((div, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border ${
                      div.competitorCount === 0 ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' :
                      div.competitorCount < 3 ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20' :
                      div.competitorCount > 8 ? 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20' :
                      'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-gray-900 dark:text-white">{div.name}</h4>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${
                          div.competitorCount === 0 ? 'text-red-600 dark:text-red-400' :
                          div.competitorCount < 3 ? 'text-yellow-600 dark:text-yellow-400' :
                          div.competitorCount > 8 ? 'text-orange-600 dark:text-orange-400' :
                          'text-green-600 dark:text-green-400'
                        }`}>
                          {div.competitorCount} competitors
                        </span>
                        {div.competitorCount === 0 && (
                          <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 px-2 py-0.5 rounded">Empty</span>
                        )}
                        {div.competitorCount > 0 && div.competitorCount < 3 && (
                          <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 px-2 py-0.5 rounded">Needs merge</span>
                        )}
                        {div.competitorCount > 8 && (
                          <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 px-2 py-0.5 rounded">Will be split</span>
                        )}
                      </div>
                    </div>
                    {div.competitors.length > 0 && (
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {div.competitors.slice(0, 5).map((c, i) => (
                          <span key={i}>
                            {c.name}{c.school && ` (${c.school})`}
                            {i < Math.min(div.competitors.length - 1, 4) && ', '}
                          </span>
                        ))}
                        {div.competitors.length > 5 && (
                          <span className="text-gray-400 dark:text-gray-500"> +{div.competitors.length - 5} more</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="modal-footer">
              <button onClick={() => setShowPreview(false)} className="btn btn-secondary w-full sm:w-auto">
                Cancel
              </button>
              <button
                onClick={confirmGenerate}
                disabled={autoGenerateMutation.isPending}
                className="btn btn-primary w-full sm:w-auto flex items-center justify-center"
              >
                {autoGenerateMutation.isPending ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Confirm & Generate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Division Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteDivisionMutation.mutate(deleteTarget.id)}
        title="Delete Division"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This will remove all competitor assignments in this division.`}
        confirmText="Delete Division"
        isLoading={deleteDivisionMutation.isPending}
      />

      {/* Split Division Confirmation */}
      <ConfirmDialog
        isOpen={!!splitTarget}
        onClose={() => setSplitTarget(null)}
        onConfirm={() => splitTarget && splitDivisionMutation.mutate(splitTarget.id)}
        title="Split Division"
        message={`Split "${splitTarget?.name}" into 2 divisions? Competitors will be distributed evenly.`}
        confirmText="Split Division"
        variant="warning"
        isLoading={splitDivisionMutation.isPending}
      />

      {/* Clear All Confirmation */}
      <ConfirmDialog
        isOpen={clearConfirm}
        onClose={() => setClearConfirm(false)}
        onConfirm={() => clearDivisionsMutation.mutate()}
        title="Clear All Divisions"
        message="Are you sure you want to delete all divisions? This will remove all competitor assignments and brackets. This action cannot be undone."
        confirmText="Clear All"
        isLoading={clearDivisionsMutation.isPending}
      />

      {/* Regenerate Confirmation */}
      <ConfirmDialog
        isOpen={regenerateConfirm}
        onClose={() => setRegenerateConfirm(false)}
        onConfirm={() => {
          setRegenerateConfirm(false);
          autoGenerateMutation.mutate();
        }}
        title="Regenerate Divisions"
        message="This will replace all existing divisions. Any existing brackets will be deleted. Continue?"
        confirmText="Regenerate"
        variant="warning"
        isLoading={autoGenerateMutation.isPending}
      />

      {/* Result Message Modal */}
      {resultMessage && (
        <div className="modal-container flex items-center justify-center p-4">
          <div className="modal-backdrop" onClick={() => setResultMessage(null)} />
          <div className="modal-panel max-w-md">
            <div className="modal-header">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{resultMessage.title}</h2>
              <button onClick={() => setResultMessage(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{resultMessage.message}</p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setResultMessage(null)} className="btn btn-primary w-full">
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
