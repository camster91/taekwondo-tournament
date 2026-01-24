import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Upload,
  Search,
  Edit,
  Trash2,
  X,
  Check,
  FileSpreadsheet,
} from 'lucide-react';
import * as XLSX from 'xlsx';

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
  'Yellow',
  'Green',
  'Blue',
  'Red',
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
  const [search, setSearch] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const [formData, setFormData] = useState(emptyForm);
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
    queryKey: ['competitors', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('limit', '100');
      const res = await fetch(`/api/competitors?${params}`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch('/api/competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          danRank: data.danRank ? parseInt(data.danRank) : null,
          heightInches: data.heightInches ? parseFloat(data.heightInches) : null,
          weightLbs: data.weightLbs ? parseFloat(data.weightLbs) : null,
        }),
      });
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          danRank: data.danRank ? parseInt(data.danRank) : null,
          heightInches: data.heightInches ? parseFloat(data.heightInches) : null,
          weightLbs: data.weightLbs ? parseFloat(data.weightLbs) : null,
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] });
      closeFormModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/competitors/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] });
    },
  });

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, columnMapping: mapping }),
      });
      return res.json();
    },
    onSuccess: (result) => {
      alert(
        `Import complete!\nImported: ${result.imported}\nUpdated: ${result.updated}\nSkipped: ${result.skipped}`
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
    <div>
      {/* Page Header - responsive */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Competitors</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your competitor registry
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-secondary"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Excel
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
            Add Competitor
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="card mb-6">
        <div className="card-body">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input pl-10 w-full max-w-md"
            />
          </div>
        </div>
      </div>

      {/* Competitors List */}
      <div className="card">
        <div className="card-body p-0">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : data?.competitors?.length > 0 ? (
            <>
              {/* Mobile Card View */}
              <div className="mobile-cards p-4 space-y-3">
                {data.competitors.map((c: Competitor) => (
                  <div key={c.id} className="mobile-card">
                    <div className="mobile-card-header">
                      <div>
                        <div className="mobile-card-title">
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
                      <div className="flex gap-3">
                        <button
                          onClick={() => setEditingCompetitor(c)}
                          className="text-gray-400 hover:text-primary-600 touch-target flex items-center justify-center"
                        >
                          <Edit className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Delete this competitor?')) {
                              deleteMutation.mutate(c.id);
                            }
                          }}
                          className="text-gray-400 hover:text-red-600 touch-target flex items-center justify-center"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">Gender</span>
                        <span className="mobile-card-value">{c.gender === 'M' ? 'Male' : 'Female'}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">Age</span>
                        <span className="mobile-card-value">{calculateAge(c.dateOfBirth)}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">Weight</span>
                        <span className="mobile-card-value">{c.weightLbs ? `${c.weightLbs} lbs` : '-'}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">School</span>
                        <span className="mobile-card-value truncate max-w-[120px]">{c.schoolDojang || '-'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table View */}
              <div className="desktop-table overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Gender</th>
                      <th>Age</th>
                      <th>Belt</th>
                      <th>Weight</th>
                      <th className="hide-mobile">School</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {data.competitors.map((c: Competitor) => (
                      <tr key={c.id}>
                        <td className="font-medium">
                          {c.firstName} {c.lastName}
                        </td>
                        <td>{c.gender}</td>
                        <td>{calculateAge(c.dateOfBirth)}</td>
                        <td>
                          <span
                            className={`inline-flex px-2 py-1 rounded text-xs font-medium ${getBeltColor(
                              c.belt
                            )}`}
                          >
                            {c.belt}
                            {c.danRank && ` ${c.danRank}D`}
                          </span>
                        </td>
                        <td>{c.weightLbs ? `${c.weightLbs} lbs` : '-'}</td>
                        <td className="hide-mobile">{c.schoolDojang || '-'}</td>
                        <td>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setEditingCompetitor(c)}
                              className="text-gray-400 hover:text-primary-600 p-1"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Delete this competitor?')) {
                                  deleteMutation.mutate(c.id);
                                }
                              }}
                              className="text-gray-400 hover:text-red-600 p-1"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <FileSpreadsheet className="empty-state-icon" />
              <p className="empty-state-title">No competitors yet</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 text-primary-600 hover:text-primary-700"
              >
                Import from Excel
              </button>
            </div>
          )}
        </div>
        {data?.total > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 text-sm text-gray-500">
            Showing {data.competitors.length} of {data.total} competitors
          </div>
        )}
      </div>

      {/* Add/Edit Competitor Modal */}
      {showFormModal && (
        <div className="modal-container flex items-center justify-center p-4">
          <div className="modal-backdrop" onClick={closeFormModal} />
          <div className="modal-panel">
            <div className="modal-header">
              <h2 className="text-lg font-semibold">
                {editingCompetitor ? 'Edit Competitor' : 'Add Competitor'}
              </h2>
              <button
                onClick={closeFormModal}
                className="text-gray-400 hover:text-gray-600 touch-target flex items-center justify-center"
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
                  className="btn btn-primary w-full sm:w-auto"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? 'Saving...'
                    : editingCompetitor
                    ? 'Update'
                    : 'Add Competitor'}
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
              <h2 className="text-lg font-semibold">Import Competitors</h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-gray-400 hover:text-gray-600 touch-target flex items-center justify-center"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-sm text-gray-600 mb-4">
                Found {importData?.length} rows. Map the columns below:
              </p>

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
                className="btn btn-primary w-full sm:w-auto"
              >
                {importMutation.isPending ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
