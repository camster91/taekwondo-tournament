import { useState, useEffect, useRef } from 'react';
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
  AlertCircle,
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
import { saveTournamentSettingsRequest } from '../utils/tournament-settings-save';
import { 
  getSaveStateLabel, 
  getSaveStateVariant, 
  shouldBlockNavigation, 
  getBeforeUnloadMessage,
  type SaveState 
} from '../utils/tournament-settings-state';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  status: string;
  settings: string | null;
  publicSlug?: string | null;
  publicScoreboardRefreshMs?: number | null;
  maxCapacity?: number | null;
  waitlistEnabled?: boolean;
  eventSlug?: string | null;
  portalPublished?: boolean;
  organizationId?: string | null;
  organization?: {
    slug: string;
  } | null;
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

type SettingsTab = 'setup' | 'rules' | 'branding';

interface BrandingSettings {
  brandName: string;
  brandPrimaryColor: string;
  brandLogoUrl: string;
}

export default function TournamentSettings() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<TournamentSettings>(DEFAULT_SETTINGS);
  const [saveState, setSaveState] = useState<SaveState>('clean');
  const [saveError, setSaveError] = useState<string>('');
  const setupDirtyRef = useRef(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Branding state
  const [branding, setBranding] = useState<BrandingSettings>({
    brandName: '',
    brandPrimaryColor: '#DC2626',
    brandLogoUrl: '',
  });
  const [brandingDirty, setBrandingDirty] = useState(false);
  const [brandingLoading, setBrandingLoading] = useState(false);

  // Share link state — cached locally so the UI updates without a refetch.
  // shareSlug is hydrated from the tournament record on first load.
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  
  // Public scoreboard refresh interval state
  const [refreshMs, setRefreshMs] = useState<number>(10000); // Default 10s
  const [refreshMsDirty, setRefreshMsDirty] = useState(false);

  // Capacity & waitlist state (#191)
  const [maxCapacity, setMaxCapacity] = useState<number | null>(null);
  const [waitlistEnabled, setWaitlistEnabled] = useState<boolean>(false);
  const [capacityDirty, setCapacityDirty] = useState(false);

  // Portal state — event slug and publication status
  const [eventSlug, setEventSlug] = useState<string>('');
  const [portalPublished, setPortalPublished] = useState<boolean>(false);
  const [eventSlugDirty, setEventSlugDirty] = useState<boolean>(false);

  const { addToast } = useToast();

  // Tab state — Settings page has too many sections to be useful as a
  // single scroll. Two tabs: 'setup' (the lightweight director-facing
  // fields) and 'rules' (the rules engine — a sub-component with its
  // own save flow).
  const [tab, setTab] = useState<SettingsTab>('setup');

  // Unsaved changes protection: block browser unload when dirty or saving
  useEffect(() => {
    const message = getBeforeUnloadMessage(saveState);
    if (!message) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveState]);

  const { data: tournament, isLoading } = useQuery<Tournament>({
    queryKey: ['tournament', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournament');
      return res.json();
    },
  });

  // Fetch branding settings
  const { data: brandingData } = useQuery({
    queryKey: ['tournament', id, 'branding'],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/branding`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch branding');
      return res.json() as Promise<{ brandName: string; brandPrimaryColor: string; brandLogoUrl: string | null; hasOrgBranding: boolean }>;
    },
    enabled: !!id,
  });

  // Load branding when data arrives
  useEffect(() => {
    if (brandingData && !brandingDirty) {
      setBranding({
        brandName: brandingData.brandName || '',
        brandPrimaryColor: brandingData.brandPrimaryColor || '#DC2626',
        brandLogoUrl: brandingData.brandLogoUrl || '',
      });
    }
  }, [brandingData, brandingDirty]);

  const saveBrandingMutation = useMutation({
    mutationFn: async (data: BrandingSettings) => {
      const res = await fetch(`/api/tournaments/${id}/branding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          brandName: data.brandName || null,
          brandPrimaryColor: data.brandPrimaryColor || null,
          brandLogoUrl: data.brandLogoUrl || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || 'Failed to save branding');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament', id, 'branding'] });
      setBrandingDirty(false);
      addToast('Branding saved successfully', 'success');
    },
    onError: (err: Error) => {
      addToast(err.message || 'Failed to save branding', 'error');
    },
  });

  const handleSaveBranding = async () => {
    setBrandingLoading(true);
    try {
      await saveBrandingMutation.mutateAsync(branding);
    } finally {
      setBrandingLoading(false);
    }
  };

  // Load settings from tournament
  useEffect(() => {
    if (setupDirtyRef.current) return;
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

  // Hydrate refresh interval from tournament
  useEffect(() => {
    if (tournament?.publicScoreboardRefreshMs !== undefined && tournament?.publicScoreboardRefreshMs !== null) {
      setRefreshMs(tournament.publicScoreboardRefreshMs);
    }
  }, [tournament?.publicScoreboardRefreshMs]);

  // Hydrate capacity settings from tournament
  useEffect(() => {
    if (tournament) {
      setMaxCapacity(tournament.maxCapacity ?? null);
      setWaitlistEnabled(tournament.waitlistEnabled ?? false);
      setCapacityDirty(false);
    }
  }, [tournament]);

  // Hydrate portal state from tournament data
  useEffect(() => {
    if (tournament) {
      setEventSlug(tournament.eventSlug || '');
      setPortalPublished(tournament.portalPublished || false);
      setEventSlugDirty(false);
    }
  }, [tournament]);

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

  const saveRefreshIntervalMutation = useMutation({
    mutationFn: async (intervalMs: number) => {
      const res = await fetch(`/api/tournaments/${id}`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicScoreboardRefreshMs: intervalMs }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save refresh interval');
      }
      return res.json();
    },
    onSuccess: () => {
      setRefreshMsDirty(false);
      addToast('Refresh interval saved', 'success');
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
    },
    onError: (error: Error) => addToast(error.message, 'error'),
  });

  // Save capacity settings mutation
  const saveCapacityMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tournaments/${id}`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxCapacity,
          waitlistEnabled,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save capacity settings');
      }
      return res.json();
    },
    onSuccess: () => {
      setCapacityDirty(false);
      addToast('Capacity settings saved', 'success');
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
    },
    onError: (error: Error) => addToast(error.message, 'error'),
  });

  // Portal management mutations
  const saveEventSlugMutation = useMutation({
    mutationFn: async (slug: string) => {
      const res = await fetch(`/api/tournaments/${id}/event-slug`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventSlug: slug }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save event slug');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setEventSlug(data.eventSlug);
      setEventSlugDirty(false);
      addToast('Event slug saved', 'success');
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
    },
    onError: (error: Error) => addToast(error.message, 'error'),
  });

  const publishPortalMutation = useMutation({
    mutationFn: async (action: 'publish' | 'unpublish') => {
      const res = await fetch(`/api/tournaments/${id}/portal/${action}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || `Failed to ${action} portal`);
      }
      return res.json();
    },
    onSuccess: (data, action) => {
      setPortalPublished(data.portalPublished);
      addToast(
        action === 'publish' ? 'Portal published successfully' : 'Portal unpublished',
        'success'
      );
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
    },
    onError: (error: Error) => addToast(error.message, 'error'),
  });

  const copyPortalLink = async () => {
    if (!tournament?.organization?.slug || !eventSlug) return;
    const url = `${window.location.origin}/events/${tournament.organization.slug}/${eventSlug}`;
    try {
      await navigator.clipboard.writeText(url);
      addToast('Portal link copied to clipboard', 'success');
    } catch {
      addToast('Copy failed — please copy manually', 'error');
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (newSettings: TournamentSettings) => {
      setSaveState('saving');
      setSaveError('');
      return saveTournamentSettingsRequest(fetch, id!, newSettings, getAuthHeaders());
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setupDirtyRef.current = false;
      setSaveState('saved');
      setTimeout(() => {
        setSaveState((current) => current === 'saved' ? 'clean' : current);
      }, 3000);
    },
    onError: (error: Error) => {
      setSaveState('error');
      setSaveError(error.message || 'Failed to save settings');
      addToast(error.message, 'error');
    },
  });

  const updateSettings = (updates: Partial<TournamentSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
    setupDirtyRef.current = true;
    setSaveState('dirty');
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
    setupDirtyRef.current = true;
    setSaveState('dirty');
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
              disabled={saveState !== 'dirty' || saveMutation.isPending}
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
          className="text-sm text-surface-600 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 flex items-center mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Tournament
        </Link>
      </PageHeader>

      {/* Success Message */}
      {saveState === 'saved' && (
        <div className="mb-6 p-4 bg-success/10 dark:bg-success/20 border border-success/30 dark:border-success rounded-lg text-success dark:text-success/30">
          Settings saved successfully!
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-surface-200 dark:border-surface-700 mb-6">
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
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 hover:border-surface-300'
            }`}
          >
            <Settings className="inline h-4 w-4 mr-1.5" />
            Setup
            <span className="ml-2 text-xs text-surface-600">(quick)</span>
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
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 hover:border-surface-300'
            }`}
          >
            <Award className="inline h-4 w-4 mr-1.5" />
            Categorization + Brackets
            <span className="ml-2 text-xs text-surface-600">(advanced)</span>
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-branding"
            aria-selected={tab === 'branding'}
            aria-controls="settings-panel-branding"
            onClick={() => setTab('branding')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              tab === 'branding'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 hover:border-surface-300'
            }`}
          >
            <Award className="inline h-4 w-4 mr-1.5" />
            Branding
          </button>
        </nav>
      </div>

      {(
        <div id="settings-panel-setup" role="tabpanel" aria-labelledby="settings-tab-setup" hidden={tab !== 'setup'}>
      <fieldset disabled={saveMutation.isPending} className="contents" aria-busy={saveMutation.isPending}>
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
                <span className="text-surface-600 dark:text-surface-400 font-normal ml-2">
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
              <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                Divisions with more competitors will be split (e.g., DIV1, DIV2)
              </p>
            </div>
            <div>
              <Label htmlFor="registrationFee">
                Registration Fee Notes
                <span className="text-surface-600 dark:text-surface-400 font-normal ml-2">
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
              <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
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
                <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
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
                <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                  Optional one-liner shown under the fee amount.
                </p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Capacity & Waitlist — #191 */}
      <Card data-tour="settings-capacity" className="mb-6">
        <CardHeader
          title="Capacity & Waitlist"
          icon={AlertCircle}
          description="Limit total registrations and enable waitlist when full."
        />
        <CardBody>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="maxCapacity">
                  Maximum Capacity
                </Label>
                <Input
                  id="maxCapacity"
                  type="number"
                  min="1"
                  step="1"
                  value={maxCapacity ?? ''}
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : Number(e.target.value);
                    setMaxCapacity(val);
                    setCapacityDirty(true);
                  }}
                  placeholder="Unlimited"
                />
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Maximum number of active registrations. Leave blank for unlimited.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="waitlistEnabled"
                  checked={waitlistEnabled}
                  onChange={(e) => {
                    setWaitlistEnabled(e.target.checked);
                    setCapacityDirty(true);
                  }}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <Label htmlFor="waitlistEnabled" className="mb-0">
                  Enable Waitlist
                </Label>
              </div>
            </div>
            {capacityDirty && (
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  onClick={() => saveCapacityMutation.mutate()}
                  disabled={saveCapacityMutation.isPending}
                  className="flex items-center gap-2"
                >
                  {saveCapacityMutation.isPending ? (
                    <>
                      <Spinner size="sm" /> Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" /> Save Capacity Settings
                    </>
                  )}
                </Button>
              </div>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-400">
              When capacity is reached, new registrations are automatically waitlisted. You can promote waitlisted competitors from the Registrations page.
            </p>
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
                      <CheckIcon className="h-4 w-4 text-success" /> Copied
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
                  className="text-primary-600 dark:text-primary-400 hover:underline"
                >
                  Open in new tab
                </a>
                <button
                  onClick={() => setRevokeOpen(true)}
                  className="text-danger dark:text-danger hover:underline"
                  type="button"
                >
                  Revoke link
                </button>
                <span className="text-surface-600 dark:text-surface-400 text-xs">
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
              <span className="text-sm text-surface-600 dark:text-surface-400">
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

      {/* Public Scoreboard Auto-Refresh Interval */}
      <Card className="mb-6">
        <CardHeader
          title="Scoreboard Refresh Interval"
          icon={Settings}
          description="Control how often the public scoreboard automatically refreshes. Lower intervals keep spectators more up-to-date but increase server load."
        />
        <CardBody>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Label htmlFor="refreshInterval" className="w-32 shrink-0">
                Refresh every:
              </Label>
              <Select
                id="refreshInterval"
                value={String(refreshMs)}
                onChange={(e) => {
                  setRefreshMs(Number(e.target.value));
                  setRefreshMsDirty(true);
                }}
                className="w-48"
              >
                <option value="3000">3 seconds</option>
                <option value="5000">5 seconds</option>
                <option value="10000">10 seconds (default)</option>
                <option value="15000">15 seconds</option>
                <option value="30000">30 seconds</option>
                <option value="60000">60 seconds</option>
              </Select>
              {refreshMsDirty && (
                <Button
                  variant="primary"
                  onClick={() => saveRefreshIntervalMutation.mutate(refreshMs)}
                  disabled={saveRefreshIntervalMutation.isPending}
                  className="flex items-center gap-2"
                >
                  {saveRefreshIntervalMutation.isPending ? (
                    <>
                      <Spinner size="sm" /> Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" /> Save
                    </>
                  )}
                </Button>
              )}
            </div>
            <p className="text-sm text-surface-600 dark:text-surface-400">
              This setting affects the public scoreboard for spectators. Tournament staff views always use real-time updates.
            </p>
          </div>
        </CardBody>
      </Card>

      {/* Event Portal — tenant-branded public event page */}
      {tournament?.organizationId && (
        <Card data-tour="settings-event-portal" className="mb-6">
          <CardHeader
            title="Event Portal"
            icon={LinkIcon}
            description="Branded public event page for registration and results. Appears on your organization's event directory."
          />
          <CardBody>
            <div className="space-y-4">
              {/* Event Slug Input */}
              <div>
                <Label htmlFor="eventSlug">
                  Event Slug
                  <span className="ml-2 text-sm font-normal text-surface-600 dark:text-surface-400">
                    (used in portal URL)
                  </span>
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    id="eventSlug"
                    value={eventSlug}
                    onChange={(e) => {
                      setEventSlug(e.target.value);
                      setEventSlugDirty(true);
                    }}
                    placeholder="spring-championship-2027"
                    className="flex-1 font-mono text-sm"
                    disabled={!tournament?.organizationId}
                  />
                  <Button
                    variant="primary"
                    onClick={() => saveEventSlugMutation.mutate(eventSlug)}
                    disabled={!eventSlugDirty || !eventSlug.trim() || saveEventSlugMutation.isPending}
                    loading={saveEventSlugMutation.isPending}
                  >
                    {saveEventSlugMutation.isPending ? 'Saving...' : 'Save Slug'}
                  </Button>
                </div>
                <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                  Lowercase letters, numbers, and hyphens only. 3-63 characters.
                </p>
              </div>

              {/* Portal Status & Actions */}
              {eventSlug && (
                <div className="space-y-3 pt-3 border-t border-surface-200 dark:border-surface-700">
                  {portalPublished ? (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <span className="text-sm font-medium text-success dark:text-success">
                            ✓ Published to Portal
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => publishPortalMutation.mutate('unpublish')}
                          disabled={publishPortalMutation.isPending}
                        >
                          {publishPortalMutation.isPending ? 'Unpublishing...' : 'Unpublish'}
                        </Button>
                      </div>

                      {tournament?.organization?.slug && (
                        <div className="flex items-center gap-2">
                          <Input
                            readOnly
                            value={`${window.location.origin}/events/${tournament.organization.slug}/${eventSlug}`}
                            className="flex-1 font-mono text-sm"
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                          />
                          <Button variant="outline" size="sm" onClick={copyPortalLink}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      )}

                      <p className="text-xs text-surface-600 dark:text-surface-400">
                        This event is discoverable on your organization's public event portal.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-4 flex-wrap">
                        <Button
                          variant="primary"
                          onClick={() => publishPortalMutation.mutate('publish')}
                          disabled={publishPortalMutation.isPending || !eventSlug.trim()}
                        >
                          {publishPortalMutation.isPending ? 'Publishing...' : 'Publish to Portal'}
                        </Button>
                        <span className="text-sm text-surface-600 dark:text-surface-400">
                          Make this event visible on your organization's portal
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

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
                  <tr key={index} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
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
                        className="text-surface-600 hover:text-danger dark:hover:text-danger touch-target"
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
            <p className="text-sm text-surface-600 dark:text-surface-400 mb-3">
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
                    <tr key={index} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
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
                          className="text-surface-600 hover:text-danger dark:hover:text-danger touch-target"
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
        </fieldset>
        </div>
      )}

      {/* Tournament Rules (v2) */}
      {(
        <div id="settings-panel-rules" role="tabpanel" aria-labelledby="settings-tab-rules" hidden={tab !== 'rules'}>
          <Card className="mt-6">
            <CardHeader
              title="Tournament Rules"
              description="The full rules engine that drives division categorization, bracket generation, and merging. Matches the workflow used in the Newton's Championship 2025 .xlsm (CB/BB tiers, 8 age bands, 3-4 weight classes)."
            />
            <CardBody>
              <RulesManager
                tournamentId={id!}
                tournamentSettings={tournament?.settings}
              />
            </CardBody>
          </Card>
        </div>
      )}

      {/* Branding Panel */}
      {tab === 'branding' && (
        <div id="settings-panel-branding" role="tabpanel" aria-labelledby="settings-tab-branding">
          <Card>
            <CardHeader
              title="Tournament Branding"
              icon={Award}
            />
            <CardBody>
              <div className="max-w-2xl space-y-6">
                <p className="text-sm text-surface-600 dark:text-surface-400">
                  Customize how your tournament appears on public-facing pages (registration, scoreboard, results).
                  Competitors will see your branding, not "Bowin".
                </p>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="brandName">
                      Brand Name
                      <span className="text-surface-600 dark:text-surface-400 font-normal ml-2">
                        (displayed to competitors)
                      </span>
                    </Label>
                    <Input
                      id="brandName"
                      type="text"
                      value={branding.brandName}
                      onChange={(e) => {
                        setBranding({ ...branding, brandName: e.target.value });
                        setBrandingDirty(true);
                      }}
                      placeholder={tournament?.name || 'Tournament name'}
                      maxLength={200}
                    />
                    <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                      Leave empty to use tournament name. Example: "Master Kim's Taekwondo Academy"
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="brandPrimaryColor">
                      Primary Color
                      <span className="text-surface-600 dark:text-surface-400 font-normal ml-2">
                        (accent color for buttons, icons)
                      </span>
                    </Label>
                    <div className="flex items-center gap-3">
                      <input
                        id="brandPrimaryColor"
                        type="color"
                        value={branding.brandPrimaryColor}
                        onChange={(e) => {
                          setBranding({ ...branding, brandPrimaryColor: e.target.value });
                          setBrandingDirty(true);
                        }}
                        className="h-10 w-20 rounded border border-surface-300 dark:border-surface-600 cursor-pointer"
                      />
                      <Input
                        type="text"
                        value={branding.brandPrimaryColor}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                            setBranding({ ...branding, brandPrimaryColor: val });
                            setBrandingDirty(true);
                          }
                        }}
                        placeholder="#DC2626"
                        maxLength={7}
                        className="w-32"
                      />
                      <div 
                        className="h-10 w-10 rounded border border-surface-300 dark:border-surface-600"
                        style={{ backgroundColor: branding.brandPrimaryColor }}
                        aria-label="Color preview"
                      />
                    </div>
                    <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                      Hex color code. Default: #DC2626 (Bowin red)
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="brandLogoUrl">
                      Logo URL
                      <span className="text-surface-600 dark:text-surface-400 font-normal ml-2">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="brandLogoUrl"
                      type="url"
                      value={branding.brandLogoUrl}
                      onChange={(e) => {
                        setBranding({ ...branding, brandLogoUrl: e.target.value });
                        setBrandingDirty(true);
                      }}
                      placeholder="https://example.com/logo.png"
                      maxLength={500}
                    />
                    <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                      Public URL to your logo image. Shown on registration and scoreboard pages.
                      Leave empty to show a trophy icon in your brand color.
                    </p>
                  </div>

                  {branding.brandLogoUrl && (
                    <div>
                      <Label>Logo Preview</Label>
                      <div className="mt-2 p-4 border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-50 dark:bg-surface-950">
                        <img 
                          src={branding.brandLogoUrl} 
                          alt="Brand logo preview" 
                          className="h-16 w-auto object-contain"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling!.classList.remove('hidden');
                          }}
                        />
                        <p className="hidden text-sm text-danger dark:text-danger">
                          Failed to load logo. Check the URL is correct and publicly accessible.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-surface-200 dark:border-surface-700">
                  <Button
                    variant="primary"
                    onClick={handleSaveBranding}
                    disabled={!brandingDirty || brandingLoading}
                    loading={brandingLoading}
                  >
                    {brandingLoading ? (
                      <>
                        <Spinner size="sm" className="mr-2" /> Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" /> Save Branding
                      </>
                    )}
                  </Button>
                  {brandingData?.hasOrgBranding && !branding.brandName && (
                    <p className="mt-2 text-sm text-info dark:text-info">
                      Currently using organization-level branding as fallback
                    </p>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Save State Status Banner */}
      {saveState !== 'clean' && (
        <div
          role="status"
          aria-live="polite"
          aria-label={`Save status: ${getSaveStateLabel(saveState)}`}
          className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${
            saveState === 'dirty'
              ? 'bg-warning/10 dark:bg-warning/80 border border-warning dark:border-warning text-warning dark:text-warning/20'
              : saveState === 'saving'
                ? 'bg-info/10 dark:bg-info/80 border border-info dark:border-info text-info dark:text-info/20'
                : saveState === 'saved'
                  ? 'bg-success/10 dark:bg-success/80 border border-success dark:border-success text-success dark:text-success/20'
                  : 'bg-danger/10 dark:bg-danger/80 border border-danger dark:border-danger text-danger dark:text-danger/20'
          }`}
        >
          {saveState === 'error' && <AlertCircle className="h-5 w-5 flex-shrink-0" />}
          <div className="flex-1">
            <span className="text-sm font-medium">{getSaveStateLabel(saveState)}</span>
            {saveState === 'error' && saveError && (
              <p className="text-xs mt-0.5">{saveError}</p>
            )}
          </div>
          {saveState === 'dirty' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => saveMutation.mutate(settings)}
              disabled={saveMutation.isPending}
              loading={saveMutation.isPending}
            >
              Save
            </Button>
          )}
          {saveState === 'error' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => saveMutation.mutate(settings)}
            >
              Retry
            </Button>
          )}
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
}: {
  tournamentId: string;
  tournamentSettings: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [rules, setRules] = useState<TournamentRules>(() => parseTournamentRules(tournamentSettings));
  const [hasRuleChanges, setHasRuleChanges] = useState(false);
  const rulesDirtyRef = useRef(false);
  const [showResetRulesConfirm, setShowResetRulesConfirm] = useState(false);

  // Re-init when tournamentSettings changes (e.g. after save)
  useEffect(() => {
    if (rulesDirtyRef.current) return;
    setRules(parseTournamentRules(tournamentSettings));
    setHasRuleChanges(false);
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tournament', tournamentId] });
      rulesDirtyRef.current = false;
      setHasRuleChanges(false);
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tournament', tournamentId] });
      rulesDirtyRef.current = false;
      setHasRuleChanges(false);
      addToast('Rules reset to defaults', 'success');
    },
  });

  const handleChange = (next: TournamentRules) => {
    setRules(next);
    rulesDirtyRef.current = true;
    setHasRuleChanges(true);
  };

  return (
    <fieldset disabled={saveMutation.isPending || resetRulesMutation.isPending} className="contents" aria-busy={saveMutation.isPending || resetRulesMutation.isPending}>
      <TournamentRulesEditor
        rules={rules}
        onChange={handleChange}
        onReset={() => setShowResetRulesConfirm(true)}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="primary"
          onClick={() => saveMutation.mutate(rules)}
          disabled={!hasRuleChanges || saveMutation.isPending}
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
    </fieldset>
  );
}
