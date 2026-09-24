// P2-18: Onboarding checklist component — contextual, recoverable, keyboard-safe
import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { X, CheckCircle, Circle, Building2, Upload, Trophy, Eye, UserPlus, ArrowRight } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { Button } from './ui';
import { hasDraft } from '../utils/draft-storage';

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

interface StepConfig {
  key: keyof OnboardingChecklistData;
  label: string;
  description: string;
  icon: typeof Building2;
  action?: {
    label: string;
    path: string;
    onClick?: () => void;
  };
}

const steps: StepConfig[] = [
  { 
    key: 'orgProfileComplete', 
    label: 'Create organization', 
    description: 'Set up your organization profile',
    icon: Building2,
    action: {
      label: 'Create org',
      path: '/organization',
    },
  },
  { 
    key: 'firstTournamentDone', 
    label: 'Create tournament', 
    description: 'Set up your first tournament',
    icon: Trophy,
    action: {
      label: 'Create tournament',
      path: '/tournaments?create=1',
    },
  },
  { 
    key: 'importComplete', 
    label: 'Import competitors', 
    description: 'Upload your competitor roster',
    icon: Upload,
    action: {
      label: 'Import',
      path: '/competitors',
    },
  },
  { 
    key: 'publicPageReviewed', 
    label: 'Review public page', 
    description: 'Check your public registration page',
    icon: Eye,
  },
  { 
    key: 'staffInvited', 
    label: 'Invite staff (optional)', 
    description: 'Invite scorekeepers to help',
    icon: UserPlus,
    action: {
      label: 'Invite',
      path: '/organization',
    },
  },
];

export default function OnboardingChecklist() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMinimized, setIsMinimized] = useState(false);
  const [hasDraftOrg] = useState(() => hasDraft('organization'));
  const checklistRef = useRef<HTMLDivElement>(null);

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

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!checklistRef.current) return;
    
    if (e.key === 'Escape') {
      setIsMinimized(true);
    }
  }, []);

  useEffect(() => {
    if (isMinimized) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMinimized, handleKeyDown]);

  // Don't show if dismissed or all steps complete
  if (isLoading || !checklist || checklist.dismissed) return null;

  const completedSteps = steps.filter((step) => checklist[step.key]).length;
  const allComplete = completedSteps === steps.length;

  if (allComplete) return null;

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg shadow-lg hover:bg-primary-700 transition-colors text-sm sm:text-base"
          aria-label="Expand setup checklist"
        >
          <Trophy className="h-4 w-4 sm:h-5 sm:w-5" />
          <span className="font-medium">{completedSteps}/{steps.length} Setup</span>
        </button>
      </div>
    );
  }

  return (
    <div 
      ref={checklistRef}
      className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-md sm:bottom-6 sm:right-6"
      role="complementary"
      aria-label="Setup checklist"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Trophy className="h-4 w-4 sm:h-5 sm:w-5" />
            <h3 className="font-semibold text-sm sm:text-base">Setup</h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsMinimized(true)}
              className="text-white/80 hover:text-white p-1.5 rounded transition-colors"
              aria-label="Minimize (Escape)"
              title="Minimize (Escape)"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <button
              onClick={() => updateMutation.mutate({ dismissed: true })}
              className="text-white/80 hover:text-white p-1.5 rounded transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-3 py-2.5 sm:px-4 sm:py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between text-xs sm:text-sm mb-2">
            <span className="text-gray-700 dark:text-gray-300 font-medium">
              {completedSteps}/{steps.length} complete
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              {Math.round((completedSteps / steps.length) * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 sm:h-2">
            <div
              className="bg-primary-600 h-full rounded-full transition-all duration-300"
              style={{ width: `${(completedSteps / steps.length) * 100}%` }}
              role="progressbar"
              aria-valuenow={completedSteps}
              aria-valuemin={0}
              aria-valuemax={steps.length}
            />
          </div>
          {hasDraftOrg && !checklist.orgProfileComplete && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
              <span className="font-medium">Draft saved</span> — resume or start fresh
            </p>
          )}
        </div>

        {/* Steps */}
        <div className="p-3 sm:p-4 space-y-2 sm:space-y-3 max-h-[60vh] sm:max-h-96 overflow-y-auto">
          {steps.map((step, index) => {
            const isComplete = checklist[step.key];
            const Icon = step.icon;
            const showAction = !isComplete && step.action;

            return (
              <div
                key={step.key}
                className={`flex items-start gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg border transition-colors ${
                  isComplete
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-white dark:bg-gray-900/50 border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {isComplete ? (
                    <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <Circle className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 dark:text-gray-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0 ${isComplete ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`} />
                        <h4 className={`font-medium text-xs sm:text-sm ${isComplete ? 'text-green-900 dark:text-green-100' : 'text-gray-900 dark:text-gray-100'}`}>
                          {step.label}
                        </h4>
                      </div>
                      <p className={`text-xs mt-0.5 ${isComplete ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'}`}>
                        {step.description}
                      </p>
                    </div>
                    {showAction && step.action && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation();
                          if (step.action!.onClick) {
                            step.action!.onClick();
                          } else {
                            navigate(step.action!.path);
                          }
                        }}
                        className="flex-shrink-0 text-xs px-2 py-1 h-auto"
                        aria-label={`${step.action.label} (Step ${index + 1})`}
                      >
                        {step.action.label}
                        <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-3 py-2.5 sm:px-4 sm:py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => updateMutation.mutate({ dismissed: true })}
            className="w-full text-xs sm:text-sm"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
