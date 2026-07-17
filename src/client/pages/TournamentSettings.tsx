import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Settings,
  RotateCcw,
  Link as LinkIcon,
  Copy,
  Check as CheckIcon,
  Award,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Spinner from '../components/ui/Spinner';
import { getAuthHeaders } from '../context/AuthContext';
import { DEFAULT_WEIGHT_CLASSES } from '../../shared/constants/weight-classes';
import TournamentRulesEditor from '../components/TournamentRulesEditor';
import { DEFAULT_TOURNAMENT_RULES, type TournamentRules, parseTournamentRules } from '../../shared/constants/tournament-rules';
import { useToast } from '../context/ToastContext';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { Select } from '../components/ui';
import { DataTable, TableHead, TableBody } from '../components/ui';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  status: string;
  settings: string | null;
  publicSlug?: string | null;
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
  registrationFee: string;
  // F9: structured fee fields. tournamentFeeCents is a positive integer
  // (e.g. 2500 = $25.00). feeNotes is the free-text "pay at door" hint
  // that shows under the dollar amount on PublicRegister. These live
  // alongside the legacy free-text `registrationFee` field for back-compat.
  tournamentFeeCents?: number;
  feeNotes?: string;
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
  registrationFee: '',
  tournamentFeeCents: 0,
  feeNotes: '',
};

type SettingsTab = 'setup' | 'rules';

export default function TournamentSettings() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<TournamentSettings>(DEFAULT_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  // Share link state — cached locally so the UI updates without a refetch.
  // shareSlug is hydrated from the tournament record on first load.
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const { addToast } = useToast();

  // Tab state — Settings page has too many sections to be useful as a
  // single scroll. Two tabs: 'setup' (the lightweight director-facing
  // fields) and 'rules' (the rules engine — a sub-component with its
  // own save flow).
  const [tab, setTab] = useState<SettingsTab>('setup');

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

  // Hydrate shareSlug from tournament data on first load
  useEffect(() => {
    if (tournament?.publicSlug) {
      setShareSlug(tournament.publicSlug);
    }
  }, [tournament?.publicSlug]);

  const generateSlugMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/public-slug`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to generate share link');
      const data = await res.json();
      return data.publicSlug as string;
    },
    onSuccess: (slug) => {
      setShareSlug(slug);
      addToast('Share link generated', 'success');
    },
    onError: () => addToast('Failed to generate share link', 'error'),
  });

  const revokeSlugMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/public-slug`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to revoke share link');
    },
    onSuccess: () => {
      setShareSlug(null);
      setCopyState('idle');
      addToast('Share link revoked', 'success');
    },
    onError: () => addToast('Failed to revoke share link', 'error'),
  });

  const copyShareLink = async (slug: string) => {
    const url = `${window.location.origin}/scoreboard/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
      addToast('Link copied to clipboard', 'success');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      // Fallback for browsers without clipboard API permission
      addToast('Copy failed — please copy manually', 'error');
    }
  };

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
      <PageHeader
        title={`Settings - ${tournament?.name}`}
        description="Configure tournament rules and categorization"
        actions={
          <div className="flex gap-2 sm:gap-3">
            <Button variant="secondary" onClick={() => setShowResetConfirm(true)}>
              <RotateCcw className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Reset</span>
            </Button>
            <Button
              variant="primary"
              onClick={() => saveMutation.mutate(settings)}
              disabled={!hasChanges || saveMutation.isPending}
              loading={saveMutation.isPending}
            >
              <Save className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Save Settings</span>
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

      {/* Success Message */}
      {showSaveSuccess && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300">
          Settings saved successfully!
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav
          role="tablist"
          aria-label="Settings sections"
          className="flex gap-6"
        >
          <button
            type="button"
            role="tab"
            id="settings-tab-setup"
            aria-selected={tab === 'setup'}
            aria-controls="settings-panel-setup"
            onClick={() => setTab('setup')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              tab === 'setup'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            <Settings className="inline h-4 w-4 mr-1.5" />
            Setup
            <span className="ml-2 text-xs text-gray-600">(quick)</span>
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-rules"
            aria-selected={tab === 'rules'}
            aria-controls="settings-panel-rules"
            onClick={() => setTab('rules')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              tab === 'rules'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            <Award className="inline h-4 w-4 mr-1.5" />
            Categorization + Brackets
            <span className="ml-2 text-xs text-gray-600">(advanced)</span>
          </button>
        </nav>
      </div>

      {tab === 'setup' && (
        <div id="settings-panel-setup" role="tabpanel" aria-labelledby="settings-tab-setup">
      {/* General Settings */}
      <Card className="mb-6">
        <CardHeader
          title="General Settings"
          icon={Settings}
        />
        <CardBody>
          <div className="max-w-md space-y-4">
            <div>
              <Label htmlFor="division-threshold">
                Division Split Threshold
                <span className="text-gray-600 dark:text-gray-400 font-normal ml-2">
                  (max competitors per division)
                </span>
              </Label>
              <Input
                id="division-threshold"
                aria-label="Division split threshold"
                type="number"
                min="2"
                max="16"
                value={settings.divisionThreshold}
                onChange={(e) =>
                  updateSettings({ divisionThreshold: parseInt(e.target.value) || 8 })
                }
                className="w-32"
              />
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Divisions with more competitors will be split (e.g., DIV1, DIV2)
              </p>
            </div>
            <div>
              <Label htmlFor="registrationFee">
                Registration Fee Notes
                <span className="text-gray-600 dark:text-gray-400 font-normal ml-2">
                  (shown to parents during registration)
                </span>
              </Label>
              <Input
                id="registrationFee"
                type="text"
                value={settings.registrationFee}
                onChange={(e) => updateSettings({ registrationFee: e.target.value })}
                placeholder="e.g. $25, pay at door — or leave empty for free"
                maxLength={200}
              />
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Free-text note displayed on the public registration page. We don't
                process payment here — this is a "pay at the door" or "free event"
                hint.
              </p>
            </div>

            {/* F9: structured fee display. The amount is shown as "$25.00"
                on the public registration form; the notes line is the
                "pay at door" hint. Leave both blank for a free event. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="tournamentFeeCents">
                  Tournament Fee ($)
                </Label>
                <Input
                  id="tournamentFeeCents"
                  type="number"
                  min="0"
                  step="0.01"
                  data-testid="tournament-fee-cents"
                  value={
                    settings.tournamentFeeCents && settings.tournamentFeeCents > 0
                      ? (settings.tournamentFeeCents / 100).toFixed(2)
                      : ''
                  }
                  onChange={(e) => {
                    const raw = e.target.value;
                    const dollars = raw === '' ? 0 : Number(raw);
                    const cents = Number.isFinite(dollars) && dollars > 0
                      ? Math.round(dollars * 100)
                      : 0;
                    updateSettings({ tournamentFeeCents: cents });
                  }}
                  placeholder="0.00"
                />
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Shown to parents as a fee notice on the registration form.
                  Set to 0 (or leave blank) to hide the notice.
                </p>
              </div>
              <div>
                <Label htmlFor="feeNotes">
                  Fee Notes
                </Label>
                <Input
                  id="feeNotes"
                  type="text"
                  data-testid="tournament-fee-notes"
                  value={settings.feeNotes ?? ''}
                  onChange={(e) => updateSettings({ feeNotes: e.target.value })}
                  placeholder="e.g. Pay at door, cash or cheque"
                  maxLength={200}
                />
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Optional one-liner shown under the fee amount.
                </p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Share Link — public scoreboard URL */}
      <Card data-tour="settings-share-link" className="mb-6">
        <CardHeader
          title="Share Link"
          icon={LinkIcon}
          description="Generate a public read-only URL for the live scoreboard. No login required for spectators."
        />
        <CardBody>
          {shareSlug ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  id="share-link"
                  aria-label="Public scoreboard share link"
                  readOnly
                  value={`${window.location.origin}/scoreboard/${shareSlug}`}
                  className="font-mono text-sm flex-1"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  variant="outline"
                  onClick={() => copyShareLink(shareSlug)}
                  className="flex items-center gap-1.5 whitespace-nowrap"
                >
                  {copyState === 'copied' ? (
                    <>
                      <CheckIcon className="h-4 w-4 text-green-600" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> Copy
                    </>
                  )}
                </Button>
              </div>
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <a
                  href={`/scoreboard/${shareSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Open in new tab
                </a>
                <button
                  onClick={() => setRevokeOpen(true)}
                  className="text-red-600 dark:text-red-400 hover:underline"
                  type="button"
                >
                  Revoke link
                </button>
                <span className="text-gray-600 dark:text-gray-400 text-xs">
                  Anyone with this URL can view the live scoreboard.
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 flex-wrap">
              <Button
                variant="primary"
                onClick={() => generateSlugMutation.mutate()}
                disabled={generateSlugMutation.isPending}
              >
                {generateSlugMutation.isPending ? 'Generating...' : 'Generate share link'}
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Default off. Enable when ready to share with spectators.
              </span>
            </div>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        isOpen={revokeOpen}
        title="Revoke share link?"
        message="This will invalidate the current URL. Anyone with the old link will see a 'not found' page. You can generate a new link at any time."
        confirmText="Revoke"
        cancelText="Cancel"
        onConfirm={() => {
          setRevokeOpen(false);
          revokeSlugMutation.mutate();
        }}
        onClose={() => setRevokeOpen(false)}
      />

      {/* Age Groups */}
      <Card className="mb-6">
        <CardHeader
          title="Age Groups"
          action={
            <Button variant="secondary" size="sm" onClick={addAgeGroup}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          }
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <DataTable>
              <TableHead>
                <th>Label</th>
                <th>Min Age</th>
                <th>Max Age</th>
                <th></th>
              </TableHead>
              <TableBody>
                {settings.ageGroups.map((group, index) => (
                  <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td>
                      <Input
                        type="text"
                        value={group.label}
                        onChange={(e) =>
                          updateAgeGroup(index, { label: e.target.value })
                        }
                        className="w-24"
                      />
                    </td>
                    <td>
                      <Input
                        type="number"
                        min="0"
                        max="99"
                        value={group.min}
                        onChange={(e) =>
                          updateAgeGroup(index, { min: parseInt(e.target.value) || 0 })
                        }
                        className="w-20"
                      />
                    </td>
                    <td>
                      <Input
                        type="number"
                        min="0"
                        max="99"
                        value={group.max}
                        onChange={(e) =>
                          updateAgeGroup(index, { max: parseInt(e.target.value) || 99 })
                        }
                        className="w-20"
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => removeAgeGroup(index)}
                        className="text-gray-600 hover:text-red-600 dark:hover:text-red-400 touch-target"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </TableBody>
            </DataTable>
          </div>
        </CardBody>
      </Card>

      {/* Weight Classes */}
      <Card>
        <CardHeader
          title="Weight Classes"
          action={
            <Button variant="secondary" size="sm" onClick={addWeightClass}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          }
        />
        {settings.weightClasses.length === 0 ? (
          <CardBody>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              No custom weight classes. Using system defaults.
            </p>
            <Button variant="secondary" size="sm" onClick={loadDefaultWeightClasses}>
              Load Defaults
            </Button>
          </CardBody>
        ) : (
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <DataTable>
                <TableHead>
                  <th>Name</th>
                  <th>Gender</th>
                  <th>Age Min</th>
                  <th>Age Max</th>
                  <th>Min (lbs)</th>
                  <th>Max (lbs)</th>
                  <th></th>
                </TableHead>
                <TableBody>
                  {settings.weightClasses.map((wc, index) => (
                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td>
                        <Input
                          type="text"
                          value={wc.name}
                          onChange={(e) => updateWeightClass(index, { name: e.target.value })}
                          className="w-24"
                        />
                      </td>
                      <td>
                        <Select
                          value={wc.gender}
                          onChange={(e) => updateWeightClass(index, { gender: e.target.value as 'M' | 'F' | 'all' })}
                          className="w-20"
                        >
                          <option value="all">Both</option>
                          <option value="M">Male</option>
                          <option value="F">Female</option>
                        </Select>
                      </td>
                      <td>
                        <Input
                          type="number"
                          min="0"
                          max="99"
                          value={wc.ageMin}
                          onChange={(e) => updateWeightClass(index, { ageMin: parseInt(e.target.value) || 0 })}
                          className="w-16"
                        />
                      </td>
                      <td>
                        <Input
                          type="number"
                          min="0"
                          max="99"
                          value={wc.ageMax}
                          onChange={(e) => updateWeightClass(index, { ageMax: parseInt(e.target.value) || 99 })}
                          className="w-16"
                        />
                      </td>
                      <td>
                        <Input
                          type="number"
                          min="0"
                          value={wc.weightMinLbs}
                          onChange={(e) => updateWeightClass(index, { weightMinLbs: parseInt(e.target.value) || 0 })}
                          className="w-20"
                        />
                      </td>
                      <td>
                        <Input
                          type="number"
                          min="0"
                          value={wc.weightMaxLbs}
                          onChange={(e) => updateWeightClass(index, { weightMaxLbs: parseInt(e.target.value) || 999 })}
                          className="w-20"
                        />
                      </td>
                      <td>
                        <button
                          onClick={() => removeWeightClass(index)}
                          className="text-gray-600 hover:text-red-600 dark:hover:text-red-400 touch-target"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </TableBody>
              </DataTable>
            </div>
          </CardBody>
        )}
      </Card>
        </div>
      )}

      {/* Tournament Rules (v2) */}
      {tab === 'rules' && (
        <div id="settings-panel-rules" role="tabpanel" aria-labelledby="settings-tab-rules">
          <Card className="mt-6">
            <CardHeader
              title="Tournament Rules"
              description="The full rules engine that drives division categorization, bracket generation, and merging. Matches the workflow used in the Newton's Championship 2025 .xlsm (CB/BB tiers, 8 age bands, 3-4 weight classes)."
            />
            <CardBody>
              <RulesManager
                tournamentId={id!}
                tournamentSettings={tournament?.settings}
                onRulesChange={setHasChanges}
              />
            </CardBody>
          </Card>
        </div>
      )}

      {/* Unsaved Changes Warning */}
      {hasChanges && (
        <div className="fixed bottom-4 right-4 bg-yellow-100 dark:bg-yellow-900/80 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
          <span className="text-sm">You have unsaved changes</span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => saveMutation.mutate(settings)}
          >
            Save
          </Button>
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
        <Button
          variant="primary"
          onClick={() => saveMutation.mutate(rules)}
          disabled={saving || saveMutation.isPending}
          loading={saveMutation.isPending}
        >
          {saveMutation.isPending ? <Spinner size="sm" className="mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Rules
        </Button>
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
