import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Settings,
} from 'lucide-react';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  status: string;
  settings: string | null;
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
};

export default function TournamentSettings() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<TournamentSettings>(DEFAULT_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: tournament, isLoading } = useQuery<Tournament>({
    queryKey: ['tournament', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}`);
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

  const saveMutation = useMutation({
    mutationFn: async (newSettings: TournamentSettings) => {
      const res = await fetch(`/api/tournaments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: newSettings,
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setHasChanges(false);
      alert('Settings saved!');
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
    if (confirm('Reset all settings to defaults?')) {
      setSettings(DEFAULT_SETTINGS);
      setHasChanges(true);
    }
  };

  if (isLoading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            to={`/tournaments/${id}`}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Tournament
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Settings - {tournament?.name}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Configure tournament rules and categorization
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={resetToDefaults} className="btn btn-secondary">
            Reset to Defaults
          </button>
          <button
            onClick={() => saveMutation.mutate(settings)}
            disabled={!hasChanges || saveMutation.isPending}
            className="btn btn-primary"
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* General Settings */}
      <div className="card mb-6">
        <div className="card-header">
          <h2 className="text-lg font-medium flex items-center">
            <Settings className="h-5 w-5 mr-2" />
            General Settings
          </h2>
        </div>
        <div className="card-body">
          <div className="max-w-md">
            <label className="form-label">
              Division Split Threshold
              <span className="text-gray-500 font-normal ml-2">
                (max competitors per division)
              </span>
            </label>
            <input
              type="number"
              min="2"
              max="16"
              value={settings.divisionThreshold}
              onChange={(e) =>
                updateSettings({ divisionThreshold: parseInt(e.target.value) || 8 })
              }
              className="form-input w-32"
            />
            <p className="mt-1 text-sm text-gray-500">
              Divisions with more competitors will be split (e.g., DIV1, DIV2)
            </p>
          </div>
        </div>
      </div>

      {/* Age Groups */}
      <div className="card mb-6">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-medium">Age Groups</h2>
          <button onClick={addAgeGroup} className="btn btn-secondary text-sm">
            <Plus className="h-4 w-4 mr-1" />
            Add Age Group
          </button>
        </div>
        <div className="card-body p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Min Age</th>
                <th>Max Age</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {settings.ageGroups.map((group, index) => (
                <tr key={index}>
                  <td>
                    <input
                      type="text"
                      value={group.label}
                      onChange={(e) =>
                        updateAgeGroup(index, { label: e.target.value })
                      }
                      className="form-input w-24"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={group.min}
                      onChange={(e) =>
                        updateAgeGroup(index, { min: parseInt(e.target.value) || 0 })
                      }
                      className="form-input w-20"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={group.max}
                      onChange={(e) =>
                        updateAgeGroup(index, { max: parseInt(e.target.value) || 99 })
                      }
                      className="form-input w-20"
                    />
                  </td>
                  <td>
                    <button
                      onClick={() => removeAgeGroup(index)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Weight Classes Info */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-medium">Weight Classes</h2>
        </div>
        <div className="card-body">
          <p className="text-sm text-gray-600 mb-4">
            Weight classes are configured in the system defaults. The auto-categorization
            engine uses standard weight brackets based on age and gender.
          </p>
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-2">Default Weight Classes:</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="font-medium">Feather</p>
                <p className="text-gray-500">Lightest category</p>
              </div>
              <div>
                <p className="font-medium">Light</p>
                <p className="text-gray-500">Below average</p>
              </div>
              <div>
                <p className="font-medium">Middle</p>
                <p className="text-gray-500">Average weight</p>
              </div>
              <div>
                <p className="font-medium">Heavy</p>
                <p className="text-gray-500">Above average</p>
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-500">
            Weight boundaries are automatically adjusted based on age group and gender.
            Contact support for custom weight class configurations.
          </p>
        </div>
      </div>

      {/* Unsaved Changes Warning */}
      {hasChanges && (
        <div className="fixed bottom-4 right-4 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
          <span>You have unsaved changes</span>
          <button
            onClick={() => saveMutation.mutate(settings)}
            className="btn btn-primary text-sm py-1"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
