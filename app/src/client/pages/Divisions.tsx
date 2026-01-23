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
  Scissors,
  Download,
  AlertTriangle,
  Eye,
  Check,
  X,
} from 'lucide-react';
import { jsPDF } from 'jspdf';

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

  const deleteDivisionMutation = useMutation({
    mutationFn: async (divisionId: string) => {
      await fetch(`/api/divisions/${divisionId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
    },
  });

  const splitDivisionMutation = useMutation({
    mutationFn: async (divisionId: string) => {
      const res = await fetch(`/api/divisions/${divisionId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ splitCount: 2 }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
    },
  });

  // Preview divisions before generating
  const fetchPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/divisions/tournament/${id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { divisionThreshold: 8 } }),
      });
      const data = await res.json();
      setPreviewData(data);
      setShowPreview(true);
    } catch (error) {
      console.error('Preview error:', error);
      alert('Failed to generate preview');
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
      const key = `${div.beltLevel} ${div.gender === 'M' ? 'Males' : 'Females'} ${
        div.eventType === 'patterns' ? 'Patterns' : 'Sparring'
      }`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(div);
      return acc;
    },
    {} as Record<string, Division[]>
  );

  // Export all brackets as PDFs
  const exportAllPDFs = async () => {
    if (!divisions || divisions.length === 0) return;

    setExportingAll(true);

    try {
      const divisionsWithBrackets = divisions.filter((d) => d.bracket);

      if (divisionsWithBrackets.length === 0) {
        alert('No brackets to export. Generate brackets first.');
        setExportingAll(false);
        return;
      }

      // Create a combined PDF with all brackets
      const doc = new jsPDF('landscape', 'pt', 'letter');
      let isFirstPage = true;

      for (const division of divisionsWithBrackets) {
        // Fetch division details with bracket
        const res = await fetch(`/api/divisions/${division.id}`);
        const divisionData = await res.json();

        if (!divisionData.bracket) continue;

        if (!isFirstPage) {
          doc.addPage();
        }
        isFirstPage = false;

        const pageWidth = doc.internal.pageSize.getWidth();

        // Title
        doc.setFontSize(14);
        doc.text(division.name, pageWidth / 2, 40, { align: 'center' });

        doc.setFontSize(10);
        doc.text(`${tournament?.name || 'Tournament'}`, pageWidth / 2, 55, {
          align: 'center',
        });

        // Draw simplified bracket info
        doc.setFontSize(9);
        let y = 80;

        const winnersMatches = divisionData.bracket.matches.filter(
          (m: any) => m.bracketType === 'winners'
        );

        doc.text('Winners Bracket:', 50, y);
        y += 15;

        for (const match of winnersMatches.slice(0, 7)) {
          const name1 = match.competitor1
            ? `${match.competitor1.competitor.firstName} ${match.competitor1.competitor.lastName}`
            : 'BYE';
          const name2 = match.competitor2
            ? `${match.competitor2.competitor.firstName} ${match.competitor2.competitor.lastName}`
            : 'BYE';

          doc.text(`  M${match.matchNumber}: ${name1} vs ${name2}`, 50, y);
          y += 12;
        }

        // Competitor list
        y = 80;
        doc.text('Competitors:', 400, y);
        y += 15;

        divisionData.assignments.forEach((a: any, i: number) => {
          if (y > 500) return;
          doc.text(
            `${i + 1}. ${a.registration.competitor.firstName} ${a.registration.competitor.lastName}`,
            400,
            y
          );
          y += 12;
        });
      }

      // Save the combined PDF
      const fileName = `${tournament?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Tournament'}_All_Brackets.pdf`;
      doc.save(fileName);

      alert(`Exported ${divisionsWithBrackets.length} brackets to ${fileName}`);
    } catch (error) {
      console.error('Export error:', error);
      alert('Error exporting PDFs. Please try again.');
    }

    setExportingAll(false);
  };

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
            onClick={fetchPreview}
            disabled={previewLoading || autoGenerateMutation.isPending}
            className="btn btn-secondary"
          >
            <Eye className="h-4 w-4 mr-2" />
            {previewLoading ? 'Loading...' : 'Preview Divisions'}
          </button>
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
              : 'Auto-Generate'}
          </button>
          <button
            onClick={() => generateAllBracketsMutation.mutate()}
            disabled={
              generateAllBracketsMutation.isPending || !divisions?.length
            }
            className="btn btn-secondary"
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            {generateAllBracketsMutation.isPending
              ? 'Generating...'
              : 'Generate Brackets'}
          </button>
          <button
            onClick={exportAllPDFs}
            disabled={exportingAll || !divisions?.some((d) => d.bracket)}
            className="btn btn-primary"
          >
            <Download className="h-4 w-4 mr-2" />
            {exportingAll ? 'Exporting...' : 'Export All PDFs'}
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

      {/* Warnings */}
      {(stats.smallDivisions > 0 || stats.largeDivisions > 0 || stats.emptyDivisions > 0) && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mr-3 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-yellow-800">Division Warnings</h3>
              <ul className="mt-1 text-sm text-yellow-700 list-disc list-inside">
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
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-xs text-gray-500">Total Divisions</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.withBrackets}</div>
            <div className="text-xs text-gray-500">With Brackets</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-gray-400">{stats.total - stats.withBrackets}</div>
            <div className="text-xs text-gray-500">Without Brackets</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className={`text-2xl font-bold ${stats.smallDivisions > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
              {stats.smallDivisions}
            </div>
            <div className="text-xs text-gray-500">Small (&lt;3)</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className={`text-2xl font-bold ${stats.largeDivisions > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
              {stats.largeDivisions}
            </div>
            <div className="text-xs text-gray-500">Large (&gt;8)</div>
          </div>
        </div>
      )}

      {/* Divisions */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : divisions && divisions.length > 0 ? (
        <div className="space-y-6">
          {Object.entries(groupedDivisions || {}).map(([category, divs]) => (
            <div key={category} className="card">
              <div className="card-header flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{category}</h3>
                  <span className="text-sm text-gray-500">
                    {divs.length} division{divs.length !== 1 ? 's' : ''}
                  </span>
                </div>
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
                    <div className="flex items-center gap-3">
                      <div className={`flex items-center text-sm ${
                        div._count.assignments === 0 ? 'text-red-500' :
                        div._count.assignments < 3 ? 'text-yellow-600' :
                        div._count.assignments > 8 ? 'text-orange-600' :
                        'text-gray-500'
                      }`}>
                        <Users className="h-4 w-4 mr-1" />
                        {div._count.assignments}
                      </div>
                      {div._count.assignments === 0 && (
                        <span className="badge bg-red-100 text-red-800">Empty</span>
                      )}
                      {div._count.assignments > 0 && div._count.assignments < 3 && (
                        <span className="badge bg-yellow-100 text-yellow-800">Small</span>
                      )}
                      {div._count.assignments > 8 && (
                        <span className="badge bg-orange-100 text-orange-800">Large</span>
                      )}
                      <span
                        className={`badge ${
                          div.bracket ? 'badge-green' : 'badge-gray'
                        }`}
                      >
                        {div.bracket ? 'Bracket Ready' : 'No Bracket'}
                      </span>
                      {div._count.assignments > 8 && (
                        <button
                          onClick={() => {
                            if (confirm(`Split "${div.name}" into 2 divisions?`)) {
                              splitDivisionMutation.mutate(div.id);
                            }
                          }}
                          className="text-gray-400 hover:text-primary-600"
                          title="Split Division"
                        >
                          <Scissors className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${div.name}"?`)) {
                            deleteDivisionMutation.mutate(div.id);
                          }
                        }}
                        className="text-gray-400 hover:text-red-600"
                        title="Delete Division"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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

      {/* Preview Modal */}
      {showPreview && previewData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Division Preview</h2>
                <p className="text-sm text-gray-500">
                  {previewData.divisions.length} divisions • {previewData.totalCompetitors} competitors
                </p>
              </div>
              <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Preview Warnings */}
            {previewData.warnings.length > 0 && (
              <div className="p-4 bg-yellow-50 border-b border-yellow-200">
                <div className="flex items-start">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-yellow-800">Warnings:</p>
                    <ul className="text-sm text-yellow-700 list-disc list-inside">
                      {previewData.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Preview Stats */}
            <div className="p-4 bg-gray-50 border-b grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-xl font-bold text-gray-900">{previewData.divisions.length}</div>
                <div className="text-xs text-gray-500">Total Divisions</div>
              </div>
              <div>
                <div className="text-xl font-bold text-green-600">
                  {previewData.divisions.filter(d => d.competitorCount >= 3 && d.competitorCount <= 8).length}
                </div>
                <div className="text-xs text-gray-500">Optimal Size (3-8)</div>
              </div>
              <div>
                <div className="text-xl font-bold text-yellow-600">
                  {previewData.divisions.filter(d => d.competitorCount > 0 && d.competitorCount < 3).length}
                </div>
                <div className="text-xs text-gray-500">Small (&lt;3)</div>
              </div>
              <div>
                <div className="text-xl font-bold text-orange-600">
                  {previewData.divisions.filter(d => d.competitorCount > 8).length}
                </div>
                <div className="text-xs text-gray-500">Large (&gt;8)</div>
              </div>
            </div>

            {/* Division List */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                {previewData.divisions.map((div, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border ${
                      div.competitorCount === 0 ? 'border-red-200 bg-red-50' :
                      div.competitorCount < 3 ? 'border-yellow-200 bg-yellow-50' :
                      div.competitorCount > 8 ? 'border-orange-200 bg-orange-50' :
                      'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-gray-900">{div.name}</h4>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${
                          div.competitorCount === 0 ? 'text-red-600' :
                          div.competitorCount < 3 ? 'text-yellow-600' :
                          div.competitorCount > 8 ? 'text-orange-600' :
                          'text-green-600'
                        }`}>
                          {div.competitorCount} competitors
                        </span>
                        {div.competitorCount === 0 && (
                          <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">Empty</span>
                        )}
                        {div.competitorCount > 0 && div.competitorCount < 3 && (
                          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">Needs merge</span>
                        )}
                        {div.competitorCount > 8 && (
                          <span className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded">Will be split</span>
                        )}
                      </div>
                    </div>
                    {div.competitors.length > 0 && (
                      <div className="text-sm text-gray-600">
                        {div.competitors.slice(0, 5).map((c, i) => (
                          <span key={i}>
                            {c.name}{c.school && ` (${c.school})`}
                            {i < Math.min(div.competitors.length - 1, 4) && ', '}
                          </span>
                        ))}
                        {div.competitors.length > 5 && (
                          <span className="text-gray-400"> +{div.competitors.length - 5} more</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 border-t flex justify-end gap-3">
              <button onClick={() => setShowPreview(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={confirmGenerate}
                disabled={autoGenerateMutation.isPending}
                className="btn btn-primary"
              >
                <Check className="h-4 w-4 mr-2" />
                {autoGenerateMutation.isPending ? 'Generating...' : 'Confirm & Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
