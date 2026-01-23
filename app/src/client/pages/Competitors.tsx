import { useState, useRef } from 'react';
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

export default function Competitors() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [importData, setImportData] = useState<any[] | null>(null);
  const [importColumns, setImportColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ImportMapping>({
    firstName: '',
    lastName: '',
    gender: '',
    belt: '',
    weight: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });

      // Get first sheet (or "Competitors list" if exists)
      const sheetName =
        workbook.SheetNames.find((n) =>
          n.toLowerCase().includes('competitor')
        ) || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (jsonData.length > 0) {
        const columns = Object.keys(jsonData[0] as object);
        setImportColumns(columns);
        setImportData(jsonData);

        // Auto-detect column mapping
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
            // Single name column - might need split
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Competitors</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your competitor registry
          </p>
        </div>
        <div className="flex gap-3">
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
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
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

      {/* Competitors Table */}
      <div className="card">
        <div className="card-body p-0">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : data?.competitors?.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Gender</th>
                  <th>Age</th>
                  <th>Belt</th>
                  <th>Weight</th>
                  <th>School</th>
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
                    <td>
                      {c.dateOfBirth
                        ? Math.floor(
                            (Date.now() - new Date(c.dateOfBirth).getTime()) /
                              (365.25 * 24 * 60 * 60 * 1000)
                          )
                        : '-'}
                    </td>
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
                    <td>{c.schoolDojang || '-'}</td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingId(c.id)}
                          className="text-gray-400 hover:text-primary-600"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Delete this competitor?')) {
                              deleteMutation.mutate(c.id);
                            }
                          }}
                          className="text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-gray-500">
              <FileSpreadsheet className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2">No competitors yet</p>
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

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Import Competitors</h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                Found {importData?.length} rows. Map the columns below:
              </p>

              <div className="grid grid-cols-2 gap-4">
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
                    <label className="form-label">
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
                      className="form-input w-full"
                    >
                      <option value="">-- Select column --</option>
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
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50">
                          {Object.keys(importData[0]).slice(0, 6).map((key) => (
                            <th key={key} className="px-2 py-1 text-left">
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importData.slice(0, 3).map((row, i) => (
                          <tr key={i}>
                            {Object.values(row).slice(0, 6).map((val: any, j) => (
                              <td key={j} className="px-2 py-1 border-t">
                                {String(val).substring(0, 20)}
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
            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowImportModal(false)}
                className="btn btn-secondary"
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
                className="btn btn-primary"
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
