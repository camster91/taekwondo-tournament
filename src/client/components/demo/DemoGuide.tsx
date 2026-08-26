import { CheckCircle2, ClipboardCheck, Monitor, Radio, Trophy, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import AccessibleDialog from '../ui/AccessibleDialog';
import type { DemoPath } from '../../utils/demo-progress';

export interface DemoGuidePath {
  id: DemoPath;
  title: string;
  description: string;
  impact: 'read-only' | 'changes-demo-data';
  icon: typeof Trophy;
}

export const DEMO_PATHS: DemoGuidePath[] = [
  { id: 'director', title: 'Director command centre', description: 'Monitor rings, check-in, incidents, and match progress.', impact: 'read-only', icon: Trophy },
  { id: 'scorekeeper', title: 'Scorekeeper station', description: 'Select a ready division and record a fabricated result.', impact: 'changes-demo-data', icon: Radio },
  { id: 'checkin', title: 'Athlete check-in', description: 'Find an athlete and update their fabricated arrival status.', impact: 'changes-demo-data', icon: ClipboardCheck },
  { id: 'parent', title: 'Parent scoreboard', description: 'Follow who is competing now and what is coming next.', impact: 'read-only', icon: CheckCircle2 },
  { id: 'display', title: 'Venue display', description: 'Open the auto-refreshing spectator and TV experience.', impact: 'read-only', icon: Monitor },
];

export function buildDemoDestination(path: DemoPath, tournamentId: string, publicSlug: string): string {
  switch (path) {
    case 'director': return `/tournaments/${tournamentId}/director`;
    case 'scorekeeper': return `/scorekeeper/${tournamentId}`;
    case 'checkin': return `/checkin/${tournamentId}`;
    case 'parent': return `/scoreboard/parent/${tournamentId}?key=${encodeURIComponent(publicSlug)}`;
    case 'display': return `/scoreboard/${publicSlug}`;
  }
}

interface DemoGuideProps {
  open: boolean;
  tournamentId: string | null;
  publicSlug: string | null;
  onClose: () => void;
  onChoose: (path: DemoPath, destination: string) => void;
  onComplete: () => void;
  onRetry: () => void;
}

export default function DemoGuide({ open, tournamentId, publicSlug, onClose, onChoose, onComplete, onRetry }: DemoGuideProps) {
  if (!open) return null;
  const available = Boolean(tournamentId && publicSlug);

  const dialog = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm">
      <AccessibleDialog
        label="Choose your tournament-day view"
        onClose={onClose}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">Live product tour</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950 dark:text-white">Choose your tournament-day view</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300" role="status">5 demo paths available</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close demo guide" className="min-h-11 min-w-11 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 dark:hover:bg-slate-800">
            <X className="mx-auto h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <strong>Everything here is fabricated.</strong> The showcase tournament is shared between demo visitors. Score and check-in actions change demo data and may be visible to others until an operator restores the showcase. Self-service reset is not available; restarting this guide only restarts the tour.
          </div>

          {available ? (
            <div className="grid gap-3 sm:grid-cols-2" aria-label="Demo paths">
              {DEMO_PATHS.map((path) => {
                const Icon = path.icon;
                const destination = buildDemoDestination(path.id, tournamentId!, publicSlug!);
                return (
                  <button
                    key={path.id}
                    type="button"
                    data-demo-path={path.id}
                    onClick={() => onChoose(path.id, destination)}
                    className="min-h-32 rounded-xl border border-slate-200 p-4 text-left transition hover:border-primary-400 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:border-slate-700 dark:hover:border-primary-500 dark:hover:bg-primary-950/30"
                  >
                    <span className="flex items-start gap-3">
                      <span className="rounded-lg bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                      <span>
                        <span className="block font-semibold text-slate-950 dark:text-white">{path.title}</span>
                        <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">{path.description}</span>
                        <span className="mt-2 block text-xs font-semibold text-primary-700 dark:text-primary-300">{path.impact === 'read-only' ? 'Read only' : 'Changes demo data'}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-900/60 dark:bg-rose-950/30">
              <h3 className="font-semibold text-rose-950 dark:text-rose-100">Showcase temporarily unavailable</h3>
              <p className="mt-1 text-sm text-rose-800 dark:text-rose-200">The fabricated live tournament could not be loaded. You can retry without leaving the dashboard.</p>
              <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white">Try again</button>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400">The Bowin team periodically restores the shared showcase. Restarting this guide does not reset its data.</p>
            <button type="button" onClick={onComplete} className="min-h-11 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Done exploring</button>
          </div>
        </div>
      </AccessibleDialog>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
