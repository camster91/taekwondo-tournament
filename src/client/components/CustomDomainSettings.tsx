import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Globe,
  Check,
  X,
  Copy,
  AlertCircle,
  ExternalLink,
  Clock,
  Shield,
  Ban,
  Loader2,
} from 'lucide-react';
import { Button, Card, Input, Label, Modal } from './ui';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

type CustomDomain = {
  id: string;
  hostname: string;
  verificationMethod: 'txt' | 'cname';
  verificationToken: string;
  verifiedAt: string | null;
  status: 'pending' | 'verified' | 'active' | 'disabled' | 'revoked';
  activatedAt: string | null;
  disabledAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type CustomDomainSettingsProps = {
  organizationId: string;
  canManage: boolean;
};

const statusColors = {
  pending: 'text-amber-600 dark:text-amber-400',
  verified: 'text-blue-600 dark:text-blue-400',
  active: 'text-emerald-600 dark:text-emerald-400',
  disabled: 'text-slate-500 dark:text-slate-400',
  revoked: 'text-red-600 dark:text-red-400',
};

const statusIcons = {
  pending: Clock,
  verified: Shield,
  active: Check,
  disabled: Ban,
  revoked: X,
};

const statusLabels = {
  pending: 'Pending verification',
  verified: 'Verified',
  active: 'Active',
  disabled: 'Disabled',
  revoked: 'Revoked',
};

export default function CustomDomainSettings({ organizationId, canManage }: CustomDomainSettingsProps) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [showAttachModal, setShowAttachModal] = useState(false);
  const [newHostname, setNewHostname] = useState('');
  const [verificationMethod, setVerificationMethod] = useState<'txt' | 'cname'>('txt');
  const [selectedDomain, setSelectedDomain] = useState<CustomDomain | null>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');

  const { data: domainsData, isLoading } = useQuery({
    queryKey: ['custom-domains', organizationId],
    queryFn: async () => {
      const response = await fetch(`/api/custom-domains/organization/${organizationId}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('Failed to fetch custom domains');
      }
      const data = await response.json();
      return data as { domains: CustomDomain[] };
    },
  });

  const attachMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/custom-domains/organization/${organizationId}/attach`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          hostname: newHostname.trim(),
          verificationMethod,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to attach domain');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast.success('Domain attached. Follow DNS instructions to verify.');
      setShowAttachModal(false);
      setNewHostname('');
      setSelectedDomain(data.domain);
      setShowVerificationModal(true);
      void queryClient.invalidateQueries({ queryKey: ['custom-domains', organizationId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (domainId: string) => {
      const response = await fetch(`/api/custom-domains/${domainId}/verify`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Verification failed');
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success('Domain verified successfully.');
      void queryClient.invalidateQueries({ queryKey: ['custom-domains', organizationId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (domainId: string) => {
      const response = await fetch(`/api/custom-domains/${domainId}/activate`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Activation failed');
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success('Domain activated. Update DNS to point to your VPS.');
      void queryClient.invalidateQueries({ queryKey: ['custom-domains', organizationId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (domainId: string) => {
      const response = await fetch(`/api/custom-domains/${domainId}/disable`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to disable domain');
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success('Domain disabled.');
      void queryClient.invalidateQueries({ queryKey: ['custom-domains', organizationId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (domainId: string) => {
      const response = await fetch(`/api/custom-domains/${domainId}/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ reason: revokeReason.trim() }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to revoke domain');
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success('Domain permanently revoked.');
      setShowRevokeModal(false);
      setSelectedDomain(null);
      setRevokeReason('');
      void queryClient.invalidateQueries({ queryKey: ['custom-domains', organizationId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const getTxtRecord = (domain: CustomDomain) => ({
    name: `_bowin-verify.${domain.hostname}`,
    type: 'TXT',
    value: `bowin-domain-verification=${domain.verificationToken}`,
  });

  const getCnameRecord = (domain: CustomDomain) => ({
    name: domain.hostname,
    type: 'CNAME',
    value: `verify-${domain.verificationToken}.bowin.app`,
  });

  const getProductionDnsRecord = (domain: CustomDomain) => ({
    name: domain.hostname,
    type: 'CNAME',
    value: 'tkd.ashbi.ca',
  });

  const domains = domainsData?.domains ?? [];

  return (
    <>
      <Card className="mt-8">
        <div className="mb-5 flex items-center gap-3">
          <Globe className="h-5 w-5 text-primary-500" />
          <h2 className="font-semibold text-slate-950 dark:text-white">Custom domains</h2>
        </div>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          Serve public registration and scoreboard pages on your own domain. DNS verification required.
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
          </div>
        ) : domains.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-900/50">
            <Globe className="mx-auto h-12 w-12 text-slate-400" />
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              No custom domains attached.
            </p>
            {canManage && (
              <Button className="mt-4" onClick={() => setShowAttachModal(true)}>
                Add custom domain
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {domains.map((domain) => {
                const StatusIcon = statusIcons[domain.status];
                return (
                  <div
                    key={domain.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                  >
                    {/* Wraps on phones: a long hostname plus the action buttons
                        used to overflow and widen the whole mobile viewport. */}
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 basis-60">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="min-w-0 break-all font-mono text-sm font-semibold text-slate-950 dark:text-white">
                            {domain.hostname}
                          </h3>
                          <span className={`flex items-center gap-1 text-xs font-medium ${statusColors[domain.status]}`}>
                            <StatusIcon className="h-3 w-3" />
                            {statusLabels[domain.status]}
                          </span>
                        </div>
                        {domain.revokedReason && (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                            Revoked: {domain.revokedReason}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Added {new Date(domain.createdAt).toLocaleDateString()}
                          {domain.activatedAt && ` • Active since ${new Date(domain.activatedAt).toLocaleDateString()}`}
                        </p>
                      </div>

                      {canManage && domain.status !== 'revoked' && (
                        <div className="flex flex-wrap gap-2">
                          {domain.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setSelectedDomain(domain);
                                  setShowVerificationModal(true);
                                }}
                              >
                                View DNS instructions
                              </Button>
                              <Button
                                size="sm"
                                loading={verifyMutation.isPending}
                                onClick={() => verifyMutation.mutate(domain.id)}
                              >
                                Verify
                              </Button>
                            </>
                          )}
                          {domain.status === 'verified' && (
                            <Button
                              size="sm"
                              loading={activateMutation.isPending}
                              onClick={() => activateMutation.mutate(domain.id)}
                            >
                              Activate
                            </Button>
                          )}
                          {domain.status === 'active' && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setSelectedDomain(domain);
                                  setShowVerificationModal(true);
                                }}
                              >
                                <ExternalLink className="h-3 w-3" />
                                DNS info
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={disableMutation.isPending}
                                onClick={() => disableMutation.mutate(domain.id)}
                              >
                                Disable
                              </Button>
                            </>
                          )}
                          {domain.status === 'disabled' && (
                            <Button
                              size="sm"
                              loading={activateMutation.isPending}
                              onClick={() => activateMutation.mutate(domain.id)}
                            >
                              Re-enable
                            </Button>
                          )}
                          {(domain.status === 'active' || domain.status === 'disabled') && (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setSelectedDomain(domain);
                                setShowRevokeModal(true);
                              }}
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {canManage && (
              <Button className="mt-4" variant="secondary" onClick={() => setShowAttachModal(true)}>
                Add another domain
              </Button>
            )}
          </>
        )}
      </Card>

      {/* Attach Domain Modal */}
      <Modal
        isOpen={showAttachModal}
        onClose={() => {
          setShowAttachModal(false);
          setNewHostname('');
        }}
        title="Attach custom domain"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            attachMutation.mutate();
          }}
        >
          <div className="space-y-4">
            <div>
              <Label htmlFor="hostname">Domain hostname</Label>
              <Input
                id="hostname"
                value={newHostname}
                onChange={(e) => setNewHostname(e.target.value)}
                placeholder="register.myclub.com"
                required
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Enter the full hostname (e.g., register.myclub.com). You must own this domain.
              </p>
            </div>

            <div>
              <Label>Verification method</Label>
              <div className="mt-2 flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="verificationMethod"
                    value="txt"
                    checked={verificationMethod === 'txt'}
                    onChange={() => setVerificationMethod('txt')}
                  />
                  <span className="text-sm">TXT record (recommended)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="verificationMethod"
                    value="cname"
                    checked={verificationMethod === 'cname'}
                    onChange={() => setVerificationMethod('cname')}
                  />
                  <span className="text-sm">CNAME record</span>
                </label>
              </div>
            </div>

            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
              <div className="flex gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="text-xs text-amber-800 dark:text-amber-300">
                  <p className="font-semibold">Requirements:</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    <li>You must control DNS for this domain</li>
                    <li>Bowin-owned domains (bowin.app, ashbi.ca) are rejected</li>
                    <li>One domain per organization</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowAttachModal(false);
                setNewHostname('');
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={attachMutation.isPending}>
              Attach domain
            </Button>
          </div>
        </form>
      </Modal>

      {/* Verification Instructions Modal */}
      <Modal
        isOpen={showVerificationModal}
        onClose={() => {
          setShowVerificationModal(false);
          setSelectedDomain(null);
        }}
        title="DNS verification instructions"
      >
        {selectedDomain && (
          <div className="space-y-4">
            <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Add the following DNS record to verify ownership of <strong>{selectedDomain.hostname}</strong>
              </p>
            </div>

            {selectedDomain.verificationMethod === 'txt' ? (
              <div className="space-y-2">
                <Label>TXT record for verification</Label>
                {(() => {
                  const record = getTxtRecord(selectedDomain);
                  return (
                    <>
                      <div className="rounded bg-slate-100 p-3 font-mono text-xs dark:bg-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Name:</span>
                          <button
                            type="button"
                            className="text-primary-600 hover:text-primary-700 dark:text-primary-400"
                            onClick={() => copyToClipboard(record.name)}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="mt-1 break-all text-slate-950 dark:text-white">{record.name}</div>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Type:</span>
                        </div>
                        <div className="mt-1 text-slate-950 dark:text-white">{record.type}</div>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Value:</span>
                          <button
                            type="button"
                            className="text-primary-600 hover:text-primary-700 dark:text-primary-400"
                            onClick={() => copyToClipboard(record.value)}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="mt-1 break-all text-slate-950 dark:text-white">{record.value}</div>
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>CNAME record for verification</Label>
                {(() => {
                  const record = getCnameRecord(selectedDomain);
                  return (
                    <div className="rounded bg-slate-100 p-3 font-mono text-xs dark:bg-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Name:</span>
                        <button
                          type="button"
                          className="text-primary-600 hover:text-primary-700 dark:text-primary-400"
                          onClick={() => copyToClipboard(record.name)}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-1 break-all text-slate-950 dark:text-white">{record.name}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Type:</span>
                      </div>
                      <div className="mt-1 text-slate-950 dark:text-white">{record.type}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Value:</span>
                        <button
                          type="button"
                          className="text-primary-600 hover:text-primary-700 dark:text-primary-400"
                          onClick={() => copyToClipboard(record.value)}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-1 break-all text-slate-950 dark:text-white">{record.value}</div>
                    </div>
                  );
                })()}
              </div>
            )}

            {selectedDomain.status === 'active' && (
              <div className="space-y-2">
                <Label>Production DNS (after activation)</Label>
                {(() => {
                  const record = getProductionDnsRecord(selectedDomain);
                  return (
                    <div className="rounded bg-slate-100 p-3 font-mono text-xs dark:bg-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Name:</span>
                        <button
                          type="button"
                          className="text-primary-600 hover:text-primary-700 dark:text-primary-400"
                          onClick={() => copyToClipboard(record.name)}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-1 break-all text-slate-950 dark:text-white">{record.name}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Type:</span>
                      </div>
                      <div className="mt-1 text-slate-950 dark:text-white">{record.type}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Value:</span>
                        <button
                          type="button"
                          className="text-primary-600 hover:text-primary-700 dark:text-primary-400"
                          onClick={() => copyToClipboard(record.value)}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-1 break-all text-slate-950 dark:text-white">{record.value}</div>
                    </div>
                  );
                })()}
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Replace verification record with this CNAME to serve traffic.
                </p>
              </div>
            )}

            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                <strong>Next steps:</strong>
              </p>
              <ol className="mt-1 list-inside list-decimal space-y-1 text-xs text-slate-600 dark:text-slate-300">
                <li>Add the DNS record at your domain provider</li>
                <li>Wait 5–10 minutes for DNS propagation</li>
                <li>Click &quot;Verify&quot; to check ownership</li>
                {selectedDomain.status === 'verified' && <li>Click &quot;Activate&quot; to start serving traffic</li>}
                {selectedDomain.status === 'active' && <li>Update DNS to production CNAME</li>}
              </ol>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              setShowVerificationModal(false);
              setSelectedDomain(null);
            }}
          >
            Close
          </Button>
        </div>
      </Modal>

      {/* Revoke Confirmation Modal */}
      <Modal
        isOpen={showRevokeModal}
        onClose={() => {
          setShowRevokeModal(false);
          setSelectedDomain(null);
          setRevokeReason('');
        }}
        title="Revoke custom domain"
      >
        {selectedDomain && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              revokeMutation.mutate(selectedDomain.id);
            }}
          >
            <div className="space-y-4">
              <div className="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
                <p className="text-sm text-red-800 dark:text-red-200">
                  Permanently revoke <strong>{selectedDomain.hostname}</strong>? This cannot be undone. The domain
                  will immediately stop serving traffic.
                </p>
              </div>

              <div>
                <Label htmlFor="revoke-reason">Reason (optional)</Label>
                <Input
                  id="revoke-reason"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g., Migrating to new domain"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowRevokeModal(false);
                  setSelectedDomain(null);
                  setRevokeReason('');
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="danger" loading={revokeMutation.isPending}>
                Revoke permanently
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
