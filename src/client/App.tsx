import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Link, useLocation, useNavigate, useParams, Navigate } from 'react-router-dom';
import {
  Trophy,
  Users,
  Home,
  UserPlus,
  LogOut,
  Shield,
  Menu,
  Sun,
  Moon,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Calendar,
  LayoutGrid,
  Activity,
  Bell,
  Settings as SettingsIcon,
  ExternalLink,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  HelpCircle,
  Building2,
  LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { isDemoUser } from './utils/demo-progress';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import SupportChatWidget from './components/SupportChatWidget';
import Tour from './components/Tour';
import CloseButton from './components/ui/CloseButton';
import Spinner from './components/ui/Spinner';
import { BowinLogo } from './components/brand/BowinLogo';

// All page components are loaded lazily so the initial bundle ships
// only the App shell + chrome. A director who only opens Scorekeeper
// doesn't download FairnessRules / Divisions / BracketEditor (~3,000 LOC
// of otherwise-dead JS). Suspense wrapping lives at each <Routes> block.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Competitors = lazy(() => import('./pages/Competitors'));
const Trash = lazy(() => import('./pages/Trash'));
const Tournaments = lazy(() => import('./pages/Tournaments'));
const TournamentDetail = lazy(() => import('./pages/TournamentDetail'));
const TournamentSettings = lazy(() => import('./pages/TournamentSettings'));
const Divisions = lazy(() => import('./pages/Divisions'));
const Schedule = lazy(() => import('./pages/Schedule'));
const BracketEditor = lazy(() => import('./pages/BracketEditor'));
const PublicRegister = lazy(() => import('./pages/PublicRegister'));
const CheckRegistration = lazy(() => import('./pages/CheckRegistration'));
const ManageRegistration = lazy(() => import('./pages/ManageRegistration'));
const Marketing = lazy(() => import('./pages/Marketing'));
const Legal = lazy(() => import('./pages/Legal'));
const Login = lazy(() => import('./pages/Login'));
const VerifyMagicLink = lazy(() => import('./pages/VerifyMagicLink'));
const Scorekeeper = lazy(() => import('./pages/Scorekeeper'));
const CheckIn = lazy(() => import('./pages/CheckIn'));
const PublicScoreboard = lazy(() => import('./pages/PublicScoreboard'));
const PublicScoreboardBySlug = lazy(() => import('./pages/PublicScoreboardBySlug'));
const ParentScoreboard = lazy(() => import('./pages/ParentScoreboard'));
const Results = lazy(() => import('./pages/Results'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const Profile = lazy(() => import('./pages/Profile'));
const DirectorDashboard = lazy(() => import('./pages/DirectorDashboard'));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'));
const NotFound = lazy(() => import('./pages/NotFound'));
const FairnessRules = lazy(() => import('./pages/FairnessRules'));
const SchoolPortal = lazy(() => import('./pages/SchoolPortal'));
const OrganizationSettings = lazy(() => import('./pages/OrganizationSettings'));
const SupportTickets = lazy(() => import('./pages/SupportTickets'));

// Fallback rendered while a lazy page chunk is fetched. Centred spinner
// keeps the chrome stable so the page doesn't reflow when the real
// content mounts.
function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]" aria-live="polite" aria-busy="true">
      <Spinner size="lg" />
    </div>
  );
}

function isIsolatedDemoHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === 'demo.tkd.ashbi.ca';
}

function DemoDataNotice() {
  return (
    <aside
      role="status"
      aria-label="Fabricated demo data notice"
      className="border-b border-amber-300/40 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950"
    >
      <strong>Fabricated demo data.</strong>{' '}
      Scores and check-ins can be visible to other demo visitors and may be reset.
    </aside>
  );
}

// Navigation: top-level workspace items
const primaryNav = [
  { name: 'Dashboard', href: '/dashboard', icon: Home, section: 'workspace' },
  { name: 'Competitors', href: '/competitors', icon: Users, section: 'workspace' },
  { name: 'Trash', href: '/trash', icon: Trash2, section: 'admin' },
  { name: 'Tournaments', href: '/tournaments', icon: Trophy, section: 'workspace' },
];

// Per-tournament views (only when a tournament is selected)
const tournamentNav = [
  { name: 'Overview', icon: LayoutGrid, paramKey: 'id', paramValue: 'id' },
  { name: 'Divisions', icon: Users, pathSuffix: '/divisions' },
  { name: 'Schedule', icon: Calendar, pathSuffix: '/schedule' },
  { name: 'Settings', icon: SettingsIcon, pathSuffix: '/settings', roles: ['admin', 'director'] },
];

function classNames(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function NavItem({ item, active, onClick, collapsed, indent = false }: {
  item: { name: string; href?: string; to?: string; icon: LucideIcon; pathSuffix?: string };
  active: boolean;
  onClick?: () => void;
  collapsed?: boolean;
  indent?: boolean;
}) {
  const Icon = item.icon;
  const target = item.href || item.to || '#';

  return (
    <Link
      to={target}
      onClick={onClick}
      title={collapsed ? item.name : undefined}
      className={classNames(
        'group flex items-center rounded-lg text-sm font-medium transition-all duration-150',
        indent ? 'pl-11 pr-3 py-1.5' : 'px-3 py-2',
        collapsed ? 'justify-center' : 'gap-3',
        active
          ? 'bg-white/10 text-white shadow-sm'
          : 'text-white/60 hover:bg-white/5 hover:text-white'
      )}
    >
      <Icon className={classNames(
        'h-[18px] w-[18px] flex-shrink-0 transition-colors',
        active ? 'text-white' : 'text-white/50 group-hover:text-white/80'
      )} />
      {!collapsed && <span className="truncate">{item.name}</span>}
      {active && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gradient-to-br from-primary-400 to-accent-400" />}
    </Link>
  );
}

function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Collapsed state persisted in localStorage for desktop
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('sidebarCollapsed');
      return stored !== null ? JSON.parse(stored) : true; // default to collapsed
    } catch {
      return true;
    }
  });

  // Persist collapsed state
  useEffect(() => {
    try {
      localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed));
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed]);

  // Detect if we're inside a tournament view
  const tournamentMatch = location.pathname.match(/^\/tournaments\/([^/]+)/);
  const tournamentId = tournamentMatch?.[1];

  const initials = user ? `${user.firstName[0] || ''}${user.lastName[0] || ''}`.toUpperCase() : '?';
  const userName = user ? `${user.firstName} ${user.lastName}` : '';

  const toggleCollapsed = () => setSidebarCollapsed((v: boolean) => !v);
  const closeMobile = () => setMobileOpen(false);

  // Is this screen wide enough for desktop sidebar mode?
  // We track this with a useEffect on resize, but for initial render use a CSS class approach
  const sidebarWidth = sidebarCollapsed ? 'w-16' : 'w-64';

  return (
    <div className="min-h-screen bg-[#fafbfc] dark:bg-[#0a0e1a] flex">
      {/* Skip to main content — a11y */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary-600 focus:text-white focus:rounded-lg"
      >
        Skip to main content
      </a>

      {/* ─── Sidebar ─── */}
      <aside
        className={classNames(
          'fixed inset-y-0 left-0 z-40 flex flex-col w-64 no-print',
          'bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950',
          'transition-all duration-300 ease-out',
          'lg:relative lg:flex-shrink-0',
          sidebarCollapsed ? 'lg:w-16' : 'lg:w-64',
          // Mobile: drawer
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0'
        )}
      >
        {/* Brand */}
        <div className={classNames(
          'flex items-center border-b border-white/5',
          sidebarCollapsed ? 'justify-center px-2 py-3' : 'gap-2.5 px-5 h-16'
        )}>
          <BowinLogo compact={sidebarCollapsed} inverse showDescriptor />
          {/* Close button on mobile */}
          <CloseButton
            onClose={closeMobile}
            label="Close sidebar"
            className="ml-auto lg:hidden !text-white/40 hover:!text-white"
          />
        </div>

        {/* Nav scrollable area */}
        <nav className={classNames(
          'flex-1 overflow-y-auto px-3 py-4 space-y-6',
          sidebarCollapsed ? 'px-2' : 'px-3'
        )}>
          {/* Workspace */}
          <div>
            {!sidebarCollapsed && (
              <div className="px-3 mb-2">
                <span className="section-title text-white/40">Workspace</span>
              </div>
            )}
            <div className={classNames('space-y-0.5', sidebarCollapsed && 'flex flex-col items-center')}>
                {primaryNav.map((item) => {
                const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
                return (
                  <NavItem
                    key={item.name}
                    item={item}
                    active={isActive}
                    onClick={closeMobile}
                    collapsed={sidebarCollapsed}
                  />
                );
              })}
            </div>
          </div>

          {/* Active tournament (if any) */}
          {tournamentId && tournamentId !== 'new' && (
            <div>
              {!sidebarCollapsed && (
                <div className="px-3 mb-2 flex items-center justify-between">
                  <span className="section-title text-white/40">Current Tournament</span>
                  <Link to="/tournaments" onClick={closeMobile} className="text-[10px] text-white/30 hover:text-white/60">switch</Link>
                </div>
              )}
              <div className={classNames('space-y-0.5', sidebarCollapsed && 'flex flex-col items-center')}>
                {tournamentNav.map((item) => {
                  const target = `/tournaments/${tournamentId}${item.pathSuffix || ''}`;
                  const isActive = location.pathname === target;
                  return (
                    <NavItem
                      key={item.name}
                      item={{ name: item.name, href: target, icon: item.icon }}
                      active={isActive}
                      onClick={closeMobile}
                      collapsed={sidebarCollapsed}
                      indent={!sidebarCollapsed}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Admin section */}
          {user?.role === 'admin' && (
            <div>
              {!sidebarCollapsed && (
                <div className="px-3 mb-2">
                  <span className="section-title text-white/40">Admin</span>
                </div>
              )}
              <div className={classNames('space-y-0.5', sidebarCollapsed && 'flex flex-col items-center')}>
                <NavItem
                  item={{ name: 'User Management', href: '/admin/users', icon: Shield }}
                  active={location.pathname === '/admin/users'}
                  onClick={closeMobile}
                  collapsed={sidebarCollapsed}
                />
                <NavItem
                  item={{ name: 'Support Tickets', href: '/support/tickets', icon: LifeBuoy }}
                  active={location.pathname === '/support/tickets'}
                  onClick={closeMobile}
                  collapsed={sidebarCollapsed}
                />
              </div>
            </div>
          )}

          {/* Public */}
          <div>
            {!sidebarCollapsed && (
              <div className="px-3 mb-2">
                <span className="section-title text-white/40">Public</span>
              </div>
            )}
            <div className={classNames('space-y-0.5', sidebarCollapsed && 'flex flex-col items-center')}>
              <NavItem
                item={{ name: 'Registration Portal', href: '/register', icon: UserPlus }}
                active={false}
                onClick={closeMobile}
                collapsed={sidebarCollapsed}
              />
            </div>
          </div>
        </nav>

        {/* Footer: user card */}
        <div className={classNames(
          'border-t border-white/5 p-3',
          sidebarCollapsed ? 'flex flex-col items-center gap-2' : 'space-y-2'
        )}>
          {user ? (
            <div className={classNames('relative', sidebarCollapsed && 'w-full flex flex-col items-center')}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className={classNames(
                  'flex items-center gap-2.5 rounded-lg hover:bg-white/5 transition-colors',
                  sidebarCollapsed ? 'flex-col py-1.5 w-full justify-center' : 'px-2 py-1.5 w-full'
                )}
                aria-label={`Account menu for ${userName}, ${user.role}`}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                title={sidebarCollapsed ? userName : undefined}
              >
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                  {initials}
                </div>
                {!sidebarCollapsed && (
                  <>
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-sm font-medium text-white truncate">{userName}</div>
                      <div className="text-[11px] text-white/40 capitalize truncate">{user.role}{isDemoUser(user) ? ' • synthetic demo' : ''}</div>
                    </div>
                    <ChevronRight className={classNames('h-3.5 w-3.5 text-white/40 transition-transform', userMenuOpen && 'rotate-90')} />
                  </>
                )}
              </button>
              {userMenuOpen && (
                <div className={classNames(
                  'absolute bg-slate-800 border border-white/10 rounded-lg p-1 shadow-2xl animate-slide-up z-50',
                  sidebarCollapsed ? 'bottom-full left-1/2 -translate-x-1/2 mb-1 min-w-[160px]' : 'bottom-full left-0 right-0 mb-1'
                )}>
                  <Link
                    to="/profile"
                    onClick={() => { setUserMenuOpen(false); closeMobile(); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-sm text-white/80 hover:bg-white/5 rounded-md"
                  >
                    <SettingsIcon className="h-3.5 w-3.5" /> Profile
                  </Link>
                  {['admin', 'director'].includes(user.role) && (
                    <Link
                      to="/organization"
                      onClick={() => { setUserMenuOpen(false); closeMobile(); }}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-sm text-white/80 hover:bg-white/5 rounded-md"
                    >
                      <Building2 className="h-3.5 w-3.5" /> Organization & billing
                    </Link>
                  )}
                  <button
                    onClick={toggleTheme}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-white/80 hover:bg-white/5 rounded-md"
                  >
                    {theme === 'dark' ? <><Sun className="h-3.5 w-3.5" /> Light mode</> : <><Moon className="h-3.5 w-3.5" /> Dark mode</>}
                  </button>
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      try { localStorage.removeItem('bowin_tour_completed'); } catch { /* ignore */ }
                      // Force a remount by reloading — simplest way to re-trigger
                      // the tour from anywhere. The tour reads its own state.
                      window.location.reload();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-white/80 hover:bg-white/5 rounded-md"
                  >
                    <HelpCircle className="h-3.5 w-3.5" /> Show tour
                  </button>
                  <div className="my-1 border-t border-white/5" />
                  <button
                    onClick={() => { setUserMenuOpen(false); logout(); }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-red-300 hover:bg-red-500/10 rounded-md"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/login"
              className={classNames(
                'flex items-center text-sm text-white/60 hover:text-white',
                sidebarCollapsed ? 'justify-center' : 'gap-2 px-3 py-2'
              )}
            >
              <LogOut className="h-4 w-4" />
              {!sidebarCollapsed && 'Sign in'}
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ─── Main area ─── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar — glass */}
        <header className="sticky top-0 z-20 surface-glass no-print">
          <div className="flex items-center gap-3 h-14 px-4 lg:px-6">
            {/* Sidebar toggle — chevron on desktop, hamburger on mobile */}
            <button
              onClick={() => {
                if (window.matchMedia('(min-width: 1024px)').matches) {
                  toggleCollapsed();
                } else {
                  setMobileOpen(true);
                }
              }}
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
              aria-label={window.matchMedia('(min-width: 1024px)').matches ? (sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar') : 'Open menu'}
              title={window.matchMedia('(min-width: 1024px)').matches ? (sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar') : 'Open menu'}
            >
              {window.matchMedia('(min-width: 1024px)').matches ? (
                sidebarCollapsed
                  ? <PanelLeft className="h-5 w-5" />
                  : <PanelLeftClose className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>

            <div className="flex-1" />

            {/* Theme toggle — visible in the topbar so users can flip
                between light/dark without opening the account menu. */}
            <button
              onClick={toggleTheme}
              className="p-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Notification bell */}
            <button
              className="p-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main id="main-content" className="flex-1 min-w-0">
          <div className="page-enter max-w-[1400px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
            {children}
          </div>
        </main>
      </div>
      {/* Onboarding tour — first-time directors only (persists in localStorage).
          Public pages and unauthenticated viewers never see this because
          AdminLayout only wraps admin routes. */}
      {!isDemoUser(user) && <Tour />}
    </div>
  );
}


// Redirects old /tournaments/:id/<page> URLs to the canonical /<page>/:tournamentId
// (or /<page>/:id for the admin-wrapped ones). Closes #39 — stale bookmarks
// and old docs referencing the nested path no longer 404. Renders a brief
// "Redirecting..." state for one tick so the user sees the URL change in the
// address bar rather than appearing to swap mid-page.
function LegacyRedirect({ toKey }: { toKey: 'scorekeeper' | 'checkin' | 'display' }) {
  const { id } = useParams<{ id: string }>();
  if (!id) return <NotFound />;
  return <Navigate to={`/${toKey}/${id}`} replace />;
}


function AppRoutes() {
  const location = useLocation();
  const { user } = useAuth();
  const showDemoNotice = isDemoUser(user) || isIsolatedDemoHost();

  // Public pages (no sidebar)
  const isPublicPage =
    location.pathname.startsWith('/register') ||
    location.pathname.startsWith('/check-registration') ||
    location.pathname.startsWith('/manage-registration') ||
    location.pathname === '/' ||
    location.pathname.startsWith('/login') ||
    location.pathname.startsWith('/verify') ||
    location.pathname.startsWith('/accept-invite') ||
    location.pathname.startsWith('/scorekeeper') ||
    location.pathname.startsWith('/checkin') ||
    location.pathname.startsWith('/display') ||
    location.pathname.startsWith('/scoreboard') ||
    // Legacy nested paths — matched here so the redirect routes can fire
    // (and render without the AdminLayout) before falling into the admin
    // Route tree that would otherwise show a 404.
    /^\/tournaments\/[^/]+\/(scorekeeper|checkin|display|school)(\/|$)/.test(location.pathname);

  if (isPublicPage) {
    return (
      <Suspense fallback={<PageFallback />}>
        {showDemoNotice && <DemoDataNotice />}
        <Routes>
          <Route path="/" element={<Marketing />} />
          <Route path="/legal/privacy" element={<Legal kind="privacy" />} />
          <Route path="/legal/terms" element={<Legal kind="terms" />} />
          <Route path="/register" element={<PublicRegister />} />
          <Route path="/check-registration" element={<CheckRegistration />} />
          <Route path="/manage-registration" element={<ManageRegistration />} />
          <Route path="/login" element={<Login />} />
          <Route path="/verify" element={<VerifyMagicLink />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/scorekeeper/:tournamentId" element={<ProtectedRoute><Scorekeeper /></ProtectedRoute>} />
          <Route path="/checkin/:tournamentId" element={<ProtectedRoute><CheckIn /></ProtectedRoute>} />
          <Route path="/display/:tournamentId" element={<PublicScoreboard />} />
          <Route path="/scoreboard/parent/:tournamentId" element={<ParentScoreboard />} />
          <Route path="/scoreboard/:publicSlug" element={<PublicScoreboardBySlug />} />
          {/* School portal — share a read-only link with parents/directors
              so they can see the live bracket without needing to log in.
              Lives in the public route tree so the AdminLayout doesn't
              wrap it. */}
          <Route path="/tournaments/:tournamentId/school" element={<SchoolPortal />} />
          {/* Legacy URL redirects — old paths used /tournaments/:id/<page>.
              Closes #39 where a stale URL or bookmark hit a 404. */}
          <Route path="/tournaments/:id/scorekeeper" element={<LegacyRedirect toKey="scorekeeper" />} />
          <Route path="/tournaments/:id/checkin" element={<LegacyRedirect toKey="checkin" />} />
          <Route path="/tournaments/:id/display" element={<LegacyRedirect toKey="display" />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <ProtectedRoute>
      <AdminLayout>
        {showDemoNotice && <DemoDataNotice />}
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* General pages - any authenticated user */}
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/competitors" element={<Competitors />} />
            <Route path="/trash" element={<Trash />} />
            <Route path="/tournaments" element={<Tournaments />} />
            <Route path="/tournaments/:id" element={<TournamentDetail />} />
            <Route path="/tournaments/:id/results" element={<Results />} />
            <Route
              path="/tournaments/:tournamentId/divisions/:divisionId/bracket"
              element={<BracketEditor />}
            />
            <Route path="/profile" element={<Profile />} />
            <Route
              path="/organization"
              element={
                <ProtectedRoute requiredRoles={['admin', 'director']}>
                  <OrganizationSettings />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            {/* Director+ pages - admin or director only */}
            <Route
              path="/tournaments/:id/settings"
              element={
                <ProtectedRoute requiredRoles={['admin', 'director']}>
                  <TournamentSettings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tournaments/:id/divisions"
              element={
                <ProtectedRoute requiredRoles={['admin', 'director']}>
                  <Divisions />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tournaments/:id/schedule"
              element={
                <ProtectedRoute requiredRoles={['admin', 'director']}>
                  <Schedule />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tournaments/:id/director"
              element={
                <ProtectedRoute requiredRoles={['admin', 'director']}>
                  <DirectorDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tournaments/:tournamentId/fairness"
              element={
                <ProtectedRoute requiredRoles={['admin', 'director']}>
                  <FairnessRules />
                </ProtectedRoute>
              }
            />

            {/* Admin only pages */}
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute requiredRoles={['admin']}>
                  <UserManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="/support/tickets"
              element={
                <ProtectedRoute requiredRoles={['admin', 'director']}>
                  <SupportTickets />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
          <SupportChatWidget />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
