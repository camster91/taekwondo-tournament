import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  User,
  Mail,
  Save,
  ArrowLeft,
  Shield,
  Calendar,
  Trash2,
} from 'lucide-react';
import { useAuth, getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/ui/Spinner';
import { Card, CardHeader, CardBody, Modal } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';

export default function Profile() {
  const { user, refreshUser, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const [profileData, setProfileData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string }) => {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update profile');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Profile updated successfully');
      refreshUser();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/auth/gdpr/delete-account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'The account could not be deleted.');
      }
    },
    onSuccess: async () => {
      await logout();
      navigate('/login', { replace: true });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate(profileData);
  };

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-surface-600 dark:text-surface-400">Please log in to view your profile.</p>
        <Button as={Link} to="/login" variant="primary" className="mt-4">
          Go to Login
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <PageHeader
        title="Profile Settings"
        description="Manage your account information"
      >
        <Link
          to="/dashboard"
          className="text-sm text-surface-600 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 flex items-center mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Dashboard
        </Link>
      </PageHeader>

      {/* Account Info */}
      <Card className="mb-6">
        <CardHeader title="Account Information" />
        <CardBody>
          <div className="space-y-4">
            <div className="flex items-center">
              <div className="p-2 bg-surface-100 dark:bg-surface-700 rounded-lg mr-3">
                <Mail className="h-5 w-5 text-surface-600 dark:text-surface-400" />
              </div>
              <div>
                <p className="text-sm text-surface-600 dark:text-surface-400">Email</p>
                <p className="font-medium text-surface-900 dark:text-white">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center">
              <div className="p-2 bg-surface-100 dark:bg-surface-700 rounded-lg mr-3">
                <Shield className="h-5 w-5 text-surface-600 dark:text-surface-400" />
              </div>
              <div>
                <p className="text-sm text-surface-600 dark:text-surface-400">Role</p>
                <p className="font-medium text-surface-900 dark:text-white capitalize">{user.role}</p>
              </div>
            </div>
            <div className="flex items-center">
              <div className="p-2 bg-surface-100 dark:bg-surface-700 rounded-lg mr-3">
                <Calendar className="h-5 w-5 text-surface-600 dark:text-surface-400" />
              </div>
              <div>
                <p className="text-sm text-surface-600 dark:text-surface-400">Member Since</p>
                <p className="font-medium text-surface-900 dark:text-white">
                  {user.createdAt
                    ? new Date(user.createdAt).toLocaleDateString()
                    : 'N/A'}
                </p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Profile Form */}
      <Card>
        <CardHeader title="Edit Profile" />
        <CardBody>
          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>First Name</Label>
                <Input
                  type="text"
                  required
                  value={profileData.firstName}
                  onChange={(e) =>
                    setProfileData({ ...profileData, firstName: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input
                  type="text"
                  required
                  value={profileData.lastName}
                  onChange={(e) =>
                    setProfileData({ ...profileData, lastName: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                disabled={updateProfileMutation.isPending}
                loading={updateProfileMutation.isPending}
              >
                {updateProfileMutation.isPending ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {/* P2-15: GDPR Data Export */}
      <Card className="mt-6">
        <CardHeader title="Data Export" />
        <CardBody>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-lg text-sm text-surface-600 dark:text-surface-400">
              Download all your personal data in JSON format. This includes your profile, organization memberships, tournament access, and audit logs (GDPR compliance).
            </p>
            <Button 
              variant="secondary" 
              onClick={async () => {
                try {
                  const response = await fetch('/api/auth/gdpr/export', {
                    method: 'GET',
                    headers: getAuthHeaders(),
                  });
                  if (!response.ok) throw new Error('Export failed');
                  const blob = await response.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `bowin-data-export-${user.email}.json`;
                  document.body.appendChild(a);
                  a.click();
                  window.URL.revokeObjectURL(url);
                  document.body.removeChild(a);
                  toast.success('Data exported successfully');
                } catch (err) {
                  toast.error('Failed to export data');
                }
              }}
            >
              Download My Data
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="mt-6 border-red-200 dark:border-red-900/70">
        <CardHeader title="Delete account" />
        <CardBody>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-lg text-sm text-surface-600 dark:text-surface-400">
              First export and close every organization you own. Account deletion removes your profile and sign-in records permanently.
            </p>
            <Button variant="danger" onClick={() => setShowDelete(true)}>
              <Trash2 className="h-4 w-4" /> Delete account
            </Button>
          </div>
        </CardBody>
      </Card>

      <Modal
        isOpen={showDelete}
        onClose={() => !deleteAccountMutation.isPending && setShowDelete(false)}
        title="Delete account"
        subtitle="This permanently removes your profile and sign-in records."
        footer={(
          <>
            <Button variant="secondary" disabled={deleteAccountMutation.isPending} onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={deleteAccountMutation.isPending}
              disabled={deleteConfirmation !== 'DELETE MY ACCOUNT'}
              onClick={() => deleteAccountMutation.mutate()}
            >
              Permanently delete account
            </Button>
          </>
        )}
      >
        <p className="mb-4 text-sm text-surface-700 dark:text-surface-300">
          Type <strong className="font-mono">DELETE MY ACCOUNT</strong> to confirm.
        </p>
        <Label htmlFor="account-delete-confirmation">Confirmation phrase</Label>
        <Input
          id="account-delete-confirmation"
          type="text"
          autoComplete="off"
          placeholder="DELETE MY ACCOUNT"
          value={deleteConfirmation}
          onChange={(event) => setDeleteConfirmation(event.target.value)}
        />
      </Modal>
    </div>
  );
}
