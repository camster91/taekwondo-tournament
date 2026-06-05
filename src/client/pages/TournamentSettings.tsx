import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Settings,
  RotateCcw,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Spinner from '../components/ui/Spinner';
import { getAuthHeaders } from '../context/AuthContext';
import { DEFAULT_WEIGHT_CLASSES } from '../../shared/constants/weight-classes';
import TournamentRulesEditor from '../components/TournamentRulesEditor';
import { DEFAULT_TOURNAMENT_RULES, type TournamentRules, parseTournamentRules } from '../../shared/constants/tournament-rules';
import { useToast } from '../context/ToastContext';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  status: string;
  settings: string | null;
}

interface AgeGroup {
  min: number;
  max: number;
  label: string;
}

interface WeightClass {
  name: string;
  gender: 'M' | 'F' | 'all';
  ageMin: number;
  ageMax: number;
  weightMinLbs: number;
  weightMaxLbs: number;
}

interface TournamentSettings {
  divisionThreshold: number;
  ageGroups: AgeGroup[];
  weightClasses: WeightClass[];
}

const DEFAULT_AGE_GROUPS: AgeGroup[] = [
  { min: 4, max: 5, label: '4-5' },
  { min: 6, max: 7, label: '6-7' },
  { min: 8, max: 9, label: '8-9' },
  { min: 10, max: 11, label: '10-11' },
  { min: 12, max: 14, label: '12-14' },
  { min: 15, max: 17, label: '15-17' },
  { min: 18, max: 35, label: '18-35' },
  { min: 36, max: 99, label: '36+' },
];

const DEFAULT_SETTINGS: TournamentSettings = {
  divisionThreshold: 8,
  ageGroups: DEFAULT_AGE_GROUPS,
  weightClasses: [],
};

export default function TournamentSettings() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<TournamentSettings>(DEFAULT_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  const { data: tournament, isLoading } = useQuery<Tournament>({
    queryKey: ['tournament', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournament');
      return res.json();
    },
  });

  // Load settings from tournament
  useEffect(() => {
    if (tournament?.settings) {
      try {
        const parsed = JSON.parse(tournament.settings);
        setSettings({
          ...DEFAULT_SETTINGS,
          ...parsed,
        });
      } catch {
        setSettings(DEFAULT_SETTINGS);
      }
    }
  }, [tournament]);

  const saveMutation = useMutation({
    mutationFn: async (newSettings: TournamentSettings) => {
      // Save tournament settings JSON
      const res = await fetch(`/api/tournaments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ settings: newSettings }),
      });
      if (!res.ok) throw new Error('Failed to save settings');

      // Also persist weight classes to the DB if any are defined
      if (newSettings.weightClasses.length > 0) {
        await fetch(`/api/tournaments/${id}/weight-classes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ weightClasses: newSettings.weightClasses }),
        });
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setHasChanges(false);
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 3000);
    },
  });

  const updateSettings = (updates: Partial<TournamentSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
    setHasChanges(true);
  };

  const addAgeGroup = () => {
    const newGroup: AgeGroup = {
      min: 0,
      max: 99,
      label: 'New Group',
    };
    updateSettings({
      ageGroups: [...settings.ageGroups, newGroup],
    });
  };

  const updateAgeGroup = (index: number, updates: Partial<AgeGroup>) => {
    const newGroups = [...settings.ageGroups];
    newGroups[index] = { ...newGroups[index], ...updates };
    // Auto-generate label
    if (updates.min !== undefined || updates.max !== undefined) {
      const group = newGroups[index];
      group.label = group.max >= 99 ? `${group.min}+` : `${group.min}-${group.max}`;
    }
    updateSettings({ ageGroups: newGroups });
  };

  const removeAgeGroup = (index: number) => {
    const newGroups = settings.ageGroups.filter((_, i) => i !== index);
    updateSettings({ ageGroups: newGroups });
  };

  const resetToDefaults = () => {
    setSettings(DEFAULT_SETTINGS);
    setHasChanges(true);
    setShowResetConfirm(false);
  };

  const addWeightClass = () => {
    const newWc = { name: 'New', gender: 'all' as const, ageMin: 0, ageMax: 99, weightMinLbs: 0, weightMaxLbs: 999 };
    updateSettings({ weightClasses: [...settings.weightClasses, newWc] });
  };

  const updateWeightClass = (index: number, updates: Partial<WeightClass>) => {
    const newWcs = [...settings.weightClasses];
    newWcs[index] = { ...newWcs[index], ...updates };
    updateSettings({ weightClasses: newWcs });
  };

  const removeWeightClass = (index: number) => {
    updateSettings({ weightClasses: settings.weightClasses.filter((_, i) => i !== index) });
  };

  const loadDefaultWeightClasses = () => {
    const defaults = DEFAULT_WEIGHT_CLASSES.map(wc => ({
      name: wc.name,
      gender: (wc.gender || 'all') as 'M' | 'F' | 'all',
      ageMin: wc.ageMin,
      ageMax: wc.ageMax,
      weightMinLbs: wc.weightMinLbs,
      weightMaxLbs: wc.weightMaxLbs,
    }));
    updateSettings({ weightClasses: defaults });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

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
            Settings - {tournament?.name}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure tournament rules and categorization
          </p>
        </div>
        <div className="flex gap-2 sm:gap-3">
          <button onClick={() => setShowResetConfirm(true)} className="btn btn-secondary">
            <RotateCcw className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <button
            onClick={() => saveMutation.mutate(settings)}
            disabled={!hasChanges || saveMutation.isPending}
            className="btn btn-primary flex items-center"
          >
            {saveMutation.isPending ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Save Settings</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Success Message */}
      {showSaveSuccess && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300">
          Settings saved successfully!
        </div>
      )}

      {/* General Settings */}
      <div className="card mb-6">
        <div className="card-header">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
            <Settings className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
            General Settings
          </h2>
        </div>
        <div className="card-body">
          <div className="max-w-md">
            <label className="form-label">
              Division Split Threshold
              <span className="text-gray-500 dark:text-gray-400 font-normal ml-2">
                (max competitors per division)
              </span>
            </label>
            <input
              type="number"
              min="2"
              max="16"
              value={settings.divisionThreshold}
              onChange={(e) =>
                updateSettings({ divisionThreshold: parseInt(e.target.value) || 8 })
              }
              className="form-input w-32"
            />
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Divisions with more competitors will be split (e.g., DIV1, DIV2)
            </p>
          </div>
        </div>
      </div>

      {/* Age Groups */}
      <div className="card mb-6">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Age Groups</h2>
          <button onClick={addAgeGroup} className="btn btn-secondary text-sm">
            <Plus className="h-4 w-4 mr-1" />
            Add
          </button>
        </div>
        <div className="card-body p-0 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Min Age</th>
                <th>Max Age</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
              {settings.ageGroups.map((group, index) => (
                <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td>
                    <input
                      type="text"
                      value={group.label}
                      onChange={(e) =>
                        updateAgeGroup(index, { label: e.target.value })
                      }
                      className="form-input w-24"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={group.min}
                      onChange={(e) =>
                        updateAgeGroup(index, { min: parseInt(e.target.value) || 0 })
                      }
                      className="form-input w-20"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={group.max}
                      onChange={(e) =>
                        updateAgeGroup(index, { max: parseInt(e.target.value) || 99 })
                      }
                      className="form-input w-20"
                    />
                  </td>
                  <td>
                    <button
                      onClick={() => removeAgeGroup(index)}
                      className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 touch-target"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Weight Classes */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Weight Classes</h2>
          <button onClick={addWeightClass} className="btn btn-secondary text-sm">
            <Plus className="h-4 w-4 mr-1" />
            Add
          </button>
        </div>
        {settings.weightClasses.length === 0 ? (
          <div className="card-body">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              No custom weight classes. Using system defaults.
            </p>
            <button
              onClick={loadDefaultWeightClasses}
              className="btn btn-secondary text-sm"
            >
              Load Defaults
            </button>
          </div>
        ) : (
          <div className="card-body p-0 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Gender</th>
                  <th>Age Min</th>
                  <th>Age Max</th>
                  <th>Min (lbs)</th>
                  <th>Max (lbs)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                {settings.weightClasses.map((wc, index) => (
                  <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td>
                      <input type="text" value={wc.name}
                        onChange={(e) => updateWeightClass(index, { name: e.target.value })}
                        className="form-input w-24" />
                    </td>
                    <td>
                      <select value={wc.gender}
                        onChange={(e) => updateWeightClass(index, { gender: e.target.value as 'M' | 'F' | 'all' })}
                        className="form-input w-20">
                        <option value="all">Both</option>
                        <option value="M">Male</option>
                        <option value="F">Female</option>
                      </select>
                    </td>
                    <td><input type="number" min="0" max="99" value={wc.ageMin}
                      onChange={(e) => updateWeightClass(index, { ageMin: parseInt(e.target.value) || 0 })}
                      className="form-input w-16" /></td>
                    <td><input type="number" min="0" max="99" value={wc.ageMax}
                      onChange={(e) => updateWeightClass(index, { ageMax: parseInt(e.target.value) || 99 })}
                      className="form-input w-16" /></td>
                    <td><input type="number" min="0" value={wc.weightMinLbs}
                      onChange={(e) => updateWeightClass(index, { weightMinLbs: parseInt(e.target.value) || 0 })}
                      className="form-input w-20" /></td>
                    <td><input type="number" min="0" value={wc.weightMaxLbs}
                      onChange={(e) => updateWeightClass(index, { weightMaxLbs: parseInt(e.target.value) || 999 })}
                      className="form-input w-20" /></td>
                    <td>
                      <button onClick={() => removeWeightClass(index)}
                        className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 touch-target">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tournament Rules (v2) */}
      <div className="card mb-6">
        <div className="card-header flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">Tournament Rules</h2>
            <p className="text-xs text-gray-500 mt-1">
              The full rules engine that drives division categorization, bracket generation, and merging.
              Matches the workflow used in the Newton's Championship 2025 .xlsm (CB/BB tiers, 8 age bands, 3-4 weight classes).
            </p>
          </div>
        </div>
        <div className="card-body">
          <RulesManager
            tournamentId={id!}
            tournamentSettings={tournament?.settings}
            onRulesChange={setHasChanges}
          />
        </div>
      </div>

      {/* Unsaved Changes Warning */}
      {hasChanges && (
        <div className="fixed bottom-4 right-4 bg-yellow-100 dark:bg-yellow-900/80 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
          <span className="text-sm">You have unsaved changes</span>
          <button
            onClick={() => saveMutation.mutate(settings)}
            className="btn btn-primary text-sm py-1.5 px-3"
          >
            Save
          </button>
        </div>
      )}

      {/* Reset Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={resetToDefaults}
        title="Reset Settings"
        message="Are you sure you want to reset all settings to defaults? This will discard any custom age groups."
        confirmText="Reset to Defaults"
        variant="warning"
      />
    </div>
  );
}

// ─── Rules Manager (sub-component) ─────────────────────────────────────
function RulesManager({
  tournamentId,
  tournamentSettings,
  onRulesChange,
}: {
  tournamentId: string;
  tournamentSettings: string | null | undefined;
  onRulesChange: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [rules, setRules] = useState<TournamentRules>(() => parseTournamentRules(tournamentSettings));
  const [saving, setSaving] = useState(false);
  const [showResetRulesConfirm, setShowResetRulesConfirm] = useState(false);

  // Re-init when tournamentSettings changes (e.g. after save)
  useEffect(() => {
    setRules(parseTournamentRules(tournamentSettings));
  }, [tournamentSettings]);

  const saveMutation = useMutation({
    mutationFn: async (next: TournamentRules) => {
      const res = await fetch(`/api/tournaments/${tournamentId}/rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ rules: next }),
      });
      if (!res.ok) throw new Error('Failed to save rules');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament', tournamentId] });
      onRulesChange(false);
      addToast('Tournament rules saved', 'success');
    },
    onError: () => addToast('Failed to save rules', 'error'),
  });

  const resetRulesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/rules/reset`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error('Failed to reset rules');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament', tournamentId] });
      onRulesChange(false);
      addToast('Rules reset to defaults', 'success');
    },
  });

  const handleChange = (next: TournamentRules) => {
    setRules(next);
    onRulesChange(true);
  };

  return (
    <div>
    <TournamentRulesEditor
      rules={rules}
      onChange={handleChange}
      onReset={() => setShowResetRulesConfirm(true)}
    />
    <div className="mt-4 flex justify-end gap-2">
      <button
        onClick={() => saveMutation.mutate(rules)}
        disabled={saving || saveMutation.isPending}
        className="btn btn-primary"
      >
        {saveMutation.isPending ? <Spinner size="sm" className="mr-2" /> : <Save className="h-4 w-4 mr-2" />}
        Save Rules
      </button>
    </div>
    <ConfirmDialog
      isOpen={showResetRulesConfirm}
      onClose={() => setShowResetRulesConfirm(false)}
      onConfirm={async () => {
        setShowResetRulesConfirm(false);
        await resetRulesMutation.mutateAsync();
      }}
      title="Reset Tournament Rules"
      message="Are you sure you want to reset the tournament rules to defaults? This won't affect divisions you've already generated."
      confirmText="Reset Rules"
      variant="warning"
    />
    </div>
    );
    }
