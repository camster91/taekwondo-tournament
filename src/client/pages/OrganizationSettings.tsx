import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  CreditCard,
  Download,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  KeyRound,
  Users,
  Trophy,
  Trash2,
} from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, Input, Label, Modal, PageHeader, Spinner } from '../components/ui';
import OperationStatus, { type OperationState } from '../components/ui/OperationStatus';
import { downloadBlob, fetchAuthenticatedBlob } from '../utils/authenticated-export';
import CustomDomainSettings from '../components/CustomDomainSettings';

type Entitlements = {
  maxTournaments: number;
  maxMembers: number;
  maxRings: number;
  publicRegistration: boolean;
  eventOperations: boolean;
};

type Organization = {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pilot' | 'starter' | 'pro';
  membershipRole: string;
  entitlements: Entitlements;
  _count: { tournaments: number; members: number };
  brandLogoUrl?: string | null;
  brandPrimaryColor?: string | null;
  billingSubscription?: {
    provider: string;
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd?: string | null;
    providerCustomerId?: string | null;
  } | null;
};

type SupportConfig = {
  hasOpenAiApiKey: boolean;
  openAiModel: string;
  openAiBaseUrl: string;
  supportAlertEmail: string;
  recentChanges: Array<{
    id: string;
    changedFields: string[];
    changedByUserId: string;
    at: string;
  }>;
};

type SupportConnectionResult = {
  ok: boolean;
  category: string;
  message: string;
};

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || 'The request could not be completed.');
  }
  return data as T;
}

function UsageBar({ label, value, limit, icon: Icon }: {
  label: string;
  value: number;
  limit: number;
  icon: typeof Trophy;
}) {
  const percent = Math.min(100, Math.round((value / Math.max(limit, 1)) * 100));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-sm">
        <span className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
          <Icon className="h-4 w-4 text-primary-500" /> {label}
        </span>
        <span className="text-slate-500 dark:text-slate-400">{value} of {limit}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function OrganizationSettings() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [exportAcknowledged, setExportAcknowledged] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ state: OperationState; message: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportLockRef = useRef(false);
  const [supportApiKeyInput, setSupportApiKeyInput] = useState('');
  const [supportOpenAiModel, setSupportOpenAiModel] = useState('');
  const [supportOpenAiBaseUrl, setSupportOpenAiBaseUrl] = useState('');
  const [supportAlertEmail, setSupportAlertEmail] = useState('');
  const [hasSavedSupportApiKey, setHasSavedSupportApiKey] = useState(false);
  const [clearSupportApiKey, setClearSupportApiKey] = useState(false);

  const organizationsQuery = useQuery({
    queryKey: ['organizations', 'current'],
    queryFn: async () => responseJson<{ organizations: Organization[] }>(
      await fetch('/api/organizations/current', { headers: getAuthHeaders() }),
    ),
  });

  const usageQuery = useQuery({
    queryKey: ['billing', 'usage', organizationsQuery.data?.organizations[0]?.id],
    enabled: Boolean(organizationsQuery.data?.organizations[0]),
    queryFn: async () => {
      const orgId = organizationsQuery.data?.organizations[0]?.id;
      if (!orgId) throw new Error('No organization');
      return responseJson<{
        totalTournaments: number;
        totalCompetitors: number;
        recentUsage: Array<{
          tournamentId: string;
          tournamentName: string;
          competitorCount: number;
          recordedAt: string;
        }>;
      }>(await fetch(`/api/billing/usage/${orgId}`, { headers: getAuthHeaders() }));
    },
  });

  const supportConfigQuery = useQuery({
    queryKey: ['support', 'config'],
    enabled: Boolean(organizationsQuery.data?.organizations[0]),
    queryFn: async () => responseJson<SupportConfig>(
      await fetch('/api/support/config', { headers: getAuthHeaders() }),
    ),
  });

  useEffect(() => {
    if (!supportConfigQuery.data) return;
    setHasSavedSupportApiKey(supportConfigQuery.data.hasOpenAiApiKey);
    setSupportOpenAiModel(supportConfigQuery.data.openAiModel || '');
    setSupportOpenAiBaseUrl(supportConfigQuery.data.openAiBaseUrl || '');
    setSupportAlertEmail(supportConfigQuery.data.supportAlertEmail || '');
    setSupportApiKeyInput('');
    setClearSupportApiKey(false);
  }, [supportConfigQuery.data]);

  const createMutation = useMutation({
    mutationFn: async () => responseJson(
      await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name }),
      }),
    ),
    onSuccess: async () => {
      setName('');
      toast.success('Organization created.');
      await queryClient.invalidateQueries({ queryKey: ['organizations', 'current'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const billingMutation = useMutation({
    mutationFn: async ({ endpoint, plan }: { endpoint: 'checkout' | 'portal'; plan?: 'starter' | 'pro' | 'per_event_small' | 'per_event_medium' | 'per_event_large' }) => {
      const organization = organizationsQuery.data?.organizations[0];
      if (!organization) throw new Error('Create an organization first.');
      return responseJson<{ url: string }>(await fetch(`/api/billing/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ organizationId: organization.id, plan }),
      }));
    },
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const organization = organizationsQuery.data?.organizations[0];
      if (!organization) throw new Error('Organization not found.');
      const response = await fetch(`/api/organizations/${organization.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ confirmation: deleteConfirmation, exportAcknowledged }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'The organization could not be deleted.');
      }
    },
    onSuccess: async () => {
      setShowDelete(false);
      setDeleteConfirmation('');
      setExportAcknowledged(false);
      toast.success('Organization permanently deleted.');
      await queryClient.invalidateQueries({ queryKey: ['organizations', 'current'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const supportConfigMutation = useMutation({
    mutationFn: async () => {
      const payload: {
        openAiApiKey?: string | null;
        openAiModel?: string;
        openAiBaseUrl?: string;
        supportAlertEmail?: string;
        clearOpenAiApiKey?: boolean;
      } = {};

      if (supportApiKeyInput.trim()) {
        payload.openAiApiKey = supportApiKeyInput.trim();
      } else if (clearSupportApiKey) {
        payload.clearOpenAiApiKey = true;
      }

      if (supportOpenAiModel.trim()) {
        payload.openAiModel = supportOpenAiModel.trim();
      }
      if (supportOpenAiBaseUrl.trim()) {
        payload.openAiBaseUrl = supportOpenAiBaseUrl.trim();
      }
      if (supportAlertEmail.trim()) {
        payload.supportAlertEmail = supportAlertEmail.trim();
      }

      if (!Object.keys(payload).length) {
        throw new Error('Make at least one change before saving.');
      }

      const response = await fetch('/api/support/config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to save support integration settings');
      }

      return responseJson<SupportConfig>(response);
    },
    onSuccess: (result) => {
      setHasSavedSupportApiKey(result.hasOpenAiApiKey);
      setSupportApiKeyInput('');
      setClearSupportApiKey(false);
      toast.success('Support integration saved.');
      void queryClient.invalidateQueries({ queryKey: ['support', 'config'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const supportConnectionMutation = useMutation({
    mutationFn: async () => {
      const payload: { openAiApiKey?: string; openAiModel?: string; openAiBaseUrl?: string } = {};
      if (supportApiKeyInput.trim()) payload.openAiApiKey = supportApiKeyInput.trim();
      if (supportOpenAiModel.trim()) payload.openAiModel = supportOpenAiModel.trim();
      if (supportOpenAiBaseUrl.trim()) payload.openAiBaseUrl = supportOpenAiBaseUrl.trim();
      return responseJson<SupportConnectionResult>(await fetch('/api/support/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload),
      }));
    },
    onSuccess: (result) => toast.success(result.message),
    onError: (error: Error) => toast.error(error.message),
  });

  const exportOrganization = async (organization: Organization) => {
    if (exportLockRef.current) return;
    exportLockRef.current = true;
    setExporting(true);
    setExportStatus({ state: 'pending', message: 'Preparing the complete organization data export.' });
    try {
      const blob = await fetchAuthenticatedBlob(fetch, `/api/organizations/${organization.id}/export`, 'application/json', getAuthHeaders());
      downloadBlob(blob, `${organization.slug}-export.json`);
      setExportStatus({ state: 'resolved', message: 'Organization data export download started.' });
    } catch (error) {
      setExportStatus({ state: 'rejected', message: error instanceof Error ? error.message : 'Organization export failed.' });
    } finally {
      setExporting(false);
      exportLockRef.current = false;
    }
  };

  if (organizationsQuery.isLoading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Spinner size="lg" /></div>;
  }

  if (organizationsQuery.isError) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Organization settings unavailable</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{organizationsQuery.error.message}</p>
        <Button className="mt-5" onClick={() => organizationsQuery.refetch()}>Try again</Button>
      </Card>
    );
  }

  const organization = organizationsQuery.data?.organizations[0];
  if (!organization) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Organization & billing" description="Create the workspace that owns your tournaments, staff, and subscription." />
        <Card className="overflow-hidden p-0">
          <div className="bg-gradient-to-br from-primary-600 to-accent-700 px-6 py-8 text-white sm:px-10">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
              <Building2 className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-bold">Set up your organization</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-primary-100">
              Start on the free evaluation plan. You can configure one draft tournament before choosing a pilot or paid plan.
            </p>
          </div>
          <form
            className="space-y-5 p-6 sm:p-10"
            onSubmit={(event) => { event.preventDefault(); createMutation.mutate(); }}
          >
            <div>
              <Label htmlFor="organization-name">Organization name</Label>
              <Input
                id="organization-name"
                autoComplete="organization"
                placeholder="e.g. Northside Taekwondo"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={100}
                required
              />
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Use the school or tournament company name customers recognize.</p>
            </div>
            <Button type="submit" size="lg" loading={createMutation.isPending} disabled={name.trim().length < 2}>
              Create organization
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const canManageBilling = ['owner', 'admin'].includes(organization.membershipRole);
  const canManageSupport = ['owner', 'admin'].includes(organization.membershipRole);
  const hasStripeCustomer = Boolean(organization.billingSubscription?.providerCustomerId);
  const planLabel = organization.plan.charAt(0).toUpperCase() + organization.plan.slice(1);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Organization & billing" description="Review workspace usage, entitlements, and billing status." />

      <div className="mb-6 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-500/10">
                <Building2 className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              </div>
              <h1 className="text-2xl font-bold text-slate-950 dark:text-white">{organization.name}</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">/{organization.slug} · {organization.membershipRole}</p>
            </div>
            <span className="self-start rounded-full bg-primary-50 px-3 py-1.5 text-sm font-semibold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
              {planLabel} plan
            </span>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <UsageBar label="Tournament usage" value={organization._count.tournaments} limit={organization.entitlements.maxTournaments} icon={Trophy} />
            <UsageBar label="Team members" value={organization._count.members} limit={organization.entitlements.maxMembers} icon={Users} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-primary-500" />
            <h2 className="font-semibold text-slate-950 dark:text-white">Billing status</h2>
          </div>
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
            {organization.billingSubscription
              ? `${organization.billingSubscription.status.replace(/_/g, ' ')} via ${organization.billingSubscription.provider}`
              : 'No payment method or subscription is attached.'}
          </p>
          {organization.billingSubscription?.cancelAtPeriodEnd && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Cancellation is scheduled at the end of the billing period.</p>
          )}
          {canManageBilling && hasStripeCustomer && (
            <Button
              variant="secondary"
              className="mt-5 w-full"
              loading={billingMutation.isPending}
              onClick={() => billingMutation.mutate({ endpoint: 'portal' })}
            >
              Manage billing <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </Card>
      </div>

      {/* Custom domains (post-#256) */}
      <CustomDomainSettings
        organizationId={organization.id}
        canManage={canManageBilling}
      />

      {/* Organization branding section (P1-11) */}
      <Card className="mb-8">
        <div className="mb-5 flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-primary-500" />
          <h2 className="font-semibold text-slate-950 dark:text-white">Organization branding</h2>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
          Upload a logo that will appear on public-facing tournament pages (registration, scoreboard).
        </p>
        <div className="space-y-4">
          <div>
            <Label htmlFor="org-logo">Organization logo</Label>
            {organization.brandLogoUrl && (
              <div className="mt-2 mb-3 flex items-center gap-4">
                <img 
                  src={organization.brandLogoUrl} 
                  alt={organization.name}
                  className="h-16 w-auto max-w-xs object-contain rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/organizations/${organization.id}/logo`, {
                        method: 'DELETE',
                        headers: getAuthHeaders(),
                      });
                      if (!res.ok) throw new Error('Failed to remove logo');
                      toast.success('Logo removed successfully');
                      await queryClient.invalidateQueries({ queryKey: ['organizations', 'current'] });
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : 'Failed to remove logo');
                    }
                  }}
                >
                  Remove logo
                </Button>
              </div>
            )}
            <input
              id="org-logo"
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml"
              className="block w-full text-sm text-slate-500 dark:text-slate-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-primary-50 file:text-primary-700
                hover:file:bg-primary-100
                dark:file:bg-primary-500/10 dark:file:text-primary-400
                dark:hover:file:bg-primary-500/20"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                
                // Validate file size (2MB)
                if (file.size > 2 * 1024 * 1024) {
                  toast.error('File too large. Maximum size is 2MB.');
                  return;
                }

                try {
                  // Convert to base64
                  const reader = new FileReader();
                  reader.onload = async () => {
                    const base64 = reader.result as string;
                    const res = await fetch(`/api/organizations/${organization.id}/logo-base64`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                      body: JSON.stringify({ data: base64, mimeType: file.type }),
                    });
                    if (!res.ok) {
                      const data = await res.json();
                      throw new Error(data.error || 'Failed to upload logo');
                    }
                    toast.success('Logo uploaded successfully');
                    await queryClient.invalidateQueries({ queryKey: ['organizations', 'current'] });
                    // Clear the file input
                    event.target.value = '';
                  };
                  reader.onerror = () => {
                    toast.error('Failed to read file');
                  };
                  reader.readAsDataURL(file);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'Failed to upload logo');
                }
              }}
            />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              PNG, JPG, GIF, WebP, or SVG. Maximum 2MB.
            </p>
          </div>
        </div>
      </Card>

      {/* Usage History */}
      {usageQuery.data && usageQuery.data.totalTournaments > 0 && (
        <Card className="mb-6">
          <div className="mb-5 flex items-center gap-3">
            <Trophy className="h-5 w-5 text-primary-500" />
            <h2 className="font-semibold text-slate-950 dark:text-white">Usage history</h2>
          </div>
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
              <p className="text-sm text-slate-600 dark:text-slate-400">Total tournaments completed</p>
              <p className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">{usageQuery.data.totalTournaments}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
              <p className="text-sm text-slate-600 dark:text-slate-400">Total competitors served</p>
              <p className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">{usageQuery.data.totalCompetitors.toLocaleString()}</p>
            </div>
          </div>
          {usageQuery.data.recentUsage.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Recent activity</h3>
              <div className="space-y-2">
                {usageQuery.data.recentUsage.slice(0, 5).map((usage) => (
                  <div key={usage.tournamentId} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div>
                      <p className="font-medium text-slate-950 dark:text-white">{usage.tournamentName}</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {new Date(usage.recordedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-primary-600 dark:text-primary-400">{usage.competitorCount}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">competitors</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-950 dark:text-white">Plans built for tournament day</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Choose annual subscriptions for unlimited events, or pay per-event for one-off tournaments.</p>
      </div>

      {/* Annual Plans */}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Annual Subscriptions</h3>
        <div className="grid gap-5 lg:grid-cols-3">
          {([
            { plan: 'free' as const, label: 'Free Trial', tournaments: 1, competitors: 30, members: 1, rings: 1, icon: ShieldCheck, price: null },
            { plan: 'starter' as const, label: 'Starter', tournaments: 10, competitors: 100, members: 15, rings: 8, icon: Sparkles, price: '$999/year' },
            { plan: 'pro' as const, label: 'Pro', tournaments: 100, competitors: 9999, members: 100, rings: 32, icon: Trophy, price: '$2,499/year' },
          ]).map((item) => {
            const Icon = item.icon;
            const current = organization.plan === item.plan;
            return (
              <Card key={item.plan} className={item.plan === 'starter' ? 'border-primary-300 dark:border-primary-700' : ''}>
                <Icon className="h-6 w-6 text-primary-500" />
                <h3 className="mt-4 text-lg font-bold text-slate-950 dark:text-white">{item.label}</h3>
                {item.price && <p className="mt-1 text-sm font-semibold text-primary-600 dark:text-primary-400">{item.price}</p>}
                <ul className="mt-5 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                  <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" /> Up to {item.tournaments} tournament{item.tournaments === 1 ? '' : 's'}</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" /> {item.competitors === 9999 ? 'Unlimited' : `Up to ${item.competitors}`} competitors</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" /> {item.members} team member{item.members === 1 ? '' : 's'}</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" /> Up to {item.rings} ring{item.rings === 1 ? '' : 's'}</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" /> {item.plan === 'free' ? 'Draft evaluation' : 'Public registration + event operations'}</li>
                </ul>
                {item.plan === 'free' ? (
                  <Button className="mt-6 w-full" variant="secondary" disabled>{current ? 'Current plan' : 'Free evaluation'}</Button>
                ) : (
                  <Button
                    className="mt-6 w-full"
                    variant={item.plan === 'starter' ? 'primary' : 'secondary'}
                    disabled={!canManageBilling || current}
                    loading={billingMutation.isPending}
                    onClick={() => billingMutation.mutate({ endpoint: 'checkout', plan: item.plan })}
                  >
                    {current ? 'Current plan' : `Choose ${item.label}`}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Per-Event Plans */}
      <div className="mb-8">
        <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Per-Event Pricing</h3>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">One-time purchase for a single tournament. Perfect for occasional events.</p>
        <div className="grid gap-5 lg:grid-cols-3">
          {([
            { plan: 'per_event_small' as const, label: 'Small Event', competitors: 100, price: '$99', description: 'Up to 100 competitors' },
            { plan: 'per_event_medium' as const, label: 'Medium Event', competitors: 250, price: '$199', description: 'Up to 250 competitors' },
            { plan: 'per_event_large' as const, label: 'Large Event', competitors: 500, price: '$299', description: 'Up to 500 competitors' },
          ]).map((item) => (
            <Card key={item.plan}>
              <CreditCard className="h-6 w-6 text-primary-500" />
              <h3 className="mt-4 text-lg font-bold text-slate-950 dark:text-white">{item.label}</h3>
              <p className="mt-1 text-2xl font-bold text-primary-600 dark:text-primary-400">{item.price}</p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.description}</p>
              <ul className="mt-5 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" /> Single tournament access</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" /> {item.competitors} competitor limit</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" /> Public registration</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" /> Full event operations</li>
              </ul>
              <Button
                className="mt-6 w-full"
                variant="secondary"
                disabled={!canManageBilling}
                loading={billingMutation.isPending}
                onClick={() => billingMutation.mutate({ endpoint: 'checkout', plan: item.plan })}
              >
                Purchase {item.label}
              </Button>
            </Card>
          ))}
        </div>
      </div>

      {organization.membershipRole === 'owner' && (
        <Card className="mt-8 border-red-200 dark:border-red-900/70">
          {exportStatus && (
            <OperationStatus
              className="mb-5"
              state={exportStatus.state}
              message={exportStatus.message}
              actionLabel={exportStatus.state === 'rejected' ? 'Dismiss' : undefined}
              onAction={exportStatus.state === 'rejected' ? () => setExportStatus(null) : undefined}
            />
          )}
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-950 dark:text-white">Data export and account closure</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
                Export a complete copy first. Deletion permanently removes the organization and its tournaments and cannot be undone.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                variant="secondary"
                loading={exporting}
                disabled={exporting}
                onClick={() => void exportOrganization(organization)}
              >
                <Download className="h-4 w-4" /> Export organization data
              </Button>
              <Button variant="danger" onClick={() => setShowDelete(true)}>
                <Trash2 className="h-4 w-4" /> Delete organization
              </Button>
            </div>
          </div>
        </Card>
      )}


      {canManageSupport && (
        <Card className="mt-8">
          <div className="mb-5 flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-primary-500" />
            <h2 className="font-semibold text-slate-950 dark:text-white">Support AI settings</h2>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Configure the AI support assistant and support escalation email for this organization.
          </p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              supportConfigMutation.mutate();
            }}
          >
            <div>
              <Label htmlFor="support-openai-model">OpenAI model</Label>
              <Input
                id="support-openai-model"
                value={supportOpenAiModel}
                autoComplete="off"
                placeholder="gpt-4o-mini"
                onChange={(event) => setSupportOpenAiModel(event.target.value)}
              />
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Use the exact model identifier, for example `gpt-4o-mini`.</p>
            </div>
            <div>
              <Label htmlFor="support-openai-base-url">OpenAI base URL</Label>
              <Input
                id="support-openai-base-url"
                value={supportOpenAiBaseUrl}
                autoComplete="off"
                placeholder="https://api.openai.com/v1"
                onChange={(event) => setSupportOpenAiBaseUrl(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="support-alert-email">Support alert email</Label>
              <Input
                id="support-alert-email"
                value={supportAlertEmail}
                autoComplete="off"
                type="email"
                placeholder="support@yourcompany.com"
                onChange={(event) => setSupportAlertEmail(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="support-openai-api-key">OpenAI API key</Label>
              <Input
                id="support-openai-api-key"
                value={supportApiKeyInput}
                autoComplete="new-password"
                type="password"
                placeholder={hasSavedSupportApiKey ? 'Stored key is configured' : 'Paste new key to set'}
                onChange={(event) => {
                  setSupportApiKeyInput(event.target.value);
                  if (event.target.value.trim()) {
                    setClearSupportApiKey(false);
                  }
                }}
              />
              <div className="mt-2 flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={clearSupportApiKey}
                    onChange={(event) => {
                      setClearSupportApiKey(event.target.checked);
                      if (event.target.checked) {
                        setSupportApiKeyInput('');
                      }
                    }}
                  />
                  Remove organization key and use environment/default settings
                </label>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="submit"
                className="w-full sm:w-auto"
                loading={supportConfigMutation.isPending}
                disabled={supportConfigMutation.isPending || supportConfigQuery.isLoading}
              >
                Save support integration
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                loading={supportConnectionMutation.isPending}
                disabled={supportConnectionMutation.isPending || supportConfigQuery.isLoading || clearSupportApiKey}
                onClick={() => supportConnectionMutation.mutate()}
              >
                Test connection
              </Button>
            </div>
            {supportConnectionMutation.data && (
              <OperationStatus state="resolved" message={supportConnectionMutation.data.message} />
            )}
            {supportConnectionMutation.error && (
              <OperationStatus state="rejected" message={supportConnectionMutation.error.message} />
            )}
            {supportConfigQuery.data?.recentChanges?.[0] && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Last changed {new Date(supportConfigQuery.data.recentChanges[0].at).toLocaleString()} ({supportConfigQuery.data.recentChanges[0].changedFields.join(', ')}).
              </p>
            )}
          </form>
        </Card>
      )}
      <Modal
        isOpen={showDelete}
        onClose={() => !deleteMutation.isPending && setShowDelete(false)}
        title="Delete organization"
        subtitle="This action deletes tournament records and cannot be undone."
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowDelete(false)} disabled={deleteMutation.isPending}>Cancel</Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              disabled={deleteConfirmation !== organization.slug || !exportAcknowledged}
              onClick={() => deleteMutation.mutate()}
            >
              Permanently delete organization
            </Button>
          </>
        )}
      >
        <div className="space-y-5">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Enter <strong>{organization.slug}</strong> to confirm.
          </p>
          <div>
            <Label htmlFor="organization-delete-confirmation">Organization URL confirmation</Label>
            <Input
              id="organization-delete-confirmation"
              autoComplete="off"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={exportAcknowledged}
              onChange={(event) => setExportAcknowledged(event.target.checked)}
            />
            <span>I have exported the organization data</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
