// Root admin: set up email delivery (Mailgun) without touching the server,
// and send a test email that shows exactly what Mailgun answered.
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Mail, AlertTriangle } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, CardBody, CardHeader, Input, Label, PageHeader, Select } from '../components/ui';
import OperationStatus from '../components/ui/OperationStatus';

type Region = 'us' | 'eu';

interface EmailStatus {
  inUse: null | { source: 'saved' | 'environment'; domain: string; region: Region | null; fromName: string; fromAddress: string; apiKeyLast4: string };
  saved: null | { domain: string; region: Region; fromName: string; fromAddress: string; apiKeyLast4: string };
  savedUnreadable: boolean;
  lastSend: null | { at: string; ok: boolean; error?: string };
}

const emptyForm = { apiKey: '', domain: '', region: 'us' as Region, fromName: '', fromAddress: '' };

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({})) as { error?: string; details?: { message?: string }[] };
  return body.details?.[0]?.message || body.error || fallback;
}

export default function EmailSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<EmailStatus>({
    queryKey: ['admin-email-settings'],
    queryFn: async () => {
      const res = await fetch('/api/admin/email-settings', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Could not load email settings');
      return res.json();
    },
  });

  // Start the form from what is saved (or in use from the server).
  useEffect(() => {
    const base = data?.saved ?? data?.inUse;
    if (base) {
      setForm((f) => ({ ...f, domain: base.domain, region: base.region ?? 'us', fromName: base.fromName, fromAddress: base.fromAddress }));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/email-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not save email settings'));
      return res.json() as Promise<EmailStatus>;
    },
    onMutate: () => setFormError(null),
    onSuccess: (status) => {
      queryClient.setQueryData(['admin-email-settings'], status);
      setForm((f) => ({ ...f, apiKey: '' }));
      toast.success('Email settings saved. Send a test email to check them.');
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Could not save email settings'),
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/email-settings/test', { method: 'POST', headers: getAuthHeaders() });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; to?: string; error?: string; status?: EmailStatus };
      if (body.status) queryClient.setQueryData(['admin-email-settings'], body.status);
      return body;
    },
    onMutate: () => setTestResult(null),
    onSuccess: (body) => setTestResult(body.ok
      ? { ok: true, message: `Test email sent to ${body.to}. Check that inbox (and spam).` }
      : { ok: false, message: body.error || 'The test email could not be sent.' }),
    onError: () => setTestResult({ ok: false, message: 'The test email could not be sent.' }),
  });

  const clear = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/email-settings', { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await readError(res, 'Could not remove saved settings'));
      return res.json() as Promise<EmailStatus>;
    },
    onSuccess: (status) => {
      queryClient.setQueryData(['admin-email-settings'], status);
      setForm(emptyForm);
      toast.success('Saved email settings removed.');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not remove saved settings'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  const inUse = data?.inUse;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email delivery"
        description="Sign-in links, staff invites and registration confirmations are sent through Mailgun."
      />

      {isError && (
        <OperationStatus state="rejected" message="Could not load email settings." actionLabel="Retry" onAction={() => refetch()} />
      )}

      <Card>
        <CardHeader title="Status" />
        <CardBody className="space-y-3 text-sm">
          {isLoading ? (
            <p className="text-surface-600 dark:text-surface-300">Checking…</p>
          ) : inUse ? (
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" aria-hidden="true" />
              <p>
                Email is set up: sending as <strong>{inUse.fromName} &lt;{inUse.fromAddress}&gt;</strong> through{' '}
                <strong>{inUse.domain}</strong> ({inUse.region === 'eu' ? 'EU' : 'US'} region, key ending {inUse.apiKeyLast4}).{' '}
                {inUse.source === 'saved' ? 'Using the settings saved on this page.' : 'Using the settings from the server environment.'}
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" aria-hidden="true" />
              <p>
                <strong>Email is not set up.</strong> Nobody receives sign-in links or registration emails until you
                add your Mailgun settings below.
              </p>
            </div>
          )}
          {data?.savedUnreadable && (
            <p className="text-danger">
              Saved settings could not be read (the server secret changed). Enter the API key again and save.
            </p>
          )}
          {data?.lastSend && (
            <p className="text-surface-600 dark:text-surface-300">
              Last email {data.lastSend.ok ? 'was sent' : 'failed'} at {new Date(data.lastSend.at).toLocaleString()}
              {data.lastSend.error ? `: ${data.lastSend.error}` : '.'}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button variant="secondary" onClick={() => sendTest.mutate()} loading={sendTest.isPending} disabled={!inUse || sendTest.isPending}>
              <Mail className="mr-2 h-4 w-4" aria-hidden="true" /> Send test email to me
            </Button>
          </div>
          {testResult && (
            <p role="status" className={testResult.ok ? 'text-success' : 'text-danger'}>{testResult.message}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Mailgun settings" />
        <CardBody>
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            {formError && (
              <p role="alert" className="md:col-span-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</p>
            )}
            <div className="md:col-span-2">
              <Label htmlFor="email-api-key">Mailgun API key</Label>
              <Input
                id="email-api-key"
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={data?.saved ? `Saved (ends ${data.saved.apiKeyLast4}). Leave blank to keep it.` : 'Paste the "Sending API key" from Mailgun'}
                aria-describedby="email-api-key-help"
              />
              <p id="email-api-key-help" className="mt-1 text-xs text-surface-600 dark:text-surface-400">
                In Mailgun: Sending → Domain settings → Sending API keys. It is stored encrypted and never shown again.
              </p>
            </div>
            <div>
              <Label htmlFor="email-domain">Sending domain</Label>
              <Input id="email-domain" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="mg.yourdomain.com" required />
            </div>
            <div>
              <Label htmlFor="email-region">Mailgun region</Label>
              <Select id="email-region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value as Region })}>
                <option value="us">US (api.mailgun.net)</option>
                <option value="eu">EU (api.eu.mailgun.net)</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="email-from-name">Sender name</Label>
              <Input id="email-from-name" value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} placeholder="Your organization" required />
            </div>
            <div>
              <Label htmlFor="email-from-address">Sender address</Label>
              <Input id="email-from-address" type="email" value={form.fromAddress} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })} placeholder="noreply@mg.yourdomain.com" required />
            </div>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button type="submit" variant="primary" loading={save.isPending} disabled={save.isPending}>Save settings</Button>
              {data?.saved && (
                <Button type="button" variant="ghost" onClick={() => clear.mutate()} loading={clear.isPending} disabled={clear.isPending}>
                  Remove saved settings
                </Button>
              )}
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
