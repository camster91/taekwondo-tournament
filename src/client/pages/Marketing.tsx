import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleUserRound,
  MessageCircleCode,
  Play,
  ShieldCheck,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { Button } from '../components/ui';
import { Card, CardBody, CardHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';

const features = [
  {
    icon: CalendarDays,
    title: 'Tournament setup in minutes',
    description: 'Register, group by divisions, publish draws, and share public links for check-in and scoreboards.',
  },
  {
    icon: CircleUserRound,
    title: 'Role-based operations',
    description: 'Directors and scorekeepers get role-appropriate views with secure controls and audit tracking.',
  },
  {
    icon: BarChart3,
    title: 'Real-time visibility',
    description: 'Monitor competitors, matches, brackets, and progress from one clean operations dashboard.',
  },
  {
    icon: ShieldCheck,
    title: 'Reliable production baseline',
    description: 'Backup-friendly workflows, API-level routing, and support escalation for operational issues.',
  },
];

const proofPoints = [
  'Registration + check-in + scoring workflow for multi-venue events',
  'Clear bracketing options for sparring and patterns',
  'Parent/public scoring pages with no login required',
  'Support ticket assistant on every page, including marketing landing',
];

export default function Marketing() {
  const [showDemoNotice, setShowDemoNotice] = useState(false);
  const { user } = useAuth();
  const canOpenSupportQueue = user?.role === 'admin' || user?.role === 'director';

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
            <Trophy className="h-5 w-5 text-[#ef4444]" />
            <span>BOWIN Tournament OS</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/register" className="text-sm text-slate-200 hover:text-white">
              Public registration
            </Link>
            {canOpenSupportQueue ? (
              <Link
                to="/support/tickets"
                className="text-sm text-slate-200 hover:text-white"
              >
                Support
              </Link>
            ) : null}
            <Button as={Link} to="/login" variant="primary" size="sm">
              Sign in
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="mx-auto flex max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
            <div className="w-full max-w-2xl">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium tracking-wide text-[#f8fafc]">
                <Sparkles className="h-3.5 w-3.5 text-[#ef4444]" />
                Tournament operations built for martial arts events
              </p>
              <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
                Stop juggling spreadsheets.
                <span className="text-[#ef4444]"> Run your tournament in one place.</span>
              </h1>
              <p className="mt-5 text-base leading-relaxed text-slate-300 sm:text-lg">
                Bowin helps tournament teams register athletes, run brackets, track rings, and broadcast
                live scoreboards from a single dashboard. Built to support real event pressure: fewer clicks,
                less manual errors, and a cleaner flow from setup to results.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button as={Link} to="/login" variant="primary">
                  <Play className="h-4 w-4" />
                  Open app
                </Button>
                <Button as={Link} to="/register" variant="secondary">
                  Public participant registration
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowDemoNotice((value) => !value)}
                >
                  <MessageCircleCode className="h-4 w-4" />
                  {showDemoNotice ? 'Hide support assistant note' : 'See AI support assistant'}
                </Button>
              </div>
              {showDemoNotice ? (
                <p className="mt-4 max-w-xl rounded-lg border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-sm">
                  The floating AI support widget is available on every page. It can answer common setup questions
                  and escalate tickets to support when needed.
                </p>
              ) : null}

              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                {proofPoints.map((proof) => (
                  <div key={proof} className="flex items-start gap-2 text-sm text-slate-200">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#22c55e]" />
                    <span>{proof}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden flex-1 lg:block">
              <Card>
                <CardHeader title="Live event snapshot" description="What your team sees in the app." />
                <CardBody>
                  <div className="space-y-3">
                    <div className="rounded-lg bg-gradient-to-r from-[#0f172a] to-[#0f172a] p-3">
                      <div className="text-xs uppercase tracking-wider text-slate-400">Tournament status</div>
                      <div className="mt-2 text-lg font-semibold">Austin Taekwondo Open 2026</div>
                      <div className="mt-1 text-sm text-slate-300">6 divisions · 182 competitors · 9 active rings</div>
                    </div>
                    <div className="rounded-lg border border-white/10 p-3">
                      <div className="text-xs uppercase tracking-wider text-slate-400">System health</div>
                      <div className="mt-2 flex items-center gap-2 text-sm text-emerald-300">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        Operational checks: pass
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 p-3">
                      <div className="text-xs uppercase tracking-wider text-slate-400">Support assistant</div>
                      <div className="mt-2 text-sm text-slate-200">AI help widget available and routed to support queue.</div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          </div>
          <div className="pointer-events-none absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-[#ef4444]/30 blur-3xl" />
          <div className="pointer-events-none absolute -left-32 bottom-20 h-80 w-80 rounded-full bg-sky-500/20 blur-3xl" />
        </section>

        <section className="border-t border-white/10 bg-[#0b1220] py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <Card key={feature.title} className="backdrop-blur bg-white/5">
                  <CardBody>
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#ef4444]/15 text-[#ef4444]">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold text-white">{feature.title}</h2>
                        <p className="mt-2 text-sm leading-relaxed text-slate-300">{feature.description}</p>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-6 text-center text-sm text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          © {new Date().getFullYear()} BOWIN Tournament OS · Built for tournament teams, by teams
        </div>
      </footer>
    </div>
  );
}
