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
import * as XLSX from 'xlsx';
import { TableSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

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
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Competitor | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [pageLimit, setPageLimit] = useState(100);
  const [importData, setImportData] = useState<any[] | null>(null);
  const [importColumns, setImportColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ImportMapping>({
    firstName: '',
    lastName: '',
    gender: '',
    belt: '',
    weight: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      if (!res.ok) throw new Error('Failed to create competitor');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] });
      closeFormModal();
    },
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
      if (!res.ok) throw new Error('Failed to update competitor');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] });
      closeFormModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/competitors/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] });
      setDeleteTarget(null);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Sequential deletes — keeps the server happy and gives us per-item
      // error feedback. For 1k+ items we'd batch this; for typical
      // bulk-delete sizes (10-200) sequential is fine.
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
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] });
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      if (results.failed.length === 0) {
        addToast(`${results.ok.length} competitor${results.ok.length === 1 ? '' : 's'} deleted`, 'success');
      } else {
        addToast(`${results.ok.length} deleted, ${results.failed.length} failed`, 'warning');
      }
    },
  });

  // Server-side filter handles all filtering now. `data.competitors` is already filtered.
  // We keep this variable name so the existing JSX below doesn't need to change.
  const filteredCompetitors = data?.competitors;

  const importMutation = useMutation({
    mutationFn: async ({
      data,
      mapping,
    }: {
      data: any[];
      mapping: ImportMapping;
    }) => {
      const res = await fetch('/api/competitors/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ data, columnMapping: mapping }),
      });
      if (!res.ok) throw new Error('Failed to import competitors');
      return res.json();
    },
    onSuccess: (result) => {
      addToast(
        `Import complete! Imported: ${result.imported}, Updated: ${result.updated}, Skipped: ${result.skipped}`,
        'success'
      );
      queryClient.invalidateQueries({ queryKey: ['competitors'] });
      setShowImportModal(false);
      setImportData(null);
    },
  });

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingCompetitor(null);
    setFormData(emptyForm);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCompetitor) {
      updateMutation.mutate({ id: editingCompetitor.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
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
        setImportData(jsonData);

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
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = () => {
    if (!importData) return;
    importMutation.mutate({ data: importData, mapping: columnMapping });
  };

  const handleDownloadTemplate = () => {
    window.location.href = '/api/competitors/template';
  };

  const handleExportExcel = async () => {
    // Fetch all competitors (no limit) for export
    const res = await fetch('/api/competitors?limit=10000', { headers: getAuthHeaders() });
    const result = await res.json();
    const all: Competitor[] = result.competitors || [];

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

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Competitors');
    XLSX.writeFile(wb, `Competitors_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-baseline gap-2">
          <h1>Competitors</h1>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            ({filteredCompetitors?.length ?? data?.competitors?.length ?? 0})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-secondary"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => {
              setEditingCompetitor(null);
              setFormData(emptyForm);
              setShowFormModal(true);
            }}
            className="btn btn-primary"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add
          </button>
          <div className="relative">
            <button
              onClick={() => setMoreMenuOpen(!moreMenuOpen)}
              className="btn btn-secondary px-2"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {moreMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMoreMenuOpen(false)}
                />
                <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-20">
                  <button
                    onClick={() => { handleExportExcel(); setMoreMenuOpen(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Export
                  </button>
                  <button
                    onClick={() => { handleDownloadTemplate(); setMoreMenuOpen(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Template
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bulk action toolbar (slides in when something is selected) */}
      {selectedIds.size > 0 && (
        <div className="card overflow-hidden border-indigo-200 dark:border-indigo-800/60 bg-gradient-to-r from-indigo-50/80 via-white to-white dark:from-indigo-950/40 dark:via-slate-900 dark:to-slate-900 animate-slide-down">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {selectedIds.size}
            </div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {selectedIds.size} selected
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(Array.from(selectedIds).join('\n'));
                  addToast('Competitor IDs copied to clipboard', 'success');
                }}
                className="btn btn-ghost text-sm"
                title="Copy competitor IDs as a list"
              >
                Copy IDs
              </button>
              <button
                onClick={() => {
                  setSelectedIds(new Set());
                }}
                className="btn btn-ghost text-sm"
              >
                Clear
              </button>
              <button
                onClick={() => setBulkDeleteOpen(true)}
                className="btn btn-danger text-sm"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete {selectedIds.size}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Faceted Search */}
      <div className="card overflow-hidden">
        <div className="p-3 space-y-2">
          {/* Search row - full width */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, school…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input pl-9 w-full"
            />
          </div>

          {/* Gender + School + Belt row */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              className="form-input py-1.5 min-w-[110px]"
            >
              <option value="">All genders</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
            <select
              value={schoolFilter}
              onChange={(e) => setSchoolFilter(e.target.value)}
              className="form-input py-1.5 min-w-[160px] max-w-[240px]"
            >
              <option value="">All schools</option>
              {aggregates && Object.entries(aggregates.bySchool || {}).map(([school, count]) => (
                <option key={school} value={school}>{school} ({count})</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Belt</span>
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
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {belt} <span className={`tabular-nums ${active ? 'opacity-80' : 'opacity-60'}`}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Age range row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Age</span>
            <select
              value={ageMin}
              onChange={(e) => setAgeMin(e.target.value)}
              className="form-input py-1 text-xs min-w-[70px]"
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
            </select>
            <span className="text-xs text-slate-400">–</span>
            <select
              value={ageMax}
              onChange={(e) => setAgeMax(e.target.value)}
              className="form-input py-1 text-xs min-w-[70px]"
            >
              <option value="">Any</option>
              <option value="5">≤5</option>
              <option value="7">≤7</option>
              <option value="9">≤9</option>
              <option value="11">≤11</option>
              <option value="14">≤14</option>
              <option value="17">≤17</option>
              <option value="35">≤35</option>
            </select>

            {(search || beltFilter.length || genderFilter || ageMin || ageMax || schoolFilter) && (
              <button
                onClick={() => {
                  setSearch(''); setBeltFilter([]); setGenderFilter('');
                  setAgeMin(''); setAgeMax(''); setSchoolFilter('');
                }}
                className="ml-auto text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Clear all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Competitors List */}
      <div className="card">
        <div className="card-body p-0">
          {isLoading ? (
            <TableSkeleton rows={8} />
          ) : filteredCompetitors?.length > 0 ? (
            <>
              {/* Mobile Card View */}
              <div className="mobile-cards p-4 space-y-3">
                {filteredCompetitors.map((c: Competitor) => (
                  <div key={c.id} className="mobile-card">
                    <div className="mobile-card-header">
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {c.firstName} {c.lastName}
                        </div>
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium mt-1 ${getBeltColor(
                            c.belt
                          )}`}
                        >
                          {c.belt}
                          {c.danRank && ` ${c.danRank}D`}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingCompetitor(c)}
                          className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          <Edit className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(c)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm mt-3">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Gender</span>
                        <span className="text-gray-900 dark:text-white">{c.gender === 'M' ? 'Male' : 'Female'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Age</span>
                        <span className="text-gray-900 dark:text-white">{calculateAge(c.dateOfBirth)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Weight</span>
                        <span className="text-gray-900 dark:text-white">{c.weightLbs ? `${c.weightLbs} lbs` : '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">School</span>
                        <span className="text-gray-900 dark:text-white truncate max-w-[100px]">{c.schoolDojang || '-'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      <th className="px-5 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={filteredCompetitors?.length > 0 && selectedIds.size === filteredCompetitors.length}
                          ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < (filteredCompetitors?.length || 0); }}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(new Set(filteredCompetitors?.map((c: Competitor) => c.id) || []));
                            } else {
                              setSelectedIds(new Set());
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-3 py-3">Name</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-3 py-3">Gender</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-3 py-3">Age</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-3 py-3">Belt</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-3 py-3">Weight</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-3 py-3 hidden lg:table-cell">School</th>
                      <th className="w-20 px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCompetitors.map((c: Competitor) => (
                      <tr key={c.id} className={`group border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${selectedIds.has(c.id) ? 'row-selected' : ''}`}>
                        <td className="px-5 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={(e) => {
                              const next = new Set(selectedIds);
                              if (e.target.checked) next.add(c.id);
                              else next.delete(c.id);
                              setSelectedIds(next);
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-200/40 dark:border-indigo-800/40 flex items-center justify-center text-indigo-700 dark:text-indigo-300 text-xs font-semibold flex-shrink-0">
                              {c.firstName?.[0]}{c.lastName?.[0]}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-sm text-slate-900 dark:text-white truncate">{c.firstName} {c.lastName}</div>
                              <div className="text-[11px] text-slate-400 lg:hidden truncate">{c.schoolDojang || '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1">
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${c.gender === 'M' ? 'bg-sky-500' : 'bg-pink-500'}`} />
                            {c.gender === 'M' ? 'Male' : 'Female'}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-300 tabular-nums">{calculateAge(c.dateOfBirth)}</td>
                        <td className="px-3 py-3">
                          <span className={`pill ${getBeltColor(c.belt)} text-[11px]`}>
                            {c.belt}
                            {c.danRank && <span className="ml-1 opacity-70">{c.danRank}D</span>}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-300 tabular-nums">{c.weightLbs ? `${c.weightLbs} lbs` : <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-400 max-w-[180px] truncate hidden lg:table-cell">{c.schoolDojang || '—'}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => setEditingCompetitor(c)}
                              className="h-7 w-7 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex items-center justify-center transition-colors"
                              title="Edit"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(c)}
                              className="h-7 w-7 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 flex items-center justify-center transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : data?.competitors?.length > 0 ? (
            <EmptyState
              icon={Search}
              title="No matches found"
              description="Try adjusting your search or filter criteria"
              action={{ label: 'Clear Filters', onClick: () => { setSearch(''); setBeltFilter(''); } }}
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
        </div>
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
      </div>

      {/* Delete Confirmation (single) — soft-delete to Trash */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Send to Trash?"
        message={
          <>
            <span className="font-semibold">{deleteTarget?.firstName} {deleteTarget?.lastName}</span> will be removed from any tournaments they're registered in. They go to the <span className="font-semibold text-indigo-600 dark:text-indigo-400">Trash</span> for 7 days, then are permanently purged.
          </>
        }
        confirmText="Send to Trash"
        isLoading={deleteMutation.isPending}
      />

      {/* Bulk Delete Confirmation — soft-delete: send to Trash, recoverable for 7 days */}
      <ConfirmDialog
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
        title={`Send ${selectedIds.size} competitor${selectedIds.size === 1 ? '' : 's'} to Trash?`}
        message={
          <>
            {selectedIds.size} competitor{selectedIds.size === 1 ? '' : 's'} will be removed from every tournament they're registered in. They go to the <span className="font-semibold text-indigo-600 dark:text-indigo-400">Trash</span> and can be restored within 7 days. After 7 days they're permanently purged.
          </>
        }
        confirmText={`Send ${selectedIds.size} to Trash`}
        isLoading={bulkDeleteMutation.isPending}
      />

      {/* Add/Edit Competitor Modal */}
      {showFormModal && (
        <div className="modal-container flex items-center justify-center p-4">
          <div className="modal-backdrop" onClick={closeFormModal} />
          <div className="modal-panel max-w-lg">
            <div className="modal-header">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingCompetitor ? 'Edit Competitor' : 'Add Competitor'}
              </h2>
              <button
                onClick={closeFormModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleFormSubmit}>
              <div className="modal-body space-y-4">
                <div className="form-grid">
                  <div>
                    <label className="form-label">
                      First Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.firstName}
                      onChange={(e) =>
                        setFormData({ ...formData, firstName: e.target.value })
                      }
                      className="form-input w-full"
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">
                      Last Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.lastName}
                      onChange={(e) =>
                        setFormData({ ...formData, lastName: e.target.value })
                      }
                      className="form-input w-full"
                      required
                    />
                  </div>
                </div>

                <div className="form-grid">
                  <div>
                    <label className="form-label">
                      Gender <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.gender}
                      onChange={(e) =>
                        setFormData({ ...formData, gender: e.target.value })
                      }
                      className="form-input w-full"
                      required
                    >
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">
                      Date of Birth <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={formData.dateOfBirth}
                      onChange={(e) =>
                        setFormData({ ...formData, dateOfBirth: e.target.value })
                      }
                      className="form-input w-full"
                      required
                    />
                  </div>
                </div>

                <div className="form-grid">
                  <div>
                    <label className="form-label">
                      Belt <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.belt}
                      onChange={(e) =>
                        setFormData({ ...formData, belt: e.target.value })
                      }
                      className="form-input w-full"
                      required
                    >
                      {BELT_OPTIONS.map((belt) => (
                        <option key={belt} value={belt}>
                          {belt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Dan Rank</label>
                    <select
                      value={formData.danRank}
                      onChange={(e) =>
                        setFormData({ ...formData, danRank: e.target.value })
                      }
                      className="form-input w-full"
                      disabled={formData.belt !== 'Black'}
                    >
                      <option value="">N/A</option>
                      <option value="1">1st Dan</option>
                      <option value="2">2nd Dan</option>
                      <option value="3">3rd Dan</option>
                      <option value="4">4th Dan</option>
                      <option value="5">5th Dan</option>
                      <option value="6">6th Dan</option>
                    </select>
                  </div>
                </div>

                <div className="form-grid">
                  <div>
                    <label className="form-label">
                      Weight (lbs) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.weightLbs}
                      onChange={(e) =>
                        setFormData({ ...formData, weightLbs: e.target.value })
                      }
                      className="form-input w-full"
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Height (inches)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.heightInches}
                      onChange={(e) =>
                        setFormData({ ...formData, heightInches: e.target.value })
                      }
                      className="form-input w-full"
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label">School/Dojang</label>
                  <input
                    type="text"
                    value={formData.schoolDojang}
                    onChange={(e) =>
                      setFormData({ ...formData, schoolDojang: e.target.value })
                    }
                    className="form-input w-full"
                  />
                </div>

                <div>
                  <label className="form-label">Special Needs</label>
                  <input
                    type="text"
                    value={formData.specialNeeds}
                    onChange={(e) =>
                      setFormData({ ...formData, specialNeeds: e.target.value })
                    }
                    className="form-input w-full"
                    placeholder="Leave blank if none"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={closeFormModal}
                  className="btn btn-secondary w-full sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="btn btn-primary w-full sm:w-auto flex items-center justify-center"
                >
                  {(createMutation.isPending || updateMutation.isPending) ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      Saving...
                    </>
                  ) : editingCompetitor ? (
                    'Update Competitor'
                  ) : (
                    'Add Competitor'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal-container flex items-center justify-center p-4">
          <div className="modal-backdrop" onClick={() => setShowImportModal(false)} />
          <div className="modal-panel max-w-2xl">
            <div className="modal-header">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <FileSpreadsheet className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Import Competitors</h2>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="modal-body">
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
                    <label className="form-label text-xs sm:text-sm">
                      {label}
                      {required && <span className="text-red-500">*</span>}
                    </label>
                    <select
                      value={(columnMapping as any)[key] || ''}
                      onChange={(e) =>
                        setColumnMapping({
                          ...columnMapping,
                          [key]: e.target.value,
                        })
                      }
                      className="form-input w-full text-sm"
                    >
                      <option value="">-- Select --</option>
                      {importColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {importData && importData.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    Preview (first 3 rows):
                  </h3>
                  <div className="overflow-x-auto scroll-hint -mx-4 px-4 sm:mx-0 sm:px-0">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50">
                          {Object.keys(importData[0]).slice(0, 4).map((key) => (
                            <th key={key} className="px-2 py-1 text-left whitespace-nowrap">
                              {key.length > 12 ? key.substring(0, 12) + '...' : key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importData.slice(0, 3).map((row, i) => (
                          <tr key={i}>
                            {Object.values(row).slice(0, 4).map((val: any, j) => (
                              <td key={j} className="px-2 py-1 border-t whitespace-nowrap">
                                {String(val).substring(0, 15)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowImportModal(false)}
                className="btn btn-secondary w-full sm:w-auto"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={
                  importMutation.isPending ||
                  !columnMapping.firstName ||
                  !columnMapping.gender ||
                  !columnMapping.belt
                }
                className="btn btn-success w-full sm:w-auto flex items-center justify-center"
              >
                {importMutation.isPending ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Importing {importData?.length} rows...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Import {importData?.length} Competitors
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
