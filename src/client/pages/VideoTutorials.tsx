import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PlayCircle, ArrowLeft, Video, FileSpreadsheet, Trophy, ExternalLink } from 'lucide-react';
import { PageHeader, Card } from '../components/ui';

// P1-15: Video tutorial slots (structure only).
// Supports optional embed URLs via env vars or config; shows clear placeholders when videos are missing.
// Do not fabricate video files or claim recordings exist.

interface Tutorial {
  id: string;
  title: string;
  description: string;
  duration: string;
  icon: typeof PlayCircle;
  envKey: string;
}

const tutorials: Tutorial[] = [
  {
    id: 'quickstart',
    title: 'Quickstart: Create Your First Tournament',
    description: 'Learn how to set up your organization, create a tournament, and configure basic settings in under 10 minutes.',
    duration: '8 min',
    icon: Trophy,
    envKey: 'VITE_TUTORIAL_QUICKSTART_URL',
  },
  {
    id: 'import-excel',
    title: 'Import Competitors from Excel',
    description: 'Step-by-step guide to importing your competitor roster from an Excel spreadsheet using the auto-mapping tool.',
    duration: '5 min',
    icon: FileSpreadsheet,
    envKey: 'VITE_TUTORIAL_IMPORT_URL',
  },
  {
    id: 'run-tournament',
    title: 'Run a Tournament: Check-In to Results',
    description: 'Complete walkthrough of event-day operations: check-in, division generation, bracket management, scoring, and publishing results.',
    duration: '12 min',
    icon: Video,
    envKey: 'VITE_TUTORIAL_RUN_EVENT_URL',
  },
];

function getTutorialUrl(envKey: string): string | null {
  const url = import.meta.env[envKey] as string | undefined;
  return url && url.trim() ? url.trim() : null;
}

export default function VideoTutorials() {
  useEffect(() => {
    document.title = 'Video Tutorials | Bowin';
  }, []);

  return (
    <div className="min-h-screen bg-[#fafbfc] dark:bg-[#0a0e1a]">
      <PageHeader
        title="Video Tutorials"
        description="Step-by-step video guides to help you master Bowin tournament operations."
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>

        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
          {tutorials.map((tutorial) => {
            const videoUrl = getTutorialUrl(tutorial.envKey);
            const Icon = tutorial.icon;

            return (
              <Card key={tutorial.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                <div className="relative bg-gradient-to-br from-primary-50 to-accent-50 dark:from-primary-900/20 dark:to-accent-900/20 aspect-video flex items-center justify-center">
                  {videoUrl ? (
                    <div className="absolute inset-0">
                      <iframe
                        src={videoUrl}
                        title={tutorial.title}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  ) : (
                    <div className="text-center p-6">
                      <Icon className="h-16 w-16 mx-auto mb-3 text-slate-400 dark:text-slate-600" />
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        Video coming soon
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                        This tutorial is being prepared
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-semibold text-slate-900 dark:text-white leading-snug">
                      {tutorial.title}
                    </h3>
                    <span className="flex-shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                      {tutorial.duration}
                    </span>
                  </div>

                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                    {tutorial.description}
                  </p>

                  {videoUrl && (
                    <a
                      href={videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                    >
                      Watch in new tab
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <div className="mt-12 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-6">
          <h2 className="font-semibold text-amber-900 dark:text-amber-100 mb-2">Need help now?</h2>
          <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
            Can't find what you're looking for? Check our Help Center for written guides, or contact support.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/help"
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100 text-sm font-medium rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors"
            >
              Browse Help Center
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
