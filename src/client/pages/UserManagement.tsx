import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  ShieldX,
  Mail,
  Calendar,
  MoreVertical,
  Check,
  X,
  ArrowLeft,
  Send,
  RefreshCw,
  Trash2,
  Clock,
} from 'lucide-react';
import { useAuth, getAuthHeaders } from '../context/AuthContext';
import { TableSkeleton } from '../components/ui/Skeleton';
import Spinner from '../components/ui/Spinner';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { Card, CardHeader, CardBody } from '../components/ui';
import { StatTile } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { Modal } from '../components/ui';
import { Select } from '../components/ui';
import { DataTable, TableHead, TableBody } from '../components/ui';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLogin: string | null;
}

interface Invitation {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  createdAt: string;
  tokenExpiry: string;
}

const ROLES = [
  { value: 'admin', label: 'Admin', description: 'Full system access' },
  { value: 'director', label: 'Director', description: 'Manage tournaments' },
  { value: 'scorekeeper', label: 'Scorekeeper', description: 'Record match results' },
  { value: 'viewer', label: 'Viewer', description: 'View-only access' },
];

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'viewer',
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<{ userId: string; userName: string; isActive: boolean } | null>(null);

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => {
      // Page through the API — server returns { users, total }.
      const pageSize = 200;
      const all: User[] = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const res = await fetch(`/api/auth/users?limit=${pageSize}&offset=${offset}`, {
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error('Failed to fetch users');
        const body = await res.json();
        // Back-compat if an older server still returns a bare array.
        const batch: User[] = Array.isArray(body) ? body : body.users || [];
        total = Array.isArray(body) ? batch.length : (body.total ?? batch.length);
        all.push(...batch);
        if (batch.length === 0) break;
        offset += batch.length;
      }
      return all;
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await fetch(`/api/auth/users/${userId}/role`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update role');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingRole(null);
      setSuccess('Role updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message);
      setTimeout(() => setError(null), 3000);
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const res = await fetch(`/api/auth/users/${userId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update status');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setSuccess('User status updated');
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message);
      setTimeout(() => setError(null), 3000);
    },
  });

  const { data: invitations, isLoading: invitationsLoading } = useQuery<Invitation[]>({
    queryKey: ['invitations'],
    queryFn: async () => {
      const res = await fetch('/api/invites', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch invitations');
      return res.json();
    },
  });

  const sendInviteMutation = useMutation({
    mutationFn: async (data: typeof inviteData) => {
      const res = await fetch('/api/invites/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to send invitation');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      setShowInviteModal(false);
      setInviteData({ email: '', firstName: '', lastName: '', role: 'viewer' });
      setSuccess(
        data.emailSent
          ? 'Invitation sent successfully'
          : 'Invitation created but email could not be sent (SMTP not configured)'
      );
      setTimeout(() => setSuccess(null), 5000);
    },
    onError: (err: Error) => {
      setError(err.message);
      setTimeout(() => setError(null), 5000);
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/invites/resend/${id}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to resend invitation');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      setSuccess(data.emailSent ? 'Invitation resent' : 'Invitation renewed but email not sent');
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message);
      setTimeout(() => setError(null), 3000);
    },
  });

  const cancelInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/invites/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to cancel invitation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      setSuccess('Invitation cancelled');
      setTimeout(() => setSuccess(null), 3000);
    },
  });

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-300';
      case 'director':
        return 'bg-primary-50 dark:bg-primary-900/30 text-primary-800 dark:text-primary-300';
      case 'scorekeeper':
        return 'bg-success/10 dark:bg-success/20 text-success';
      default:
        return 'bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-300';
    }
  };

  const handleSendInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    sendInviteMutation.mutate(inviteData);
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <ShieldX className="mx-auto h-12 w-12 text-danger" />
        <h2 className="mt-4 text-lg font-medium text-surface-900 dark:text-white">Access Denied</h2>
        <p className="mt-2 text-surface-600 dark:text-surface-400">You need admin privileges to access this page.</p>
        <Button as={Link} to="/dashboard" variant="primary" className="mt-4">
          Go to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="User Management"
        description="Manage system users and their roles"
        actions={
          <Button variant="primary" onClick={() => setShowInviteModal(true)}>
            <Send className="h-4 w-4 mr-2" />
            <span className="sr-only sm:not-sr-only">Invite User</span>
          </Button>
        }
      >
        <Link
          to="/dashboard"
          className="text-sm text-surface-600 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 flex items-center mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Dashboard
        </Link>
      </PageHeader>

      {/* Usage Stats — L3 from the UI audit. Quick "is the platform
          actually being used" indicators an admin would want at a
          glance. Reuses the existing /api/analytics/dashboard
          endpoint. */}
      <AnalyticsSummary />

      {/* Notifications */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center">
          <X className="h-5 w-5 text-red-500 dark:text-red-400 mr-2" />
          <span className="text-red-700 dark:text-red-300">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500 dark:text-red-400 hover:text-red-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center">
          <Check className="h-5 w-5 text-green-500 dark:text-green-400 mr-2" />
          <span className="text-green-700 dark:text-green-300">{success}</span>
        </div>
      )}

      {/* Users Table */}
      <Card>
        <CardBody className="p-0">
          {isLoading ? (
            <TableSkeleton rows={5} />
          ) : (
            <div className="overflow-x-auto">
              <DataTable>
                <TableHead>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Created</th>
                </TableHead>
                <TableBody>
                  {users?.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-surface-600 dark:text-surface-400">
                        <EmptyState
                          icon={Users}
                          title="No users found"
                          description="Invite users to get started"
                          action={{
                            label: 'Invite User',
                            onClick: () => setShowInviteModal(true),
                          }}
                        />
                      </td>
                    </tr>
                  ) : (
                    users?.map((user) => (
                      <tr key={user.id} className={`${!user.isActive ? 'bg-surface-50 dark:bg-surface-900/50' : ''} hover:bg-surface-50 dark:hover:bg-surface-700/50`}>
                        <td className="whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="h-10 w-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
                              <span className="text-lg font-medium text-primary-600 dark:text-primary-400">
                                {user.firstName[0]}
                                {user.lastName[0]}
                              </span>
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-surface-900 dark:text-white">
                                {user.firstName} {user.lastName}
                                {user.id === currentUser?.id && (
                                  <span className="ml-2 text-xs text-surface-600 dark:text-surface-400">(you)</span>
                                )}
                              </div>
                              <div className="text-sm text-surface-600 dark:text-surface-400 flex items-center">
                                <Mail className="h-3 w-3 mr-1" />
                                {user.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          {editingRole === user.id ? (
                            <Select
                              value={user.role}
                              onChange={(e) => {
                                updateRoleMutation.mutate({
                                  userId: user.id,
                                  role: e.target.value,
                                });
                              }}
                              onBlur={() => setEditingRole(null)}
                              autoFocus
                              className="text-sm py-1"
                            >
                              {ROLES.map((role) => (
                                <option key={role.value} value={role.value}>
                                  {role.label}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingRole(user.id)}
                              disabled={user.id === currentUser?.id}
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)} ${user.id !== currentUser?.id ? 'cursor-pointer hover:opacity-80' : ''}`}
                            >
                              <Shield className="h-3 w-3 mr-1" />
                              {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                            </Button>
                          )}
                        </td>
                        <td className="whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setPendingToggle({
                                userId: user.id,
                                userName: `${user.firstName} ${user.lastName}`,
                                isActive: !user.isActive,
                              })
                            }
                            disabled={user.id === currentUser?.id}
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              user.isActive
                                ? 'bg-success/10 dark:bg-success/20 text-success'
                                : 'bg-danger/10 dark:bg-danger/20 text-danger'
                            } ${user.id !== currentUser?.id ? 'cursor-pointer hover:opacity-80' : ''}`}
                          >
                            {user.isActive ? (
                              <>
                                <ShieldCheck className="h-3 w-3 mr-1" />
                                Active
                              </>
                            ) : (
                              <>
                                <ShieldX className="h-3 w-3 mr-1" />
                                Disabled
                              </>
                            )}
                          </Button>
                        </td>
                        <td className="whitespace-nowrap text-sm text-surface-600 dark:text-surface-400">
                          {user.lastLogin ? (
                            <div className="flex items-center">
                              <Calendar className="h-3 w-3 mr-1" />
                              {new Date(user.lastLogin).toLocaleDateString()}
                            </div>
                          ) : (
                            <span className="text-surface-600 dark:text-surface-500">Never</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-sm text-surface-600 dark:text-surface-500">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))
                  )}
                </TableBody>
              </DataTable>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Roles Legend */}
      <Card className="mt-6">
        <CardHeader title="Role Permissions" />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {ROLES.map((role) => (
              <div key={role.value} className="flex items-start">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${getRoleBadgeColor(
                    role.value
                  )}`}
                >
                  {role.label}
                </span>
                <span className="ml-2 text-sm text-surface-600 dark:text-surface-400">{role.description}</span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Pending Invitations */}
      {invitations && invitations.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Invitations"
            action={<Mail className="h-4 w-4 text-surface-600" />}
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <DataTable>
                <TableHead>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Actions</th>
                </TableHead>
                <TableBody>
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface-50 dark:hover:bg-surface-700/50">
                      <td className="whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-surface-900 dark:text-white">
                            {inv.firstName || inv.lastName
                              ? `${inv.firstName || ''} ${inv.lastName || ''}`.trim()
                              : inv.email}
                          </div>
                          {(inv.firstName || inv.lastName) && (
                            <div className="text-sm text-surface-600 dark:text-surface-400">{inv.email}</div>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(inv.role)}`}>
                          {inv.role.charAt(0).toUpperCase() + inv.role.slice(1)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            inv.status === 'pending'
                              ? 'bg-warning/10 dark:bg-warning/20 text-warning'
                              : inv.status === 'accepted'
                              ? 'bg-success/10 dark:bg-success/20 text-success'
                              : 'bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-300'
                          }`}
                        >
                          <Clock className="h-3 w-3 mr-1" />
                          {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-sm text-surface-600 dark:text-surface-400">
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </td>
                      <td className="whitespace-nowrap">
                        {inv.status === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => resendInviteMutation.mutate(inv.id)}
                              disabled={resendInviteMutation.isPending}
                              className="text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300"
                              title="Resend"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => cancelInviteMutation.mutate(inv.id)}
                              disabled={cancelInviteMutation.isPending}
                              className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                              title="Cancel"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                        {inv.status !== 'pending' && (
                          <button
                            onClick={() => cancelInviteMutation.mutate(inv.id)}
                            disabled={cancelInviteMutation.isPending}
                            className="text-surface-600 dark:text-surface-500 hover:text-danger"
                            title="Remove"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </TableBody>
              </DataTable>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Toggle User Status Confirmation */}
      <ConfirmDialog
        isOpen={!!pendingToggle}
        onClose={() => setPendingToggle(null)}
        onConfirm={() => {
          if (pendingToggle) {
            toggleStatusMutation.mutate({
              userId: pendingToggle.userId,
              isActive: pendingToggle.isActive,
            });
            setPendingToggle(null);
          }
        }}
        title={pendingToggle?.isActive ? 'Activate User' : 'Deactivate User'}
        message={
          pendingToggle?.isActive
            ? `Are you sure you want to activate ${pendingToggle.userName}? They will regain access to the system.`
            : `Are you sure you want to deactivate ${pendingToggle?.userName}? They will lose access to the system.`
        }
        confirmText={pendingToggle?.isActive ? 'Activate' : 'Deactivate'}
        variant={pendingToggle?.isActive ? 'info' : 'danger'}
        isLoading={toggleStatusMutation.isPending}
      />

      {/* Invite User Modal */}
      {showInviteModal && (
        <Modal
          isOpen={showInviteModal}
          onClose={() => {
            setShowInviteModal(false);
            setInviteData({ email: '', firstName: '', lastName: '', role: 'viewer' });
            setError(null);
          }}
          title="Invite User"
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteData({ email: '', firstName: '', lastName: '', role: 'viewer' });
                  setError(null);
                }}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="invite-user-form"
                variant="primary"
                loading={sendInviteMutation.isPending}
                className="w-full sm:w-auto flex items-center justify-center"
              >
                {sendInviteMutation.isPending ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Invitation
                  </>
                )}
              </Button>
            </>
          }
        >
          <form id="invite-user-form" onSubmit={handleSendInvite} className="space-y-4">
            <div>
              <Label required>Email</Label>
              <Input
                type="email"
                required
                value={inviteData.email}
                onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                placeholder="user@example.com"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>First Name</Label>
                <Input
                  type="text"
                  value={inviteData.firstName}
                  onChange={(e) => setInviteData({ ...inviteData, firstName: e.target.value })}
                />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input
                  type="text"
                  value={inviteData.lastName}
                  onChange={(e) => setInviteData({ ...inviteData, lastName: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Role</Label>
              <Select
                value={inviteData.role}
                onChange={(e) => setInviteData({ ...inviteData, role: e.target.value })}
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label} — {role.description}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-sm text-surface-600 dark:text-surface-400">
              An email will be sent with a link to set up their account. The invitation expires in 72 hours.
            </p>
          </form>
        </Modal>
      )}
    </div>
  );
}

// AnalyticsSummary — small usage-stats panel for the User Management page.
// Reuses the existing /api/analytics/dashboard endpoint so we don't add a
// new server route. Closes L3 from the UI audit (usage stats on the
// admin page). Audit log itself is out of scope (deferred per brief).
function AnalyticsSummary() {
  const { data: analytics, isLoading } = useQuery<{
    totals: { competitors: number; tournaments: number; matches: number };
    completedMatches: number;
    recentRegistrations: number;
    activeUsersLast30Days?: number;
  }>({
    queryKey: ['analytics', 'dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/dashboard', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return res.json();
    },
    staleTime: 60_000,
  });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <StatTile label="Total competitors" value={isLoading ? '…' : analytics?.totals.competitors ?? 0} />
      <StatTile label="Tournaments" value={isLoading ? '…' : analytics?.totals.tournaments ?? 0} />
      <StatTile
        label="Matches completed"
        value={isLoading ? '…' : analytics?.completedMatches ?? 0}
        trend={`${analytics?.totals.matches ?? 0} total`}
      />
      <StatTile
        label="Registrations (30d)"
        value={isLoading ? '…' : analytics?.recentRegistrations ?? 0}
        trend={analytics?.activeUsersLast30Days != null ? `${analytics.activeUsersLast30Days} active directors` : undefined}
      />
    </div>
  );
}
