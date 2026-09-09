// P2-18: Onboarding checklist component
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle, Circle, Building2, Upload, Trophy, Eye, UserPlus } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { Button } from './ui';

interface OnboardingChecklistData {
  id: string;
  userId: string;
  orgProfileComplete: boolean;
  importComplete: boolean;
  firstTournamentDone: boolean;
  publicPageReviewed: boolean;
  staffInvited: boolean;
  dismissed: boolean;
  createdAt: string;
  updatedAt: string;
}

const steps = [
  { 
    key: 'orgProfileComplete', 
    label: 'Set up organization profile', 
    description: 'Add your organization name, logo, and branding',
    icon: Building2,
  },
  { 
    key: 'importComplete', 
    label: 'Import competitors', 
    description: 'Upload your competitor roster or create your first event',
    icon: Upload,
  },
  { 
    key: 'firstTournamentDone', 
    label: 'Create first tournament', 
    description: 'Set up your first tournament with dates and settings',
    icon: Trophy,
  },
  { 
    key: 'publicPageReviewed', 
    label: 'Review public registration page', 
    description: 'Check your public registration and scoreboard pages',
    icon: Eye,
  },
  { 
    key: 'staffInvited', 
    label: 'Invite staff (optional)', 
    description: 'Invite scorekeepers or directors to help run events',
    icon: UserPlus,
  },
];

export default function OnboardingChecklist() {
  const queryClient = useQueryClient();
  const [isMinimized, setIsMinimized] = useState(false);

  const { data: checklist, isLoading } = useQuery<OnboardingChecklistData>({
    queryKey: ['onboarding'],
    queryFn: async () => {
      const res = await fetch('/api/auth/onboarding', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch onboarding checklist');
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { step?: string; dismissed?: boolean }) => {
      const res = await fetch('/api/auth/onboarding', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update onboarding checklist');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  // Don't show if dismissed or all steps complete
  if (isLoading || !checklist || checklist.dismissed) return null;

  const completedSteps = steps.filter((step) => checklist[step.key as keyof OnboardingChecklistData]).length;
  const allComplete = completedSteps === steps.length;

  if (allComplete) return null;

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg shadow-lg hover:bg-primary-700 transition-colors"
        >
          <Trophy className="h-5 w-5" />
          <span className="font-medium">{completedSteps}/5 Setup Complete</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-full max-w-md">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Trophy className="h-5 w-5" />
            <h3 className="font-semibold">Getting Started</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMinimized(true)}
              className="text-white/80 hover:text-white p-1 rounded transition-colors"
              aria-label="Minimize"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <button
              onClick={() => updateMutation.mutate({ dismissed: true })}
              className="text-white/80 hover:text-white p-1 rounded transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-700 dark:text-gray-300 font-medium">
              {completedSteps} of {steps.length} completed
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              {Math.round((completedSteps / steps.length) * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-primary-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(completedSteps / steps.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          {steps.map((step) => {
            const isComplete = checklist[step.key as keyof OnboardingChecklistData];
            const Icon = step.icon;

            return (
              <div
                key={step.key}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                  isComplete
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-white dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700'
                }`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {isComplete ? (
                    <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-400 dark:text-gray-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${isComplete ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`} />
                    <h4 className={`font-medium text-sm ${isComplete ? 'text-green-900 dark:text-green-100' : 'text-gray-900 dark:text-gray-100'}`}>
                      {step.label}
                    </h4>
                  </div>
                  <p className={`text-xs mt-0.5 ${isComplete ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'}`}>
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => updateMutation.mutate({ dismissed: true })}
            className="w-full"
          >
            Dismiss checklist
          </Button>
        </div>
      </div>
    </div>
  );
}
