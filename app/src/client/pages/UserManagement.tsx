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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
  });
  const [inviteData, setInviteData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'viewer',
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/auth/users', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch users');
      return res.json();
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (userData: typeof newUser) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(userData),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create user');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreateModal(false);
      setNewUser({ email: '', password: '', firstName: '', lastName: '' });
      setSuccess('User created successfully');
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message);
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
        return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300';
      case 'director':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300';
      case 'scorekeeper':
        return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300';
    }
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    createUserMutation.mutate(newUser);
  };

  const handleSendInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    sendInviteMutation.mutate(inviteData);
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <ShieldX className="mx-auto h-12 w-12 text-red-400 dark:text-red-500" />
        <h2 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">Access Denied</h2>
        <p className="mt-2 text-gray-500 dark:text-gray-400">You need admin privileges to access this page.</p>
        <Link to="/" className="mt-4 btn btn-primary inline-block">
          Go to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header mb-6">
        <div>
          <Link
            to="/"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Dashboard
          </Link>
          <h1 className="page-title flex items-center">
            <Users className="h-6 w-6 mr-2 text-primary-600 dark:text-primary-400" />
            User Management
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage system users and their roles
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowInviteModal(true)} className="btn btn-primary">
            <Send className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Invite User</span>
          </button>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-secondary">
            <UserPlus className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Add User</span>
          </button>
        </div>
      </div>

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
      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={5} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                {users?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                      No users found
                    </td>
                  </tr>
                ) : (
                  users?.map((user) => (
                    <tr key={user.id} className={`${!user.isActive ? 'bg-gray-50 dark:bg-gray-900/50' : ''} hover:bg-gray-50 dark:hover:bg-gray-700/50`}>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="h-10 w-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
                            <span className="text-lg font-medium text-primary-600 dark:text-primary-400">
                              {user.firstName[0]}
                              {user.lastName[0]}
                            </span>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">
                              {user.firstName} {user.lastName}
                              {user.id === currentUser?.id && (
                                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">(you)</span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center">
                              <Mail className="h-3 w-3 mr-1" />
                              {user.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        {editingRole === user.id ? (
                          <select
                            value={user.role}
                            onChange={(e) => {
                              updateRoleMutation.mutate({
                                userId: user.id,
                                role: e.target.value,
                              });
                            }}
                            onBlur={() => setEditingRole(null)}
                            autoFocus
                            className="form-input text-sm py-1"
                          >
                            {ROLES.map((role) => (
                              <option key={role.value} value={role.value}>
                                {role.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button
                            onClick={() => setEditingRole(user.id)}
                            disabled={user.id === currentUser?.id}
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(
                              user.role
                            )} ${user.id !== currentUser?.id ? 'cursor-pointer hover:opacity-80' : ''}`}
                          >
                            <Shield className="h-3 w-3 mr-1" />
                            {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <button
                          onClick={() =>
                            toggleStatusMutation.mutate({
                              userId: user.id,
                              isActive: !user.isActive,
                            })
                          }
                          disabled={user.id === currentUser?.id}
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            user.isActive
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
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
                        </button>
                      </td>
                      <td className="whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {user.lastLogin ? (
                          <div className="flex items-center">
                            <Calendar className="h-3 w-3 mr-1" />
                            {new Date(user.lastLogin).toLocaleDateString()}
                          </div>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">Never</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-sm text-gray-400 dark:text-gray-500">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Roles Legend */}
      <div className="mt-6 card">
        <div className="card-header">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">Role Permissions</h3>
        </div>
        <div className="card-body">
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
                <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">{role.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pending Invitations */}
      {invitations && invitations.length > 0 && (
        <div className="mt-6 card">
          <div className="card-header">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white flex items-center">
              <Mail className="h-4 w-4 mr-2" />
              Invitations
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                {invitations.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {inv.firstName || inv.lastName
                            ? `${inv.firstName || ''} ${inv.lastName || ''}`.trim()
                            : inv.email}
                        </div>
                        {(inv.firstName || inv.lastName) && (
                          <div className="text-sm text-gray-500 dark:text-gray-400">{inv.email}</div>
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
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                            : inv.status === 'accepted'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                        }`}
                      >
                        <Clock className="h-3 w-3 mr-1" />
                        {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
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
                          className="text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400"
                          title="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invite User Modal */}
      {showInviteModal && (
        <div className="modal-container flex items-center justify-center p-4">
          <div className="modal-backdrop" onClick={() => {
            setShowInviteModal(false);
            setInviteData({ email: '', firstName: '', lastName: '', role: 'viewer' });
            setError(null);
          }} />
          <div className="modal-panel max-w-md">
            <div className="modal-header">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Invite User</h2>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteData({ email: '', firstName: '', lastName: '', role: 'viewer' });
                  setError(null);
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSendInvite}>
              <div className="modal-body space-y-4">
                <div>
                  <label className="form-label">Email <span className="text-red-500">*</span></label>
                  <input
                    type="email"
                    required
                    value={inviteData.email}
                    onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                    className="form-input w-full"
                    placeholder="user@example.com"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">First Name</label>
                    <input
                      type="text"
                      value={inviteData.firstName}
                      onChange={(e) => setInviteData({ ...inviteData, firstName: e.target.value })}
                      className="form-input w-full"
                    />
                  </div>
                  <div>
                    <label className="form-label">Last Name</label>
                    <input
                      type="text"
                      value={inviteData.lastName}
                      onChange={(e) => setInviteData({ ...inviteData, lastName: e.target.value })}
                      className="form-input w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="form-label">Role</label>
                  <select
                    value={inviteData.role}
                    onChange={(e) => setInviteData({ ...inviteData, role: e.target.value })}
                    className="form-input w-full"
                  >
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label} — {role.description}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  An email will be sent with a link to set up their account. The invitation expires in 72 hours.
                </p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteModal(false);
                    setInviteData({ email: '', firstName: '', lastName: '', role: 'viewer' });
                    setError(null);
                  }}
                  className="btn btn-secondary w-full sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendInviteMutation.isPending}
                  className="btn btn-primary w-full sm:w-auto flex items-center justify-center"
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
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="modal-container flex items-center justify-center p-4">
          <div className="modal-backdrop" onClick={() => {
            setShowCreateModal(false);
            setNewUser({ email: '', password: '', firstName: '', lastName: '' });
            setError(null);
          }} />
          <div className="modal-panel max-w-md">
            <div className="modal-header">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create New User</h2>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewUser({ email: '', password: '', firstName: '', lastName: '' });
                  setError(null);
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateUser}>
              <div className="modal-body space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">First Name</label>
                    <input
                      type="text"
                      required
                      value={newUser.firstName}
                      onChange={(e) =>
                        setNewUser({ ...newUser, firstName: e.target.value })
                      }
                      className="form-input w-full"
                    />
                  </div>
                  <div>
                    <label className="form-label">Last Name</label>
                    <input
                      type="text"
                      required
                      value={newUser.lastName}
                      onChange={(e) =>
                        setNewUser({ ...newUser, lastName: e.target.value })
                      }
                      className="form-input w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="form-label">Email</label>
                  <input
                    type="email"
                    required
                    value={newUser.email}
                    onChange={(e) =>
                      setNewUser({ ...newUser, email: e.target.value })
                    }
                    className="form-input w-full"
                  />
                </div>
                <div>
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newUser.password}
                    onChange={(e) =>
                      setNewUser({ ...newUser, password: e.target.value })
                    }
                    className="form-input w-full"
                    placeholder="Minimum 8 characters"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewUser({ email: '', password: '', firstName: '', lastName: '' });
                    setError(null);
                  }}
                  className="btn btn-secondary w-full sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createUserMutation.isPending}
                  className="btn btn-primary w-full sm:w-auto flex items-center justify-center"
                >
                  {createUserMutation.isPending ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      Creating...
                    </>
                  ) : (
                    'Create User'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
