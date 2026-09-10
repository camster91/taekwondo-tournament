import { useState } from 'react';
import { memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Shield,
  Plus,
  Trash2,
  ArrowLeft,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  Play,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Send,
  Check,
  X,
  PenLine,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FairnessRule {
  id: string;
  tournamentId: string;
  name: string;
  description: string | null;
  ruleType: string;
  enforcementLevel: 'hard' | 'soft' | 'info';
  category: string | null;
  parameters: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ParseResult {
  name: string;
  ruleType: string;
  enforcementLevel: 'hard' | 'soft' | 'info';
  parameters: Record<string, unknown>;
  description: string;
  confidence: number;
  suggestion?: string;
}

interface EvaluationIssue {
  ruleId?: string;
  ruleName: string;
  severity: 'violation' | 'warning' | 'info';
  description: string;
  affectedCompetitors?: string[];
  suggestion?: string;
}

/**
 * Isolated input for the natural-language parser.
 *
 * Extracted from the parent so per-keystroke re-renders stay local.
 * Without this split, every character typed into the input re-rendered
 * the entire 950-LOC FairnessRules component (active-rules list,
 * evaluation card, IssueSection tree) even though only this small
 * fragment needed to update. Wrapped in React.memo so the parent
 * state churn (parse result, rule list, eval result) doesn't push
 * re-renders back into the input unless props actually change.
 */
const NaturalLanguageInput = memo(function NaturalLanguageInput({
  onSubmit,
  isPending,
}: {
  onSubmit: (text: string) => void;
  isPending: boolean;
}) {
  const [nlInput, setNlInput] = useState('');

  function handleSubmit() {
    const trimmed = nlInput.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    // Clear the input immediately on submit. The parent's parse
    // result panel renders below with the outcome; if the user
    // wants to retry, they retype.
    setNlInput('');
  }

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={nlInput}
        onChange={(e) => setNlInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
        }}
        placeholder="e.g. Competitors from the same school should not fight each other in the first round"
        className="input flex-1"
        aria-label="Describe a rule in plain English"
      />
      <button
        onClick={handleSubmit}
        disabled={isPending || !nlInput.trim()}
        className="btn btn-primary"
        aria-label="Parse rule"
      >
        {isPending ? <Spinner size="sm" /> : <Send className="h-4 w-4" />}
      </button>
    </div>
  );
});

interface EvaluationResult {
  score: number;
  passed: boolean;
  issues: EvaluationIssue[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RULE_TYPE_OPTIONS = [
  { value: 'same_school_avoidance', label: 'Same School Avoidance' },
  { value: 'weight_tolerance', label: 'Weight Tolerance' },
  { value: 'height_limit', label: 'Height Limit' },
  { value: 'experience_grouping', label: 'Experience Grouping' },
  { value: 'min_division_size', label: 'Minimum Division Size' },
];

const ENFORCEMENT_OPTIONS = [
  { value: 'hard', label: 'Hard', color: 'text-danger' },
  { value: 'soft', label: 'Soft', color: 'text-warning' },
  { value: 'info', label: 'Info', color: 'text-info' },
];

const RULE_PARAM_FIELDS: Record<string, { key: string; label: string; type: string; placeholder: string }[]> = {
  same_school_avoidance: [
    { key: 'maxSameSchool', label: 'Max Same School in Bracket', type: 'number', placeholder: '2' },
  ],
  weight_tolerance: [
    { key: 'tolerancePercent', label: 'Tolerance (%)', type: 'number', placeholder: '10' },
    { key: 'maxDifferenceLbs', label: 'Max Difference (lbs)', type: 'number', placeholder: '15' },
  ],
  height_limit: [
    { key: 'maxDifferenceInches', label: 'Max Height Difference (inches)', type: 'number', placeholder: '6' },
  ],
  experience_grouping: [
    { key: 'maxYearsSpread', label: 'Max Years of Experience Spread', type: 'number', placeholder: '3' },
  ],
  min_division_size: [
    { key: 'minCompetitors', label: 'Minimum Competitors', type: 'number', placeholder: '3' },
  ],
};

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function EnforcementBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    hard: 'bg-danger/10 text-danger dark:bg-danger/20 dark:text-danger',
    soft: 'bg-warning/10 text-warning dark:bg-warning/30 dark:text-warning',
    info: 'bg-info/10 text-info dark:bg-info/30 dark:text-info',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${styles[level] || styles.info}`}>
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  );
}

function scoreToGrade(score: number): { grade: string; color: string } {
  if (score >= 90) return { grade: 'A', color: 'text-success dark:text-success' };
  if (score >= 80) return { grade: 'B', color: 'text-info dark:text-info' };
  if (score >= 70) return { grade: 'C', color: 'text-warning dark:text-warning' };
  if (score >= 60) return { grade: 'D', color: 'text-orange-600 dark:text-orange-400' };
  return { grade: 'F', color: 'text-danger dark:text-danger' };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FairnessRules() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  // ---- State ----
  const [deleteTarget, setDeleteTarget] = useState<FairnessRule | null>(null);
  // Note: nlInput state lives inside <NaturalLanguageInput/> so
  // keystrokes don't re-render this 950-LOC component. See the
  // child component's docs.
  const [parseResult, setParsedResult] = useState<ParseResult | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualRuleType, setManualRuleType] = useState(RULE_TYPE_OPTIONS[0].value);
  const [manualEnforcement, setManualEnforcement] = useState<'hard' | 'soft' | 'info'>('soft');
  const [manualParams, setManualParams] = useState<Record<string, string>>({});
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    violations: true,
    warnings: true,
    info: false,
  });

  // ---- Queries ----

  const {
    data: rules,
    isLoading: rulesLoading,
    error: rulesError,
  } = useQuery<FairnessRule[]>({
    queryKey: ['fairness-rules', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/rules/tournament/${tournamentId}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch rules');
      return res.json();
    },
  });

  // ---- Mutations ----

  const initDefaultsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/rules/tournament/${tournamentId}/defaults`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error('Failed to initialize default rules');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fairness-rules', tournamentId] });
      addToast('Default rules initialized', 'success');
    },
    onError: () => addToast('Failed to initialize defaults', 'error'),
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) => {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle rule');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fairness-rules', tournamentId] });
    },
    onError: () => addToast('Failed to update rule', 'error'),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete rule');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fairness-rules', tournamentId] });
      addToast('Rule deleted', 'success');
      setDeleteTarget(null);
    },
    onError: () => addToast('Failed to delete rule', 'error'),
  });

  const parseMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(`/api/rules/tournament/${tournamentId}/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('Failed to parse rule');
      return res.json() as Promise<ParseResult>;
    },
    onSuccess: (data) => {
      setParsedResult(data);
    },
    onError: () => addToast('Failed to parse rule text', 'error'),
  });

  const createRuleMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      ruleType: string;
      enforcementLevel: string;
      parameters: Record<string, unknown>;
      description?: string;
    }) => {
      const res = await fetch(`/api/rules/tournament/${tournamentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to create rule');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fairness-rules', tournamentId] });
      addToast('Rule created', 'success');
      setParsedResult(null);
      setManualParams({});
    },
    onError: () => addToast('Failed to create rule', 'error'),
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/rules/tournament/${tournamentId}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error('Failed to run evaluation');
      return res.json() as Promise<EvaluationResult>;
    },
    onSuccess: (data) => {
      setEvaluationResult(data);
    },
    onError: () => addToast('Failed to run evaluation', 'error'),
  });

  // ---- Handlers ----

  function handleAcceptParsed() {
    if (!parseResult) return;
    createRuleMutation.mutate({
      name: parseResult.name,
      ruleType: parseResult.ruleType,
      enforcementLevel: parseResult.enforcementLevel,
      parameters: parseResult.parameters,
      description: parseResult.description,
    });
  }

  function handleManualSubmit() {
    const ruleTypeLabel = RULE_TYPE_OPTIONS.find((o) => o.value === manualRuleType)?.label || manualRuleType;
    const params: Record<string, unknown> = {};
    const fields = RULE_PARAM_FIELDS[manualRuleType] || [];
    for (const field of fields) {
      const val = manualParams[field.key];
      if (val) {
        params[field.key] = field.type === 'number' ? Number(val) : val;
      }
    }
    createRuleMutation.mutate({
      name: ruleTypeLabel,
      ruleType: manualRuleType,
      enforcementLevel: manualEnforcement,
      parameters: params,
      description: `${ruleTypeLabel} (${manualEnforcement})`,
    });
    setShowManualForm(false);
  }

  function toggleSection(section: string) {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  // ---- Derived data ----

  const violations = evaluationResult?.issues.filter((i) => i.severity === 'violation') || [];
  const warnings = evaluationResult?.issues.filter((i) => i.severity === 'warning') || [];
  const infos = evaluationResult?.issues.filter((i) => i.severity === 'info') || [];

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to={`/tournaments/${tournamentId}`}
            className="text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary-500" />
              Fairness Rules
            </h1>
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Manage rules that govern fair matchmaking and division balance
            </p>
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* Section A: Active Rules List */}
      {/* ================================================================== */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Active Rules</h2>
            {rules && rules.length === 0 && (
              <button
                onClick={() => initDefaultsMutation.mutate()}
                disabled={initDefaultsMutation.isPending}
                className="btn btn-primary"
              >
                {initDefaultsMutation.isPending ? (
                  <Spinner size="sm" className="mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Initialize Default Rules
              </button>
            )}
          </div>

          {rulesLoading ? (
            <div className="space-y-3">
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : rulesError ? (
            <EmptyState
              icon={AlertCircle}
              title="Couldn't load rules"
              description="The server returned an error. Try refreshing the page."
              action={{
                label: 'Retry',
                onClick: () =>
                  queryClient.invalidateQueries({ queryKey: ['fairness-rules', tournamentId] }),
              }}
            />
          ) : !rules || rules.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="No rules configured"
              description="Initialize default rules or add custom ones below."
              action={{
                label: 'Initialize Defaults',
                onClick: () => initDefaultsMutation.mutate(),
              }}
            />
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`border rounded-lg p-4 transition-colors ${
                    rule.enabled
                      ? 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900'
                      : 'border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-surface-900 dark:text-white">
                          {rule.name}
                        </h3>
                        <EnforcementBadge level={rule.enforcementLevel} />
                        {rule.category && (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300">
                            {rule.category}
                          </span>
                        )}
                      </div>
                      {rule.description && (
                        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                          {rule.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          toggleRuleMutation.mutate({
                            ruleId: rule.id,
                            enabled: !rule.enabled,
                          })
                        }
                        className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800"
                        title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                      >
                        {rule.enabled ? (
                          <ToggleRight className="h-6 w-6 text-success" />
                        ) : (
                          <ToggleLeft className="h-6 w-6 text-surface-400" />
                        )}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(rule)}
                        className="p-1 rounded text-danger hover:text-danger hover:bg-danger/10 dark:hover:bg-danger/20"
                        title="Delete rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* Section B: Add Rule */}
      {/* ================================================================== */}
      <div className="card">
        <div className="card-body">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">
            Add Rule
          </h2>

          {/* Natural Language Input */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent-500" />
              Natural Language Input
            </h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
              Describe a rule in plain English and we will parse it automatically.
            </p>
            <NaturalLanguageInput
              onSubmit={(text) => parseMutation.mutate(text)}
              isPending={parseMutation.isPending}
            />

            {/* Parse result */}
            {parseResult && (
              <div className="mt-4 border rounded-lg p-4 bg-surface-50 dark:bg-surface-900 dark:border-surface-700">
                {parseResult.confidence < 0.5 ? (
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-surface-900 dark:text-white">
                        Could not parse this rule
                      </p>
                      {parseResult.suggestion && (
                        <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                          Suggestion: {parseResult.suggestion}
                        </p>
                      )}
                      <button
                        onClick={() => setParsedResult(null)}
                        className="btn btn-secondary mt-3"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium text-surface-900 dark:text-white">
                        Parsed Rule
                      </p>
                      <span className="text-xs text-surface-500 dark:text-surface-400">
                        Confidence: {Math.round(parseResult.confidence * 100)}%
                      </span>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex gap-2">
                        <span className="text-surface-500 dark:text-surface-400 w-28 shrink-0">Name:</span>
                        <span className="text-surface-900 dark:text-white">{parseResult.name}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-surface-500 dark:text-surface-400 w-28 shrink-0">Type:</span>
                        <span className="text-surface-900 dark:text-white">{parseResult.ruleType}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-surface-500 dark:text-surface-400 w-28 shrink-0">Enforcement:</span>
                        <EnforcementBadge level={parseResult.enforcementLevel} />
                      </div>
                      <div className="flex gap-2">
                        <span className="text-surface-500 dark:text-surface-400 w-28 shrink-0">Description:</span>
                        <span className="text-surface-900 dark:text-white">{parseResult.description}</span>
                      </div>
                      {Object.keys(parseResult.parameters).length > 0 && (
                        <div className="flex gap-2">
                          <span className="text-surface-500 dark:text-surface-400 w-28 shrink-0">Parameters:</span>
                          <span className="text-surface-900 dark:text-white font-mono text-xs">
                            {JSON.stringify(parseResult.parameters)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={handleAcceptParsed}
                        disabled={createRuleMutation.isPending}
                        className="btn btn-primary"
                      >
                        {createRuleMutation.isPending ? (
                          <Spinner size="sm" className="mr-2" />
                        ) : (
                          <Check className="h-4 w-4 mr-2" />
                        )}
                        Accept
                      </button>
                      <button
                        onClick={() => {
                          // Pre-populate manual form with parsed result
                          setManualRuleType(parseResult!.ruleType);
                          setManualEnforcement(parseResult!.enforcementLevel);
                          const params: Record<string, string> = {};
                          for (const [k, v] of Object.entries(parseResult!.parameters)) {
                            params[k] = String(v);
                          }
                          setManualParams(params);
                          setShowManualForm(true);
                          setParsedResult(null);
                        }}
                        className="btn btn-secondary"
                      >
                        <PenLine className="h-4 w-4 mr-2" />
                        Edit
                      </button>
                      <button
                        onClick={() => setParsedResult(null)}
                        className="btn btn-secondary"
                      >
                        <X className="h-4 w-4 mr-2" />
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-surface-200 dark:border-surface-700" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white dark:bg-surface-900 px-2 text-surface-500 dark:text-surface-400">
                or
              </span>
            </div>
          </div>

          {/* Manual Rule Builder */}
          {!showManualForm ? (
            <button
              onClick={() => setShowManualForm(true)}
              className="btn btn-secondary w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Manual Rule Builder
            </button>
          ) : (
            <div className="border rounded-lg p-4 bg-surface-50 dark:bg-surface-900 dark:border-surface-700">
              <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-4 flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Manual Rule Builder
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    Rule Type
                  </label>
                  <select
                    value={manualRuleType}
                    onChange={(e) => {
                      setManualRuleType(e.target.value);
                      setManualParams({});
                    }}
                    className="input w-full"
                  >
                    {RULE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    Enforcement Level
                  </label>
                  <select
                    value={manualEnforcement}
                    onChange={(e) =>
                      setManualEnforcement(e.target.value as 'hard' | 'soft' | 'info')
                    }
                    className="input w-full"
                  >
                    {ENFORCEMENT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dynamic parameter fields */}
              {RULE_PARAM_FIELDS[manualRuleType] && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {RULE_PARAM_FIELDS[manualRuleType].map((field) => (
                    <div key={field.key}>
                      <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                        {field.label}
                      </label>
                      <input
                        type={field.type}
                        value={manualParams[field.key] || ''}
                        onChange={(e) =>
                          setManualParams((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        placeholder={field.placeholder}
                        className="input w-full"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleManualSubmit}
                  disabled={createRuleMutation.isPending}
                  className="btn btn-primary"
                >
                  {createRuleMutation.isPending ? (
                    <Spinner size="sm" className="mr-2" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Save Rule
                </button>
                <button
                  onClick={() => {
                    setShowManualForm(false);
                    setManualParams({});
                  }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* Section C: Fairness Evaluation Report */}
      {/* ================================================================== */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">
              Fairness Evaluation
            </h2>
            <button
              onClick={() => evaluateMutation.mutate()}
              disabled={evaluateMutation.isPending}
              className="btn btn-primary"
            >
              {evaluateMutation.isPending ? (
                <Spinner size="sm" className="mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run Evaluation
            </button>
          </div>

          {evaluateMutation.isPending && (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" className="text-primary-500" />
              <span className="ml-3 text-surface-500 dark:text-surface-400">Evaluating fairness...</span>
            </div>
          )}

          {evaluationResult && !evaluateMutation.isPending && (
            <div className="space-y-6">
              {/* Score + Pass/Fail */}
              <div className="flex flex-col sm:flex-row items-center gap-6 p-6 bg-surface-50 dark:bg-surface-900 rounded-lg">
                <div className="text-center">
                  <div className={`text-6xl font-bold ${scoreToGrade(evaluationResult.score).color}`}>
                    {Math.round(evaluationResult.score)}
                  </div>
                  <div className={`text-2xl font-semibold mt-1 ${scoreToGrade(evaluationResult.score).color}`}>
                    Grade: {scoreToGrade(evaluationResult.score).grade}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    {evaluationResult.passed ? (
                      <>
                        <CheckCircle className="h-6 w-6 text-success" />
                        <span className="text-lg font-semibold text-success dark:text-success">
                          Evaluation Passed
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-6 w-6 text-danger" />
                        <span className="text-lg font-semibold text-danger dark:text-danger">
                          Evaluation Failed
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span className="text-danger dark:text-danger">
                      {violations.length} violation{violations.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-warning dark:text-warning">
                      {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-info dark:text-info">
                      {infos.length} info
                    </span>
                  </div>
                </div>
              </div>

              {/* Violations */}
              {violations.length > 0 && (
                <IssueSection
                  title="Violations"
                  icon={<AlertCircle className="h-5 w-5 text-danger" />}
                  issues={violations}
                  borderColor="border-danger/30 dark:border-danger/50"
                  bgColor="bg-danger/10 dark:bg-danger/10"
                  expanded={expandedSections.violations}
                  onToggle={() => toggleSection('violations')}
                />
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <IssueSection
                  title="Warnings"
                  icon={<AlertTriangle className="h-5 w-5 text-warning" />}
                  issues={warnings}
                  borderColor="border-warning/30 dark:border-warning/50"
                  bgColor="bg-warning/10 dark:bg-warning/10"
                  expanded={expandedSections.warnings}
                  onToggle={() => toggleSection('warnings')}
                />
              )}

              {/* Info */}
              {infos.length > 0 && (
                <IssueSection
                  title="Info"
                  icon={<Info className="h-5 w-5 text-info" />}
                  issues={infos}
                  borderColor="border-info/30 dark:border-info/50"
                  bgColor="bg-info/10 dark:bg-info/10"
                  expanded={expandedSections.info}
                  onToggle={() => toggleSection('info')}
                />
              )}

              {evaluationResult.issues.length === 0 && (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-success mx-auto mb-3" />
                  <p className="text-surface-700 dark:text-surface-300 font-medium">
                    No issues found. All rules passed.
                  </p>
                </div>
              )}
            </div>
          )}

          {!evaluationResult && !evaluateMutation.isPending && (
            <div className="text-center py-12 text-surface-500 dark:text-surface-400">
              <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Run an evaluation to check tournament fairness against configured rules.</p>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteRuleMutation.mutate(deleteTarget.id)}
        title="Delete Rule"
        message={`Are you sure you want to delete the rule "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        isLoading={deleteRuleMutation.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue Section sub-component
// ---------------------------------------------------------------------------

function IssueSection({
  title,
  icon,
  issues,
  borderColor,
  bgColor,
  expanded,
  onToggle,
}: {
  title: string;
  icon: React.ReactNode;
  issues: EvaluationIssue[];
  borderColor: string;
  bgColor: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`border rounded-lg ${borderColor}`}>
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between p-4 ${bgColor} rounded-t-lg`}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-surface-900 dark:text-white">
            {title} ({issues.length})
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-surface-500" />
        ) : (
          <ChevronDown className="h-4 w-4 text-surface-500" />
        )}
      </button>
      {expanded && (
        <div className="divide-y divide-surface-100 dark:divide-surface-700">
          {issues.map((issue, idx) => (
            <div key={idx} className="p-4">
              <p className="text-sm font-medium text-surface-900 dark:text-white">
                {issue.ruleName}
              </p>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                {issue.description}
              </p>
              {issue.affectedCompetitors && issue.affectedCompetitors.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">
                    Affected Competitors:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {issue.affectedCompetitors.map((name, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2 py-0.5 text-xs rounded bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {issue.suggestion && (
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-2 italic">
                  Suggestion: {issue.suggestion}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
