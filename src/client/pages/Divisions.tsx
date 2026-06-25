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
  UserPlus,
  Search,
  Undo2,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getSportProfile } from '../../shared/constants/sport-profiles';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { Modal } from '../components/ui';
import { Select } from '../components/ui';
import { StatTile } from '../components/ui';

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
  const [assignTarget, setAssignTarget] = useState<Division | null>(null);
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
      queryClient.invalidateQueries({ queryKey: ['director-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['scorekeeper-divisions'] });
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

  // Manual assignment UI for #50 — backend endpoints exist
  // (POST /api/divisions/:id/assign, DELETE /api/divisions/:id/assign/:id),
  // the page just never had a UI to call them. This is a minimal
  // picker: open the modal, search the global competitor list, check
  // boxes, save. Pre-existing assignments can be unassigned with the
  // trash button next to each row.
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<Set<string>>(new Set());

  // Full division (with assignments) — fetched fresh when modal opens
  const { data: assignDivision, isLoading: assignDivisionLoading, refetch: refetchAssignDivision } = useQuery<any>({
    queryKey: ['division', assignTarget?.id],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/${assignTarget?.id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch division');
      return res.json();
    },
    enabled: !!assignTarget,
  });

  // All tournament registrations (for the unassigned list)
  const { data: allRegistrations } = useQuery<any[]>({
    queryKey: ['tournament-registrations', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/registrations`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch registrations');
      return res.json();
    },
    enabled: !!assignTarget,
  });

  // Currently-assigned registration IDs for the open division
  const assignedRegistrationIds = useMemo(
    () => new Set((assignDivision?.assignments ?? []).map((a: any) => a.registrationId)),
    [assignDivision]
  );

  // Registrations that match the division's event type (so we don't
  // show a patterns-only competitor in a sparring-only division)
  const eligibleRegistrations = useMemo(() => {
    if (!allRegistrations || !assignTarget) return [];
    const eventType = assignTarget.eventType;
    return allRegistrations.filter((r: any) => r[eventType] === true);
  }, [allRegistrations, assignTarget]);

  // Eligible + unassigned + search filter
  const availableRegistrations = useMemo(() => {
    const q = assignmentSearch.trim().toLowerCase();
    return eligibleRegistrations
      .filter((r: any) => !assignedRegistrationIds.has(r.id))
      .filter((r: any) => {
        if (!q) return true;
        const c = r.competitor;
        return (
          c.firstName.toLowerCase().includes(q) ||
          c.lastName.toLowerCase().includes(q) ||
          (c.schoolDojang || '').toLowerCase().includes(q)
        );
      });
  }, [eligibleRegistrations, assignedRegistrationIds, assignmentSearch]);

  const assignCompetitorsMutation = useMutation({
    mutationFn: async (registrationIds: string[]) => {
      if (!assignTarget) return;
      const results = await Promise.all(
        registrationIds.map((regId) =>
          fetch(`/api/divisions/${assignTarget.id}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ registrationId: regId, manualOverride: true }),
          }).then((r) => {
            if (!r.ok) throw new Error(`Failed to assign ${regId}`);
            return r.json();
          })
        )
      );
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      refetchAssignDivision();
      setSelectedCompetitorIds(new Set());
      setResultMessage({
        title: 'Competitors Assigned',
        message: `Added ${results?.length ?? 0} competitor(s) to the division.`,
      });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      if (!assignTarget) return;
      const res = await fetch(`/api/divisions/${assignTarget.id}/assign/${assignmentId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to unassign');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      refetchAssignDivision();
    },
  });

  const closeAssignModal = () => {
    setAssignTarget(null);
    setSelectedCompetitorIds(new Set());
    setAssignmentSearch('');
  };

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

  const stats = {
    total: divisions?.length || 0,
    withBrackets: divisions?.filter((d) => d.bracket).length || 0,
    smallDivisions: divisions?.filter((d) => d._count.assignments < 3 && d._count.assignments > 0).length || 0,
    largeDivisions: divisions?.filter((d) => d._count.assignments > 8).length || 0,
    emptyDivisions: divisions?.filter((d) => d._count.assignments === 0).length || 0,
  };

  const groupedDivisions = filteredDivisions?.reduce(
    (acc, div) => {
      const key = `${div.beltLevel} ${div.gender === 'M' ? 'Males' : 'Females'} ${getEventLabel(div.eventType)}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(div);
      return acc;
    },
    {} as Record<string, Division[]>
  );

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
      <PageHeader
        title={`Divisions - ${tournament?.name || ''}`}
        description={`${divisions?.length || 0} divisions total`}
        actions={
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <Button
              variant="secondary"
              onClick={fetchPreview}
              disabled={previewLoading || autoGenerateMutation.isPending}
            >
              {previewLoading ? <Spinner size="sm" className="mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
              <span className="hidden sm:inline">{previewLoading ? 'Loading...' : 'Preview'}</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (divisions?.length) {
                  setRegenerateConfirm(true);
                } else {
                  autoGenerateMutation.mutate();
                }
              }}
              disabled={autoGenerateMutation.isPending}
            >
              {autoGenerateMutation.isPending ? <Spinner size="sm" className="mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
              <span className="hidden sm:inline">{autoGenerateMutation.isPending ? 'Generating...' : 'Auto-Generate'}</span>
            </Button>
            <Button
              data-tour="nav-scorekeeper"
              variant="secondary"
              onClick={() => generateAllBracketsMutation.mutate()}
              disabled={generateAllBracketsMutation.isPending || !divisions?.length}
            >
              {generateAllBracketsMutation.isPending ? <Spinner size="sm" className="mr-2" /> : <PlayCircle className="h-4 w-4 mr-2" />}
              <span className="hidden sm:inline">{generateAllBracketsMutation.isPending ? 'Generating...' : 'Brackets'}</span>
            </Button>
            <Button
              variant="primary"
              onClick={exportAllPDFs}
              disabled={exportingAll || !divisions?.some((d) => d.bracket)}
            >
              {exportingAll ? <Spinner size="sm" className="mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              <span className="hidden sm:inline">{exportingAll ? 'Exporting...' : 'Export PDFs'}</span>
            </Button>
          </div>
        }
      >
        <Link
          to={`/tournaments/${id}`}
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Tournament
        </Link>
      </PageHeader>

      {/* Filters */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label htmlFor="filter-belt">Belt Level</Label>
              <Select
                id="filter-belt"
                aria-label="Filter divisions by belt level"
                value={filter.beltLevel}
                onChange={(e) =>
                  setFilter({ ...filter, beltLevel: e.target.value })
                }
              >
                <option value="">All</option>
                <option value="BB">Black Belt</option>
                <option value="CB">Colored Belt</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="filter-gender">Gender</Label>
              <Select
                id="filter-gender"
                aria-label="Filter divisions by gender"
                value={filter.gender}
                onChange={(e) =>
                  setFilter({ ...filter, gender: e.target.value })
                }
              >
                <option value="">All</option>
                <option value="M">Males</option>
                <option value="F">Females</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="filter-event">Event</Label>
              <Select
                id="filter-event"
                aria-label="Filter divisions by event type"
                value={filter.eventType}
                onChange={(e) =>
                  setFilter({ ...filter, eventType: e.target.value })
                }
              >
                <option value="">All</option>
                {sportProfile.eventTypes.map((et, i) => (
                  <option key={et.id} value={i === 0 ? 'patterns' : 'sparring'}>{et.name}</option>
                ))}
              </Select>
            </div>
            {divisions?.length ? (
              <div className="ml-auto">
                <Button
                  variant="secondary"
                  onClick={() => setClearConfirm(true)}
                  className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </Button>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/* Backup / Restore — L4 from the UI audit. Closes the
          "no way to roll back" complaint. Backups are auto-created
          before every auto-generate + clear-all (see the server-side
          backup-recovery service). Director sees the last backup
          timestamp + a Restore button if a backup exists. */}
      <BackupRestoreCard tournamentId={id || ''} hasDivisions={!!divisions?.length} />

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
          <StatTile
            label="Total Divisions"
            value={stats.total}
            accent="default"
          />
          <StatTile
            label="With Brackets"
            value={stats.withBrackets}
            accent="success"
          />
          <StatTile
            label="Without Brackets"
            value={stats.total - stats.withBrackets}
            accent="default"
          />
          <StatTile
            label="Small (<3)"
            value={stats.smallDivisions}
            accent={stats.smallDivisions > 0 ? 'warning' : 'default'}
          />
          <StatTile
            label="Large (>8)"
            value={stats.largeDivisions}
            accent={stats.largeDivisions > 0 ? 'warning' : 'default'}
          />
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
            <Card key={category}>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">{category}</h3>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {divs.length} division{divs.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {divs.map((div) => (
                  <div
                    key={div.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <div className="flex items-center">
                      <LayoutGrid className="h-5 w-5 text-gray-600 dark:text-gray-500 mr-3 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{div.name}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
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
                      <button
                        onClick={() => setAssignTarget(div)}
                        className="text-gray-600 hover:text-primary-600 dark:hover:text-primary-400 touch-target"
                        title="Manage Competitors"
                        aria-label={`Manage competitors in ${div.name}`}
                      >
                        <UserPlus className="h-4 w-4" />
                      </button>
                      {div._count.assignments > 8 && (
                        <button
                          onClick={() => setSplitTarget(div)}
                          className="text-gray-600 hover:text-primary-600 dark:hover:text-primary-400 touch-target"
                          title="Split Division"
                        >
                          <Scissors className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteTarget(div)}
                        className="text-gray-600 hover:text-red-600 dark:hover:text-red-400 touch-target"
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
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardBody className="p-0">
            <EmptyState
              icon={LayoutGrid}
              title="No divisions yet"
              description="Auto-generate divisions based on tournament rules."
              action={{
                label: 'Auto-Generate Divisions',
                onClick: () => autoGenerateMutation.mutate(),
              }}
            />
          </CardBody>
        </Card>
      )}

      {/* preview Modal */}
      {showPreview && previewData && (
        <Modal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          title="Division Preview"
          subtitle={`${previewData.divisions.length} divisions • ${previewData.totalCompetitors} competitors`}
          size="full"
          panelClassName="max-h-[90vh]"
          noBodyPadding
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowPreview(false)} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={confirmGenerate}
                disabled={autoGenerateMutation.isPending}
                className="w-full sm:w-auto flex items-center justify-center"
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
              </Button>
            </>
          }
        >
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

          <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">{previewData.divisions.length}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Total Divisions</div>
            </div>
            <div>
              <div className="text-xl font-bold text-green-600 dark:text-green-400">
                {previewData.divisions.filter(d => d.competitorCount >= 3 && d.competitorCount <= 8).length}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Optimal Size (3-8)</div>
            </div>
            <div>
              <div className="text-xl font-bold text-yellow-600 dark:text-yellow-400">
                {previewData.divisions.filter(d => d.competitorCount > 0 && d.competitorCount < 3).length}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Small (&lt;3)</div>
            </div>
            <div>
              <div className="text-xl font-bold text-orange-600 dark:text-orange-400">
                {previewData.divisions.filter(d => d.competitorCount > 8).length}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Large (&gt;8)</div>
            </div>
          </div>

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
                        <span className="text-gray-600 dark:text-gray-500"> +{div.competitors.length - 5} more</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Modal>
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
        <Modal
          isOpen={!!resultMessage}
          onClose={() => setResultMessage(null)}
          title={resultMessage.title}
          footer={
            <Button variant="primary" onClick={() => setResultMessage(null)} className="w-full sm:w-auto">
              OK
            </Button>
          }
        >
          <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{resultMessage.message}</p>
        </Modal>
      )}

      {/* Manage Competitors modal — #50. Two columns: left = currently
          assigned (with unassign buttons), right = unassigned competitors
          filtered by event type + search (with checkboxes). Save commits
          the new assignments via POST /:id/assign. */}
      {assignTarget && (
        <Modal
          isOpen={!!assignTarget}
          onClose={closeAssignModal}
          title={`Manage Competitors — ${assignTarget.name}`}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={closeAssignModal} className="flex-1">
                Done
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                loading={assignCompetitorsMutation.isPending}
                disabled={selectedCompetitorIds.size === 0}
                onClick={() => assignCompetitorsMutation.mutate(Array.from(selectedCompetitorIds))}
              >
                Add {selectedCompetitorIds.size} Selected
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[400px]">
            {/* LEFT: currently assigned */}
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                In this division ({assignDivision?.assignments?.length ?? 0})
              </h3>
              {assignDivisionLoading ? (
                <CardSkeleton />
              ) : (assignDivision?.assignments ?? []).length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">No competitors assigned yet.</p>
              ) : (
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {assignDivision.assignments.map((a: any) => {
                    const c = a.registration?.competitor;
                    if (!c) return null;
                    return (
                      <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 px-2 hover:bg-gray-50 dark:hover:bg-gray-800/40 rounded">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {c.firstName} {c.lastName}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                            {c.belt}{c.schoolDojang && ` · ${c.schoolDojang}`}
                          </p>
                        </div>
                        <button
                          onClick={() => unassignMutation.mutate(a.id)}
                          disabled={unassignMutation.isPending}
                          className="text-gray-600 hover:text-red-600 dark:hover:text-red-400 p-1"
                          title="Remove from division"
                          aria-label={`Remove ${c.firstName} ${c.lastName}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RIGHT: available to add */}
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                Available ({availableRegistrations.length})
              </h3>
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-600" />
                <Input
                  type="text"
                  value={assignmentSearch}
                  onChange={(e) => setAssignmentSearch(e.target.value)}
                  placeholder="Search name or school..."
                  inputClassName="pl-8 py-1.5 text-sm"
                />
              </div>
              {availableRegistrations.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {assignmentSearch ? 'No matches.' : 'All eligible competitors already assigned.'}
                </p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {availableRegistrations.map((r: any) => {
                    const c = r.competitor;
                    const checked = selectedCompetitorIds.has(r.id);
                    return (
                      <label
                        key={r.id}
                        className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 dark:hover:bg-gray-800/40 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(selectedCompetitorIds);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            setSelectedCompetitorIds(next);
                          }}
                          className="h-4 w-4"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {c.firstName} {c.lastName}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                            {c.belt}{c.schoolDojang && ` · ${c.schoolDojang}`}
                            {c.weightLbs != null && ` · ${c.weightLbs} lbs`}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// BackupRestoreCard — shows the last auto-backup timestamp (if any) and
// exposes a Restore button. Closes L4 from the UI audit. Backups are
// created automatically before destructive operations (auto-generate,
// clear-all) by the server-side backup-recovery service. The restore
// endpoint will reject if the backup structure no longer matches the
// current schema.
function BackupRestoreCard({ tournamentId, hasDivisions }: { tournamentId: string; hasDivisions: boolean }) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const { data: backup, isLoading } = useQuery<{
    tournamentId: string;
    timestamp: string;
    divisionCount: number;
  } | null>({
    queryKey: ['tournament-backup', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${tournamentId}/backup`, {
        headers: getAuthHeaders(),
      });
      if (res.status === 404) return null; // no backup yet
      if (!res.ok) throw new Error('Failed to load backup info');
      return res.json();
    },
    enabled: !!tournamentId,
    retry: false,
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${tournamentId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Restore failed');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions'] });
      queryClient.invalidateQueries({ queryKey: ['tournament-backup', tournamentId] });
      addToast?.('Divisions restored from backup.', 'success');
    },
    onError: (err: Error) => addToast?.(err.message, 'error'),
  });

  return (
    <Card className="mb-6">
      <CardBody>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Undo2 className="h-5 w-5 text-slate-600 dark:text-slate-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Backup &amp; Restore</h3>
              {isLoading ? (
                <p className="text-xs text-gray-600 dark:text-gray-400">Loading backup info…</p>
              ) : backup ? (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Last backup: <span className="font-medium text-gray-900 dark:text-white">{new Date(backup.timestamp).toLocaleString()}</span> · {backup.divisionCount} division{backup.divisionCount === 1 ? '' : 's'}
                </p>
              ) : (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  No backup yet. A backup is created automatically before auto-generating or clearing divisions.
                </p>
              )}
            </div>
          </div>
          {backup && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (hasDivisions && !confirm('Restoring will REPLACE all current divisions with the backup. Continue?')) return;
                restoreMutation.mutate();
              }}
              loading={restoreMutation.isPending}
              disabled={restoreMutation.isPending}
              aria-label="Restore divisions from last backup"
            >
              <Undo2 className="h-4 w-4 mr-1" />
              Restore from backup
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
