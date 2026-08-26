import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Upload,
  Download,
  Search,
  Edit,
  Trash2,
  X,
  FileSpreadsheet,
  Users,
  Filter,
  MoreHorizontal,
} from 'lucide-react';
import { TableSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { DataTable, TableHead, TableBody, TableRow, TableCell, IconButton } from '../components/ui';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { Modal } from '../components/ui';
import { Select } from '../components/ui';
import { Toolbar } from '../components/ui';
import { Badge } from '../components/ui';
import { isTestData } from '../utils/test-data';
import OperationStatus, { type OperationState } from '../components/ui/OperationStatus';
import { collectAdminPages, readAdminOperationError } from '../utils/admin-operation-error';

interface Competitor {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  belt: string;
  danRank: number | null;
  heightInches: number | null;
  weightLbs: number | null;
  schoolDojang: string | null;
  specialNeeds: string | null;
}

interface ImportMapping {
  firstName: string;
  lastName: string;
  gender: string;
  age?: string;
  dateOfBirth?: string;
  belt: string;
  danRank?: string;
  height?: string;
  weight: string;
  school?: string;
  patterns?: string;
  sparring?: string;
  specialNeeds?: string;
}

const BELT_OPTIONS = [
  'White',
  'White / Single Yellow Stripe',
  'White / Double Yellow Stripe',
  'Yellow',
  'Yellow / Single Green Stripe',
  'Yellow / Double Green Stripe',
  'Green',
  'Green / Single Blue Stripe',
  'Green / Double Blue Stripe',
  'Blue',
  'Blue / Single Red Stripe',
  'Blue / Double Red Stripe',
  'Red',
  'Red / Single Black Stripe',
  'Red / Double Black Stripe',
  'Brown',
  'Brown / Single Black Stripe',
  'Brown / Double Black Stripe',
  'Black',
];

const emptyForm = {
  firstName: '',
  lastName: '',
  gender: 'M',
  dateOfBirth: '',
  belt: 'White',
  danRank: '',
  heightInches: '',
  weightLbs: '',
  schoolDojang: '',
  specialNeeds: '',
};

export default function Competitors() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [search, setSearch] = useState('');
  const [beltFilter, setBeltFilter] = useState<string[]>([]);
  const [genderFilter, setGenderFilter] = useState<string>('');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'pending' | 'resolved' | 'rejected'>('idle');
  const [exportMessage, setExportMessage] = useState('');
  const [importPreparing, setImportPreparing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [adminNotice, setAdminNotice] = useState<{
    state: OperationState;
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Competitor | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [pageLimit, setPageLimit] = useState(100);
  // The import preview is a spreadsheet row — `unknown` keyed by
  // column header. We never index individual cells with strict types,
  // just stringify them for display.
  const [importData, setImportData] = useState<Record<string, unknown>[] | null>(null);
  const [importColumns, setImportColumns] = useState<string[]>([]);
  // Original File handle for the parsed workbook. Kept around so
  // the import step can re-encode it as base64 and send the raw
  // file to the server (closes P8 — single source of truth for
  // the xlsx parser on the server side). If null, the import
  // falls back to the pre-parsed JSON path (kept for back-compat
  // — old imports that uploaded a file then had the page reload
  // before the file was held in state).
  const [importFile, setImportFile] = useState<File | null>(null);
  const [columnMapping, setColumnMapping] = useState<ImportMapping>({
    firstName: '',
    lastName: '',
    gender: '',
    belt: '',
    weight: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importPreparingRef = useRef(false);

  // Reset form when modal opens/closes or editing changes
  useEffect(() => {
    if (editingCompetitor) {
      setFormData({
        firstName: editingCompetitor.firstName,
        lastName: editingCompetitor.lastName,
        gender: editingCompetitor.gender,
        dateOfBirth: editingCompetitor.dateOfBirth
          ? new Date(editingCompetitor.dateOfBirth).toISOString().split('T')[0]
          : '',
        belt: editingCompetitor.belt,
        danRank: editingCompetitor.danRank?.toString() || '',
        heightInches: editingCompetitor.heightInches?.toString() || '',
        weightLbs: editingCompetitor.weightLbs?.toString() || '',
        schoolDojang: editingCompetitor.schoolDojang || '',
        specialNeeds: editingCompetitor.specialNeeds || '',
      });
      setShowFormModal(true);
    }
  }, [editingCompetitor]);

  const { data, isLoading } = useQuery({
    queryKey: ['competitors', search, beltFilter.join(','), genderFilter, ageMin, ageMax, schoolFilter, pageLimit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (beltFilter.length) params.set('belt', beltFilter.join(','));
      if (genderFilter) params.set('gender', genderFilter);
      if (ageMin) params.set('age_min', ageMin);
      if (ageMax) params.set('age_max', ageMax);
      if (schoolFilter) params.set('school', schoolFilter);
      params.set('limit', String(pageLimit));
      const res = await fetch(`/api/competitors?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch competitors');
      return res.json();
    },
  });

  // Faceted aggregates for the sidebar — refreshed every 60s
  const { data: aggregates } = useQuery({
    queryKey: ['competitors-aggregates'],
    queryFn: async () => {
      const res = await fetch('/api/competitors/meta/aggregates', { headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch('/api/competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          ...data,
          danRank: data.danRank ? parseInt(data.danRank) : null,
          heightInches: data.heightInches ? parseFloat(data.heightInches) : null,
          weightLbs: data.weightLbs ? parseFloat(data.weightLbs) : null,
        }),
      });
      if (!res.ok) throw new Error(await readAdminOperationError(res, 'Failed to create competitor'));
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['competitors'] });
      closeFormModal();
      addToast('Competitor created', 'success');
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Failed to create competitor'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const res = await fetch(`/api/competitors/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          ...data,
          danRank: data.danRank ? parseInt(data.danRank) : null,
          heightInches: data.heightInches ? parseFloat(data.heightInches) : null,
          weightLbs: data.weightLbs ? parseFloat(data.weightLbs) : null,
        }),
      });
      if (!res.ok) throw new Error(await readAdminOperationError(res, 'Failed to update competitor'));
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['competitors'] });
      closeFormModal();
      addToast('Competitor updated', 'success');
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Failed to update competitor'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/competitors/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) {
        throw new Error(await readAdminOperationError(res, 'Failed to delete competitor'));
      }
    },
    onMutate: () => {
      setDeleteError(null);
      setAdminNotice({ state: 'pending', message: 'Removing competitor from active lists.' });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['competitors'] });
      setDeleteError(null);
      setDeleteTarget(null);
      setAdminNotice({ state: 'resolved', message: 'Competitor sent to Trash and the list is up to date.' });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete competitor';
      setDeleteError(message);
      setAdminNotice(null);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results: { ok: string[]; failed: string[] } = { ok: [], failed: [] };
      for (const id of ids) {
        try {
          const r = await fetch(`/api/competitors/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
          if (r.ok) results.ok.push(id);
          else results.failed.push(id);
        } catch {
          results.failed.push(id);
        }
      }
      return results;
    },
    onMutate: (ids) => setAdminNotice({
      state: 'pending',
      message: `Removing ${ids.length} competitor${ids.length === 1 ? '' : 's'}.`,
    }),
    onSuccess: async (results) => {
      await queryClient.invalidateQueries({ queryKey: ['competitors'] });
      setSelectedIds(new Set(results.failed));
      setBulkDeleteOpen(false);
      if (results.failed.length === 0) {
        setAdminNotice({
          state: 'resolved',
          message: `${results.ok.length} competitor${results.ok.length === 1 ? '' : 's'} sent to Trash and the list is up to date.`,
        });
      } else {
        setAdminNotice({
          state: 'rejected',
          message: `${results.ok.length} removed; ${results.failed.length} still need attention and remain selected.`,
          actionLabel: 'Retry failed',
          onAction: () => bulkDeleteMutation.mutate(results.failed),
        });
      }
    },
  });

  const filteredCompetitors = data?.competitors;

  const importMutation = useMutation({
    mutationFn: async (
      payload:
        | { data: Record<string, unknown>[]; mapping: ImportMapping }
        | { fileBase64: string; fileName?: string; mapping: ImportMapping }
    ) => {
      // Two request shapes — server accepts either (the
      // server-side xlsx parser is preferred per P8, but the
      // JSON path is kept for back-compat with old imports).
      const body = 'fileBase64' in payload
        ? { fileBase64: payload.fileBase64, fileName: payload.fileName, columnMapping: payload.mapping }
        : { data: payload.data, columnMapping: payload.mapping };
      const res = await fetch('/api/competitors/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readAdminOperationError(res, 'Failed to import competitors'));
      return res.json();
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['competitors'] });
      addToast(
        `Import complete! Imported: ${result.imported}, Updated: ${result.updated}, Skipped: ${result.skipped}`,
        'success'
      );
      setShowImportModal(false);
      setImportData(null);
      setImportFile(null);
      setImportError(null);
    },
    onError: (error) => setImportError(error instanceof Error ? error.message : 'Failed to import competitors'),
  });

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingCompetitor(null);
    setFormData(emptyForm);
    setFormError(null);
  };

  const [formError, setFormError] = useState<string | null>(null);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (editingCompetitor) {
      updateMutation.mutate({ id: editingCompetitor.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);

    // Hold onto the original File so the import step can
    // re-encode it as base64 and send the raw bytes to the
    // server (P8). The local parse below is still used for
    // the auto-mapping preview — the user gets the column
    // suggestion without waiting for a second round-trip.
    setImportFile(file);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
      // xlsx is dynamically imported so its chunk only downloads when a
      // file is actually selected for import preview.
      const XLSX = await import('xlsx');
      const data = new Uint8Array(event.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });

      const sheetName =
        workbook.SheetNames.find((n) =>
          n.toLowerCase().includes('competitor')
        ) || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (jsonData.length > 0) {
        const columns = Object.keys(jsonData[0] as object);
        setImportColumns(columns);
        setImportData(jsonData as Record<string, unknown>[]);

        const autoMapping: ImportMapping = {
          firstName: '',
          lastName: '',
          gender: '',
          belt: '',
          weight: '',
        };

        for (const col of columns) {
          const lower = col.toLowerCase();
          if (lower.includes('first') && lower.includes('name'))
            autoMapping.firstName = col;
          else if (lower.includes('last') && lower.includes('name'))
            autoMapping.lastName = col;
          else if (lower === 'name' && !autoMapping.firstName) {
            autoMapping.firstName = col;
          } else if (lower.includes('gender') || lower === 'sex')
            autoMapping.gender = col;
          else if (lower.includes('dob') || lower.includes('birth'))
            autoMapping.dateOfBirth = col;
          else if (lower === 'age') autoMapping.age = col;
          else if (lower.includes('belt') && !lower.includes('dan'))
            autoMapping.belt = col;
          else if (lower.includes('dan')) autoMapping.danRank = col;
          else if (lower.includes('height')) autoMapping.height = col;
          else if (lower.includes('weight')) autoMapping.weight = col;
          else if (lower.includes('school') || lower.includes('dojang'))
            autoMapping.school = col;
          else if (lower.includes('pattern')) autoMapping.patterns = col;
          else if (lower.includes('sparr')) autoMapping.sparring = col;
          else if (lower.includes('special')) autoMapping.specialNeeds = col;
        }

        setColumnMapping(autoMapping);
        setShowImportModal(true);
      } else {
        addToast('The spreadsheet does not contain any competitor rows.', 'error');
      }
      } catch {
        addToast('The spreadsheet could not be read. Check the file and try again.', 'error');
      }
    };
    reader.onerror = () => addToast('The spreadsheet could not be read. Check the file and try again.', 'error');
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (!importData || importPreparingRef.current || importMutation.isPending) return;
    importPreparingRef.current = true;
    setImportPreparing(true);
    setImportError(null);
    // Closes P8: prefer the server-side xlsx parser when we still
    // have the original File handle. The client re-encodes to
    // base64 here, the server reads it with XLSX.read and runs
    // the same importFromExcel pipeline. If the File handle is
    // gone (e.g. user reloaded the page after uploading), fall
    // back to the pre-parsed JSON path — slower but still works.
    try {
    if (importFile) {
      const fileBase64: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const result = r.result as string;
          // result is `data:<mime>;base64,<payload>` — strip the
          // prefix so the server gets raw base64.
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        r.onerror = reject;
        r.readAsDataURL(importFile);
      });
      importMutation.mutate(
        { fileBase64, fileName: importFile.name, mapping: columnMapping },
        { onSettled: () => {
          importPreparingRef.current = false;
          setImportPreparing(false);
        } },
      );
    } else {
      importMutation.mutate(
        { data: importData, mapping: columnMapping },
        { onSettled: () => {
          importPreparingRef.current = false;
          setImportPreparing(false);
        } },
      );
    }
    } catch {
      importPreparingRef.current = false;
      setImportPreparing(false);
      setImportError('The spreadsheet could not be prepared for import. Please try again.');
    }
  };

  const handleDownloadTemplate = () => {
    window.location.href = '/api/competitors/template';
  };

  const handleExportExcel = async () => {
    if (exportState === 'pending') return;
    setExportState('pending');
    setExportMessage('Preparing the complete competitor workbook.');
    try {
    // Page through the API (server caps limit at 1000) so large
    // registries aren't silently truncated.
    const pageSize = 1000;
    const all = await collectAdminPages<Competitor>(async (offset) => {
      const res = await fetch(
        `/api/competitors?limit=${pageSize}&offset=${offset}`,
        { headers: getAuthHeaders() },
      );
      if (!res.ok) throw new Error(await readAdminOperationError(res, 'Failed to export competitors'));
      const result = await res.json();
      return { items: result.competitors, total: result.total };
    });

    const wsData = [
      ['First Name', 'Last Name', 'Gender', 'Date of Birth', 'Belt', 'Dan Rank', 'Height (in)', 'Weight (lbs)', 'School/Dojang', 'Special Needs'],
      ...all.map((c) => [
        c.firstName,
        c.lastName,
        c.gender,
        c.dateOfBirth ? new Date(c.dateOfBirth).toLocaleDateString() : '',
        c.belt,
        c.danRank ?? '',
        c.heightInches ?? '',
        c.weightLbs ?? '',
        c.schoolDojang ?? '',
        c.specialNeeds ?? '',
      ]),
    ];

    // Dynamic import: the ~490KB xlsx chunk downloads only on export.
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Competitors');
    XLSX.writeFile(wb, `Competitors_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExportState('resolved');
    setExportMessage(`${all.length} competitor${all.length === 1 ? '' : 's'} exported.`);
    } catch (error) {
      setExportState('rejected');
      setExportMessage(error instanceof Error ? error.message : 'Failed to export competitors');
    }
  };

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

  const calculateAge = (dateOfBirth: string) => {
    if (!dateOfBirth) return '-';
    return Math.floor(
      (Date.now() - new Date(dateOfBirth).getTime()) /
        (365.25 * 24 * 60 * 60 * 1000)
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Competitors"
        count={filteredCompetitors?.length ?? data?.competitors?.length ?? 0}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" /> Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button variant="primary" size="sm" onClick={() => { setEditingCompetitor(null); setFormData(emptyForm); setShowFormModal(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Add
            </Button>
            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                aria-label="More actions"
                aria-expanded={moreMenuOpen}
                className="px-2"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
              {moreMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMoreMenuOpen(false)} />
                  <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-20">
                    <button
                      onClick={() => { void handleExportExcel(); setMoreMenuOpen(false); }}
                      disabled={exportState === 'pending'}
                      className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
                    >
                      <FileSpreadsheet className="h-4 w-4" /> {exportState === 'pending' ? 'Exportingâ€¦' : 'Export'}
                    </button>
                    <button
                      onClick={() => { handleDownloadTemplate(); setMoreMenuOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
                    >
                      <Download className="h-4 w-4" /> Template
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        }
      />

      {exportState !== 'idle' && (
        <OperationStatus
          state={exportState}
          message={exportMessage}
          actionLabel={exportState === 'pending' ? undefined : 'Dismiss'}
          onAction={exportState === 'pending' ? undefined : () => setExportState('idle')}
        />
      )}

      {adminNotice && (
        <OperationStatus
          state={adminNotice.state}
          message={adminNotice.message}
          actionLabel={adminNotice.actionLabel ?? (adminNotice.state === 'pending' ? undefined : 'Dismiss')}
          onAction={adminNotice.onAction ?? (adminNotice.state === 'pending' ? undefined : () => setAdminNotice(null))}
        />
      )}

      {/* Bulk action toolbar (slides in when something is selected) */}
      {selectedIds.size > 0 && (
        <Toolbar slideIn className="border-primary-200 dark:border-primary-800/60 bg-gradient-to-r from-primary-50/80 via-white to-white dark:from-primary-950/40 dark:via-slate-900 dark:to-slate-900">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {selectedIds.size}
            </div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {selectedIds.size} selected
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(Array.from(selectedIds).join('\n'));
                  addToast('Competitor IDs copied to clipboard', 'success');
                }}
              >
                Copy IDs
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
              <Button variant="danger" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete {selectedIds.size}
              </Button>
            </div>
          </div>
        </Toolbar>
      )}

      {/* Faceted Search */}
      <Card padded={false}>
        <div className="p-3 space-y-2">
          {/* Search row - full width */}
          <Input
            type="text"
            placeholder="Search by name, school…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />

          {/* Gender + School + Belt row */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Filter by gender"
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              className="py-1.5 min-w-[110px]"
            >
              <option value="">All genders</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </Select>
            <Select
              aria-label="Filter by school"
              value={schoolFilter}
              onChange={(e) => setSchoolFilter(e.target.value)}
              className="py-1.5 min-w-[160px] max-w-[240px]"
            >
              <option value="">All schools</option>
              {aggregates && Object.entries(aggregates.bySchool || {}).map(([school, count]) => (
                <option key={school} value={school}>{school} ({String(count)})</option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 whitespace-nowrap">Belt</span>
              <div className="flex-1 overflow-x-auto flex-nowrap flex items-center gap-1">
                {aggregates && Object.entries(aggregates.byBelt || {}).map(([belt, count]) => {
                  const active = beltFilter.includes(belt);
                  return (
                    <button
                      key={belt}
                      type="button"
                      onClick={() => setBeltFilter(active ? beltFilter.filter((b) => b !== belt) : [...beltFilter, belt])}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all flex-shrink-0 ${
                        active
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {belt} <span className={`tabular-nums ${active ? 'opacity-80' : 'opacity-60'}`}>{String(count)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Age range row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Age</span>
            <Select
              aria-label="Minimum age filter"
              value={ageMin}
              onChange={(e) => setAgeMin(e.target.value)}
              className="py-1 text-xs min-w-[70px]"
            >
              <option value="">Any</option>
              <option value="4">4+</option>
              <option value="6">6+</option>
              <option value="8">8+</option>
              <option value="10">10+</option>
              <option value="12">12+</option>
              <option value="15">15+</option>
              <option value="18">18+</option>
              <option value="36">36+</option>
            </Select>
            <span className="text-xs text-slate-600">–</span>
            <Select
              aria-label="Maximum age filter"
              value={ageMax}
              onChange={(e) => setAgeMax(e.target.value)}
              className="py-1 text-xs min-w-[70px]"
            >
              <option value="">Any</option>
              <option value="5">≤5</option>
              <option value="7">≤7</option>
              <option value="9">≤9</option>
              <option value="11">≤11</option>
              <option value="14">≤14</option>
              <option value="17">≤17</option>
              <option value="35">≤35</option>
            </Select>

            {(search || beltFilter.length || genderFilter || ageMin || ageMax || schoolFilter) && (
              <button
                onClick={() => {
                  setSearch(''); setBeltFilter([]); setGenderFilter('');
                  setAgeMin(''); setAgeMax(''); setSchoolFilter('');
                }}
                className="ml-auto text-xs text-slate-600 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Clear all
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Competitors List */}
      <Card padded={false}>
        <CardBody className="p-0">
          {isLoading ? (
            <TableSkeleton rows={8} />
          ) : filteredCompetitors?.length > 0 ? (
            <>
              {/* Mobile Card View */}
              <div className="md:hidden p-4 space-y-3">
                {filteredCompetitors.map((c: Competitor) => (
                  <div key={c.id} className="mobile-card">
                    <div className="mobile-card-header">
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {c.firstName} {c.lastName}
                        </div>
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium mt-1 ${getBeltColor(c.belt)}`}
                        >
                          {c.belt}
                          {c.danRank && ` ${c.danRank}D`}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingCompetitor(c); setShowFormModal(true); }}
                          aria-label={`Edit ${c.firstName} ${c.lastName}`}
                          className="p-2 text-gray-600 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          <Edit className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(c)}
                          aria-label={`Delete ${c.firstName} ${c.lastName}`}
                          className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm mt-3">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Gender</span>
                        <span className="text-gray-900 dark:text-white">{c.gender === 'M' ? 'Male' : 'Female'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Age</span>
                        <span className="text-gray-900 dark:text-white">{calculateAge(c.dateOfBirth)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Weight</span>
                        <span className="text-gray-900 dark:text-white">{c.weightLbs ? `${c.weightLbs} lbs` : '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">School</span>
                        <span className="text-gray-900 dark:text-white truncate max-w-[100px]">{c.schoolDojang || '-'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block">
                <DataTable>
                  <TableHead>
                    <tr>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-left w-10">
                        <input
                          type="checkbox"
                          aria-label={selectedIds.size === filteredCompetitors?.length ? "Deselect all competitors" : "Select all competitors"}
                          checked={filteredCompetitors?.length > 0 && selectedIds.size === filteredCompetitors.length}
                          ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < (filteredCompetitors?.length || 0); }}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(new Set(filteredCompetitors?.map((c: Competitor) => c.id) || []));
                            } else {
                              setSelectedIds(new Set());
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                        />
                      </th>
                      <th className="px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-left">Name</th>
                      <th className="px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-left hidden lg:table-cell">School</th>
                      <th className="px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-right w-12">Age</th>
                      <th className="px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-right w-16">
                        Weight <span className="text-slate-600 dark:text-slate-500 normal-case tracking-normal">(lbs)</span>
                      </th>
                      <th className="px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-right w-16">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {filteredCompetitors.map((c: Competitor) => (
                      <TableRow
                        key={c.id}
                        onClick={() => { setEditingCompetitor(c); setShowFormModal(true); }}
                        className={`border-b border-slate-100 dark:border-slate-800/60 cursor-pointer ${selectedIds.has(c.id) ? 'row-selected' : ''}`}
                      >
                        <TableCell className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${c.firstName} ${c.lastName}`}
                            checked={selectedIds.has(c.id)}
                            onChange={(e) => {
                              const next = new Set(selectedIds);
                              if (e.target.checked) next.add(c.id);
                              else next.delete(c.id);
                              setSelectedIds(next);
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                          />
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary-500/10 to-accent-500/10 border border-primary-200/40 dark:border-primary-800/40 flex items-center justify-center text-primary-700 dark:text-primary-300 text-xs font-semibold flex-shrink-0">
                              {c.firstName?.[0]}{c.lastName?.[0]}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                                <span className="truncate">{c.firstName} {c.lastName}</span>
                                {isTestData(c) && (
                                  <Badge variant="warning" size="sm" title="Row seeded by Playwright e2e test">
                                    TEST
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`pill ${getBeltColor(c.belt)} text-[10px]`}>
                                  {c.belt}{c.danRank && ` ${c.danRank}D`}
                                </span>
                                <span className="text-[10px] text-slate-600 lg:hidden truncate max-w-[140px]" title={c.schoolDojang || ''}>{c.schoolDojang || '—'}</span>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell
                          className="px-2 py-2 text-sm text-slate-600 dark:text-slate-400 max-w-[160px] truncate hidden lg:table-cell"
                          title={c.schoolDojang || ''}
                        >
                          {c.schoolDojang || '—'}
                        </TableCell>
                        <TableCell className="px-2 py-2 text-sm text-slate-600 dark:text-slate-300 tabular-nums text-right">{calculateAge(c.dateOfBirth)}</TableCell>
                        <TableCell className="px-2 py-2 text-sm text-slate-600 dark:text-slate-300 tabular-nums text-right">{c.weightLbs ? `${c.weightLbs}` : <span className="text-slate-300">—</span>}</TableCell>
                        <TableCell className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              icon={<Edit className="h-3.5 w-3.5" />}
                              label={`Edit ${c.firstName} ${c.lastName}`}
                              variant="primary"
                              size="sm"
                              onClick={() => { setEditingCompetitor(c); setShowFormModal(true); }}
                            />
                            <IconButton
                              icon={<Trash2 className="h-3.5 w-3.5" />}
                              label={`Delete ${c.firstName} ${c.lastName}`}
                              variant="danger"
                              size="sm"
                              onClick={() => setDeleteTarget(c)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </DataTable>
              </div>
            </>
          ) : data?.competitors?.length > 0 ? (
            <EmptyState
              icon={Search}
              title="No matches found"
              description="Try adjusting your search or filter criteria"
              action={{ label: 'Clear Filters', onClick: () => { setSearch(''); setBeltFilter([]); } }}
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No competitors yet"
              description="Import competitors from an Excel file or add them manually."
              action={{ label: 'Import from Excel', onClick: () => fileInputRef.current?.click() }}
              secondaryAction={{ label: 'Add Manually', onClick: () => { setEditingCompetitor(null); setFormData(emptyForm); setShowFormModal(true); } }}
            />
          )}
        </CardBody>
        {data?.total > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 flex items-center justify-between">
            <span>
              Showing {filteredCompetitors?.length || 0} of {data.total} competitors
            </span>
            {data.total > pageLimit && (
              <button
                onClick={() => setPageLimit((p) => p + 100)}
                className="text-primary-600 dark:text-primary-400 hover:underline text-sm font-medium"
              >
                Load more
              </button>
            )}
          </div>
        )}
      </Card>

      {/* Delete Confirmation (single) */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => { if (!deleteMutation.isPending) setDeleteTarget(null); }}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Send to Trash?"
        message={
          <>
            <span className="block"><span className="font-semibold">{deleteTarget?.firstName} {deleteTarget?.lastName}</span> will be removed from any tournaments they're registered in. They go to the <span className="font-semibold text-primary-600 dark:text-primary-400">Trash</span> for 7 days, then are permanently purged.</span>
            {deleteError && (
              <span role="alert" aria-live="assertive" className="mt-3 block rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {deleteError} You can try again or cancel.
              </span>
            )}
          </>
        }
        confirmText="Send to Trash"
        isLoading={deleteMutation.isPending}
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmDialog
        isOpen={bulkDeleteOpen}
        onClose={() => { if (!bulkDeleteMutation.isPending) setBulkDeleteOpen(false); }}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
        title={`Send ${selectedIds.size} competitor${selectedIds.size === 1 ? '' : 's'} to Trash?`}
        message={
          <>
            {selectedIds.size} competitor{selectedIds.size === 1 ? '' : 's'} will be removed from every tournament they're registered in. They go to the <span className="font-semibold text-primary-600 dark:text-primary-400">Trash</span> and can be restored within 7 days. After 7 days they're permanently purged.
          </>
        }
        confirmText={`Send ${selectedIds.size} to Trash`}
        isLoading={bulkDeleteMutation.isPending}
      />

      {/* Add/Edit Competitor Modal */}
      {showFormModal && (
        <Modal
          isOpen={showFormModal}
          onClose={() => {
            if (!createMutation.isPending && !updateMutation.isPending) closeFormModal();
          }}
          title={editingCompetitor ? 'Edit Competitor' : 'Add Competitor'}
          size="lg"
          footer={
            <>
              <Button variant="secondary" type="button" onClick={closeFormModal} disabled={createMutation.isPending || updateMutation.isPending} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                form="competitor-form"
                loading={createMutation.isPending || updateMutation.isPending}
                className="w-full sm:w-auto flex items-center justify-center"
              >
                {(createMutation.isPending || updateMutation.isPending) ? (
                  <><Spinner size="sm" className="mr-2" /> Saving...</>
                ) : editingCompetitor ? (
                  'Update Competitor'
                ) : (
                  'Add Competitor'
                )}
              </Button>
            </>
          }
        >
          <form
            id="competitor-form"
            onSubmit={handleFormSubmit}
            onInvalidCapture={(e) => {
              const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
              if (target && target.willValidate && !target.validity.valid) {
                e.preventDefault();
                const label = target.closest('div')?.querySelector('label')?.textContent?.replace('*','').trim() || target.name || 'A required field';
                setFormError(`${label} is required`);
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => target.focus(), 50);
              }
            }}
            className="space-y-4"
          >
            {formError && (
              <div role="alert" aria-live="assertive" className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                <span className="font-semibold">⚠</span>
                <span>{formError}</span>
              </div>
            )}
            <div className="form-grid">
              <div>
                <Label>
                  First Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>
                  Last Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-grid">
              <div>
                <Label>
                  Gender <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={formData.gender}
                  onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                  required
                >
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </Select>
              </div>
              <div>
                <Label>
                  Date of Birth <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-grid">
              <div>
                <Label>
                  Belt <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={formData.belt}
                  onChange={(e) => setFormData({ ...formData, belt: e.target.value })}
                  required
                >
                  {BELT_OPTIONS.map((belt) => (
                    <option key={belt} value={belt}>
                      {belt}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Dan Rank</Label>
                <Select
                  value={formData.danRank}
                  onChange={(e) => setFormData({ ...formData, danRank: e.target.value })}
                  disabled={formData.belt !== 'Black'}
                >
                  <option value="">N/A</option>
                  <option value="1">1st Dan</option>
                  <option value="2">2nd Dan</option>
                  <option value="3">3rd Dan</option>
                  <option value="4">4th Dan</option>
                  <option value="5">5th Dan</option>
                  <option value="6">6th Dan</option>
                </Select>
              </div>
            </div>

            <div className="form-grid">
              <div>
                <Label>
                  Weight (lbs) <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.weightLbs}
                  onChange={(e) => setFormData({ ...formData, weightLbs: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Height (inches)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.heightInches}
                  onChange={(e) => setFormData({ ...formData, heightInches: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>School/Dojang</Label>
              <Input
                type="text"
                value={formData.schoolDojang}
                onChange={(e) => setFormData({ ...formData, schoolDojang: e.target.value })}
              />
            </div>

            <div>
              <Label>Special Needs</Label>
              <Input
                type="text"
                value={formData.specialNeeds}
                onChange={(e) => setFormData({ ...formData, specialNeeds: e.target.value })}
                placeholder="Leave blank if none"
              />
            </div>
          </form>
        </Modal>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <Modal
          isOpen={showImportModal}
          onClose={() => {
            if (!importPreparing && !importMutation.isPending) setShowImportModal(false);
          }}
          title={
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <FileSpreadsheet className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <span>Import Competitors</span>
            </div>
          }
          size="xl"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowImportModal(false)} disabled={importPreparing || importMutation.isPending} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button
                variant="success"
                onClick={handleImport}
                loading={importPreparing || importMutation.isPending}
                disabled={importPreparing || importMutation.isPending || !columnMapping.firstName || !columnMapping.gender || !columnMapping.belt}
                className="w-full sm:w-auto flex items-center justify-center"
              >
                {(importPreparing || importMutation.isPending) ? (
                  <><Spinner size="sm" className="mr-2" /> Importing {importData?.length} rows...</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" /> Import {importData?.length} Competitors</>
                )}
              </Button>
            </>
          }
        >
          {importError && (
            <div role="alert" aria-live="assertive" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {importError}
            </div>
          )}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-600">
              Found {importData?.length} rows. Map the columns below:
            </p>
            <button
              onClick={handleDownloadTemplate}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center"
            >
              <Download className="h-4 w-4 mr-1" />
              Get Template
            </button>
          </div>

          <div className="form-grid">
            {[
              { key: 'firstName', label: 'First Name', required: true },
              { key: 'lastName', label: 'Last Name', required: true },
              { key: 'gender', label: 'Gender', required: true },
              { key: 'dateOfBirth', label: 'Date of Birth' },
              { key: 'age', label: 'Age (if no DOB)' },
              { key: 'belt', label: 'Belt', required: true },
              { key: 'danRank', label: 'Dan Rank' },
              { key: 'weight', label: 'Weight', required: true },
              { key: 'height', label: 'Height' },
              { key: 'school', label: 'School/Dojang' },
              { key: 'patterns', label: 'Patterns (Y/N)' },
              { key: 'sparring', label: 'Sparring (Y/N)' },
            ].map(({ key, label, required }) => (
              <div key={key}>
                <Label className="text-xs sm:text-sm">
                  {label}
                  {required && <span className="text-red-500">*</span>}
                </Label>
                <Select
                  value={(columnMapping as unknown as Record<string, string>)[key] || ''}
                  onChange={(e) =>
                    setColumnMapping({ ...columnMapping, [key]: e.target.value })
                  }
                  className="w-full text-sm"
                >
                  <option value="">-- Select --</option>
                  {importColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>

          {importData && importData.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Preview (first 3 rows):
              </h3>
              <div className="overflow-x-auto scroll-hint -mx-4 px-4 sm:mx-0 sm:px-0">
                <DataTable density="compact">
                  <TableHead>
                    <tr>
                      {Object.keys(importData[0]).slice(0, 4).map((key) => (
                        <th key={key} className="px-2 py-1 text-left whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                          {key.length > 12 ? key.substring(0, 12) + '...' : key}
                        </th>
                      ))}
                    </tr>
                  </TableHead>
                  <TableBody>
                    {importData.slice(0, 3).map((row, i) => (
                      <TableRow key={i}>
                        {Object.values(row).slice(0, 4).map((val: unknown, j) => (
                          <TableCell key={j} density="compact" className="px-2 py-1 border-t whitespace-nowrap">
                            {String(val).substring(0, 15)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </DataTable>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
