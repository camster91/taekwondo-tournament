// Lightweight tour / onboarding wizard for first-time directors.
// Persists a `tkd_tour_completed` flag in localStorage so it shows
// exactly once per browser. A "Show tour" item in the user menu
// (wired in App.tsx) re-triggers it.
//
// Design notes:
// - Renders an overlay with one popover at a time, anchored to a
//   target element via getBoundingClientRect.
// - No external dependency. Each step is a plain { selector, title,
//   body, position } object. To add a step: append to TOUR_STEPS.
// - Public users (parents on /register) and unauthenticated viewers
//   never see this — the parent component checks for a logged-in
//   admin/director before mounting the tour.
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import Button from './ui/Button';

const STORAGE_KEY = 'tkd_tour_completed';

export interface TourStep {
  /** CSS selector for the element to highlight */
  selector: string;
  title: string;
  body: string;
  /** Preferred popover position relative to the highlighted element.
   *  Auto-falls-back if it would clip off-screen. */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Optional route hint: tour waits for this path before checking the selector. */
  route?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="dashboard-hero"]',
    title: 'Welcome to your tournament manager',
    body: 'This dashboard gives you a quick view of all your tournaments and the day-of pulse. The full operator walkthrough is in docs/OPERATOR-QUICKSTART.md — this 6-step tour shows you where things live in the UI.',
    position: 'bottom',
  },
  {
    selector: 'a[href="/tournaments"]',
    title: 'Tournaments list',
    body: 'Every tournament you create lives here. Click any card to open it. Draft tournaments can\'t accept registrations; flip the status to "Registration" from the detail page when ready.',
    position: 'right',
  },
  {
    selector: '[data-tour="tournament-detail-actions"]',
    title: 'Tournament detail — your control center',
    body: 'From here you import competitors (Excel or manual), auto-generate divisions by age/belt/weight, and run the tournament day-of. The "View Public" button opens the read-only scoreboard in a new tab.',
    position: 'bottom',
    route: '/tournaments/435ab382-fe49-4469-be51-b826a40ddcf3',
  },
  {
    selector: '[data-tour="nav-scorekeeper"]',
    title: 'Scorekeeper view (day-of)',
    body: 'The scorekeeper is what runs the day. Pick a division, then click competitor 1 or 2 to mark a winner. Keyboard shortcuts: 1/2 = winner, ←/→ = navigate, Enter = confirm, ? = help. Click here to open it.',
    position: 'right',
  },
  {
    selector: '[data-tour="public-display"]',
    title: 'Public scoreboard (spectators)',
    body: 'Connect a laptop to the venue TV and open this URL. Auto-refreshes every 3 seconds, no login required. Generate a shareable link from Settings (Share Link card) to give to spectators.',
    position: 'top',
  },
  {
    selector: '[data-tour="settings-share-link"]',
    title: 'Settings + share link',
    body: 'Set registration fee notes, customize the rules engine, and generate the public share link here. Settings is split into two tabs: Setup (quick) and Categorization + Brackets (advanced).',
    position: 'left',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface PopoverPosition {
  top: number;
  left: number;
  arrow: 'top' | 'bottom' | 'left' | 'right' | 'none';
}

const POPOVER_WIDTH = 360;
const POPOVER_HEIGHT = 200;
const GUTTER = 16;
const ARROW_SIZE = 10;

function computePopover(target: Rect, requested: TourStep['position'], viewport: { w: number; h: number }): PopoverPosition {
  const candidates: ('top' | 'bottom' | 'left' | 'right')[] = requested
    ? [requested, 'bottom', 'right', 'top', 'left']
    : ['bottom', 'right', 'top', 'left'];
  for (const pos of candidates) {
    let top = 0, left = 0, arrow: PopoverPosition['arrow'] = 'none';
    if (pos === 'bottom') {
      top = target.top + target.height + GUTTER;
      left = target.left + target.width / 2 - POPOVER_WIDTH / 2;
      arrow = 'top';
    } else if (pos === 'top') {
      top = target.top - POPOVER_HEIGHT - GUTTER;
      left = target.left + target.width / 2 - POPOVER_WIDTH / 2;
      arrow = 'bottom';
    } else if (pos === 'right') {
      top = target.top + target.height / 2 - POPOVER_HEIGHT / 2;
      left = target.left + target.width + GUTTER;
      arrow = 'left';
    } else {
      top = target.top + target.height / 2 - POPOVER_HEIGHT / 2;
      left = target.left - POPOVER_WIDTH - GUTTER;
      arrow = 'right';
    }
    // Clamp to viewport
    left = Math.max(GUTTER, Math.min(left, viewport.w - POPOVER_WIDTH - GUTTER));
    top = Math.max(GUTTER, Math.min(top, viewport.h - POPOVER_HEIGHT - GUTTER));
    if (
      top >= 0 &&
      left >= 0 &&
      top + POPOVER_HEIGHT <= viewport.h &&
      left + POPOVER_WIDTH <= viewport.w
    ) {
      return { top, left, arrow };
    }
  }
  // Fallback: center of screen
  return {
    top: viewport.h / 2 - POPOVER_HEIGHT / 2,
    left: viewport.w / 2 - POPOVER_WIDTH / 2,
    arrow: 'none',
  };
}

export function isTourCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function resetTour(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage unavailable */
  }
}

interface TourProps {
  /** Force-show the tour even if the user already completed it. */
  force?: boolean;
  /** Called when the user finishes or skips. */
  onComplete?: () => void;
}

export default function Tour({ force = false, onComplete }: TourProps) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const retryRef = useRef(0);

  // Determine if the tour should show
  useEffect(() => {
    if (force) {
      setOpen(true);
      setStepIndex(0);
      return;
    }
    if (!isTourCompleted()) {
      // Tiny delay so the page can settle before we measure positions
      const t = setTimeout(() => setOpen(true), 500);
      return () => clearTimeout(t);
    }
  }, [force]);

  const currentStep = TOUR_STEPS[stepIndex];

  // Find the target element, wait for it if not present
  useEffect(() => {
    if (!open || !currentStep) return;
    let cancelled = false;

    const findAndMeasure = () => {
      if (cancelled) return;
      const el = document.querySelector(currentStep.selector);
      if (!el) {
        // Element not on this page. If step declares a route, navigate.
        if (currentStep.route) {
          window.history.pushState({}, '', currentStep.route);
          window.dispatchEvent(new PopStateEvent('popstate'));
          // Retry a few times after the route change
          if (retryRef.current < 10) {
            retryRef.current++;
            setTimeout(findAndMeasure, 250);
          }
        }
        return;
      }
      retryRef.current = 0;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        // Element is hidden — skip this step
        if (stepIndex < TOUR_STEPS.length - 1) {
          setStepIndex(stepIndex + 1);
        }
        return;
      }
      // Scroll the element into view
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // Re-measure after scroll
      setTimeout(() => {
        if (cancelled) return;
        const r = el.getBoundingClientRect();
        setTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }, 350);
    };

    findAndMeasure();
    return () => { cancelled = true; };
  }, [open, stepIndex, currentStep]);

  const finish = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch { /* ignore */ }
    onComplete?.();
  }, [onComplete]);

  const next = useCallback(() => {
    if (stepIndex < TOUR_STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      finish();
    }
  }, [stepIndex, finish]);

  const prev = useCallback(() => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }, [stepIndex]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, finish, next, prev]);

  const popover = useMemo(() => {
    if (!open || !targetRect) return null;
    return computePopover(
      targetRect,
      currentStep?.position,
      { w: window.innerWidth, h: window.innerHeight },
    );
  }, [open, targetRect, currentStep]);

  if (!open || !currentStep) return null;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Onboarding tour">
      {/* Dim layer with a "spotlight" cutout around the target */}
      {targetRect && (
        <div
          className="absolute pointer-events-none transition-all duration-300"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55), 0 0 0 4px rgba(99, 102, 241, 0.85)',
            borderRadius: 8,
          }}
        />
      )}
      {!targetRect && (
        <div className="absolute inset-0 bg-slate-900/55" onClick={finish} />
      )}

      {/* Popover */}
      {popover && (
        <div
          className="absolute w-[360px] max-w-[calc(100vw-32px)] bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 animate-slide-up"
          style={{ top: popover.top, left: popover.left }}
          role="document"
        >
          {/* Arrow */}
          {popover.arrow !== 'none' && (
            <div
              className={`absolute w-0 h-0 border-solid ${
                popover.arrow === 'top'
                  ? 'bottom-full left-1/2 -translate-x-1/2 border-b-white dark:border-b-slate-800 border-l-transparent border-r-transparent'
                  : popover.arrow === 'bottom'
                  ? 'top-full left-1/2 -translate-x-1/2 border-t-white dark:border-t-slate-800 border-l-transparent border-r-transparent'
                  : popover.arrow === 'left'
                  ? 'right-full top-1/2 -translate-y-1/2 border-r-white dark:border-r-slate-800 border-t-transparent border-b-transparent'
                  : 'left-full top-1/2 -translate-y-1/2 border-l-white dark:border-l-slate-800 border-t-transparent border-b-transparent'
              }`}
              style={{
                borderWidth: ARROW_SIZE,
              }}
              aria-hidden="true"
            />
          )}
          <div className="p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {currentStep.title}
              </h2>
              <button
                type="button"
                onClick={finish}
                aria-label="Close tour"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
              {currentStep.body}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {stepIndex + 1} of {TOUR_STEPS.length}
              </span>
              <div className="flex items-center gap-2">
                {stepIndex > 0 && (
                  <Button variant="ghost" size="sm" onClick={prev}>
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
                  </Button>
                )}
                <Button variant="primary" size="sm" onClick={next}>
                  {stepIndex < TOUR_STEPS.length - 1 ? (
                    <>Next <ArrowRight className="h-3.5 w-3.5 ml-1" /></>
                  ) : (
                    <><Check className="h-3.5 w-3.5 mr-1" /> Done</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
