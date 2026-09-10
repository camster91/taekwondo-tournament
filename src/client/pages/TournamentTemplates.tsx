import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Edit, Trash2, RotateCcw, FileText, Trophy } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';

interface TournamentTemplate {
  id: string;
  name: string;
  description: string | null;
  sportProfileSlug: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function TournamentTemplates() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<TournamentTemplate[]>({
    queryKey: ['tournament-templates', showDeleted],
    queryFn: async () => {
      const url = showDeleted
        ? '/api/tournament-templates?trash=true'
        : '/api/tournament-templates';
      const response = await fetch(url, { headers: getAuthHeaders() });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to load templates');
      }
      return response.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/tournament-templates/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to delete template');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament-templates'] });
      toast.show('Template deleted successfully', 'success');
      setDeleteId(null);
    },
    onError: (error: Error) => {
      toast.show(error.message || 'Failed to delete template', 'error');
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/tournament-templates/${id}/restore`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to restore template');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament-templates'] });
      toast.show('Template restored successfully', 'success');
    },
    onError: (error: Error) => {
      toast.show(error.message || 'Failed to restore template', 'error');
    },
  });

  const activeTemplates = templates?.filter(t => !t.deletedAt) || [];
  const deletedTemplates = templates?.filter(t => t.deletedAt) || [];
  const displayTemplates = showDeleted ? deletedTemplates : activeTemplates;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Tournament Templates"
        subtitle="Create reusable templates for faster tournament setup"
        icon={FileText}
        actions={[
          <Button
            key="new"
            as={Link}
            to="/tournament-templates/new"
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New Template
          </Button>,
        ]}
      />

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant={showDeleted ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => setShowDeleted(false)}
          >
            Active ({activeTemplates.length})
          </Button>
          <Button
            variant={showDeleted ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowDeleted(true)}
          >
            Deleted ({deletedTemplates.length})
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : displayTemplates.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <FileText className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-600" />
            <h3 className="mt-4 text-lg font-semibold text-slate-700 dark:text-slate-200">
              {showDeleted ? 'No deleted templates' : 'No templates yet'}
            </h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {showDeleted
                ? 'Templates you delete will appear here for 7 days before being permanently removed.'
                : 'Create your first tournament template to speed up future event setup.'}
            </p>
            {!showDeleted && (
              <Button
                as={Link}
                to="/tournament-templates/new"
                className="mt-4 inline-flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Create Template
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {displayTemplates.map((template) => (
            <Card key={template.id}>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <Trophy className="h-5 w-5 text-primary-500" />
                    <div>
                      <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                        {template.name}
                      </h3>
                      {template.description && (
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          {template.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                        <span>Sport: {template.sportProfileSlug}</span>
                        <span>
                          Created {new Date(template.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {template.deletedAt ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => restoreMutation.mutate(template.id)}
                      disabled={restoreMutation.isPending}
                      className="flex items-center gap-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {restoreMutation.isPending ? 'Restoring...' : 'Restore'}
                    </Button>
                  ) : (
                    <>
                      <Button
                        as={Link}
                        to={`/tournament-templates/${template.id}/edit`}
                        variant="secondary"
                        size="sm"
                        className="flex items-center gap-2"
                      >
                        <Edit className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleteId(template.id)}
                        className="flex items-center gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="Delete Template"
        message="Are you sure you want to delete this template? You can restore it from the deleted section for 7 days."
        confirmText="Delete"
        confirmVariant="danger"
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
        }}
        onCancel={() => setDeleteId(null)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
