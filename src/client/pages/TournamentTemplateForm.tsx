import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, Input, Label, PageHeader, Spinner } from '../components/ui';
import { DEFAULT_WEIGHT_CLASSES, type WeightClassConfig } from '../../shared/constants/weight-classes';
import TournamentRulesEditor from '../components/TournamentRulesEditor';
import { DEFAULT_TOURNAMENT_RULES, type TournamentRules } from '../../shared/constants/tournament-rules';

interface TournamentSettings {
  divisionThreshold?: number;
  ageGroups?: Array<{ min: number; max: number; label: string }>;
  weightClasses?: WeightClassConfig[];
}

export default function TournamentTemplateForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEdit = !!id;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sportProfileSlug, setSportProfileSlug] = useState('taekwondo');
  const [settings, setSettings] = useState<TournamentSettings>({
    divisionThreshold: 8,
    ageGroups: [
      { min: 4, max: 5, label: '4-5' },
      { min: 6, max: 7, label: '6-7' },
      { min: 8, max: 9, label: '8-9' },
      { min: 10, max: 11, label: '10-11' },
      { min: 12, max: 14, label: '12-14' },
      { min: 15, max: 17, label: '15-17' },
      { min: 18, max: 35, label: '18-35' },
      { min: 36, max: 99, label: '36+' },
    ],
  });
  const [rules, setRules] = useState<TournamentRules>(DEFAULT_TOURNAMENT_RULES);
  const [weightClasses, setWeightClasses] = useState<WeightClassConfig[]>(DEFAULT_WEIGHT_CLASSES);

  const { data: template, isLoading } = useQuery({
    queryKey: ['tournament-template', id],
    queryFn: async () => {
      const response = await fetch(`/api/tournament-templates/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to load template');
      }
      return response.json();
    },
    enabled: isEdit,
  });

  useEffect(() => {
    if (template) {
      setName(template.name || '');
      setDescription(template.description || '');
      setSportProfileSlug(template.sportProfileSlug || 'taekwondo');
      
      if (template.settings) {
        try {
          const parsedSettings = JSON.parse(template.settings);
          setSettings(parsedSettings);
        } catch (err) {
          console.error('Failed to parse template settings:', err);
        }
      }
      
      if (template.rules) {
        try {
          const parsedRules = JSON.parse(template.rules);
          setRules(parsedRules);
        } catch (err) {
          console.error('Failed to parse template rules:', err);
        }
      }
      
      if (template.weightClasses) {
        try {
          const parsedWeightClasses = JSON.parse(template.weightClasses);
          setWeightClasses(parsedWeightClasses);
        } catch (err) {
          console.error('Failed to parse template weight classes:', err);
        }
      }
    }
  }, [template]);

  const saveMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      description: string;
      sportProfileSlug: string;
      settings: TournamentSettings;
      rules: TournamentRules;
      weightClasses: WeightClassConfig[];
    }) => {
      const url = isEdit
        ? `/api/tournament-templates/${id}`
        : '/api/tournament-templates';
      const method = isEdit ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error((errorData as { error?: string }).error || 'Failed to save template');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament-templates'] });
      toast.addToast(
        isEdit ? 'Template updated successfully' : 'Template created successfully',
        'success'
      );
      navigate('/tournament-templates');
    },
    onError: (error: Error) => {
      toast.addToast(error.message || 'Failed to save template', 'error');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast.addToast('Template name is required', 'error');
      return;
    }
    
    saveMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      sportProfileSlug,
      settings,
      rules,
      weightClasses,
    });
  };

  if (isEdit && isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={isEdit ? 'Edit Template' : 'New Template'}
        description="Define default settings for faster tournament creation"
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Template Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Spring Championship Template"
                required
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes about when to use this template"
                className="w-full rounded-lg border border-surface-200 px-4 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100"
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="sport">Sport</Label>
              <select
                id="sport"
                value={sportProfileSlug}
                onChange={(e) => setSportProfileSlug(e.target.value)}
                className="w-full rounded-lg border border-surface-200 px-4 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100"
              >
                <option value="taekwondo">Taekwondo</option>
                <option value="karate">Karate</option>
                <option value="judo">Judo</option>
                <option value="bjj">Brazilian Jiu-Jitsu</option>
                <option value="kickboxing">Kickboxing</option>
                <option value="muay-thai">Muay Thai</option>
                <option value="boxing">Boxing</option>
                <option value="fencing">Fencing</option>
                <option value="wrestling">Wrestling</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <Label htmlFor="divisionThreshold">Division Threshold</Label>
              <Input
                id="divisionThreshold"
                type="number"
                min={4}
                max={32}
                value={settings.divisionThreshold || 8}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    divisionThreshold: parseInt(e.target.value, 10) || 8,
                  })
                }
              />
              <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                Maximum number of competitors per division before splitting
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-semibold text-surface-800 dark:text-surface-100">
            Tournament Rules
          </h3>
          <TournamentRulesEditor
            rules={rules}
            onChange={setRules}
            onReset={() => setRules(DEFAULT_TOURNAMENT_RULES)}
          />
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-semibold text-surface-800 dark:text-surface-100">
            Weight Classes ({weightClasses.length})
          </h3>
          <p className="mb-4 text-sm text-surface-600 dark:text-surface-300">
            Weight classes will be copied to tournaments created from this template.
          </p>
          <div className="space-y-2">
            {weightClasses.map((wc, index) => (
              <div
                key={index}
                className="flex items-center gap-4 rounded-lg border border-surface-200 p-3 dark:border-surface-700"
              >
                <span className="font-medium text-surface-700 dark:text-surface-200">
                  {wc.name}
                </span>
                <span className="text-sm text-surface-500 dark:text-surface-400">
                  {wc.weightMinLbs}–{wc.weightMaxLbs} lbs
                </span>
                {wc.gender && (
                  <span className="text-sm text-surface-500 dark:text-surface-400">
                    {wc.gender === 'M' ? 'Male' : 'Female'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/tournament-templates')}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? 'Saving...' : isEdit ? 'Update Template' : 'Create Template'}
          </Button>
        </div>
      </form>
    </div>
  );
}
