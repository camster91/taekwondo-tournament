import { useState } from 'react';
import { Routes, Route, Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import {
  Trophy,
  Users,
  Home,
  UserPlus,
  LogOut,
  Shield,
  Menu,
  X,
  Sun,
  Moon,
  ChevronRight,
  Sparkles,
  Calendar,
  LayoutGrid,
  Activity,
  Search,
  Bell,
  Settings as SettingsIcon,
  ExternalLink,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import Competitors from './pages/Competitors';
import Tournaments from './pages/Tournaments';
import TournamentDetail from './pages/TournamentDetail';
import TournamentSettings from './pages/TournamentSettings';
import Divisions from './pages/Divisions';
import Schedule from './pages/Schedule';
import BracketEditor from './pages/BracketEditor';
import PublicRegister from './pages/PublicRegister';
import Login from './pages/Login';
import VerifyMagicLink from './pages/VerifyMagicLink';
import Scorekeeper from './pages/Scorekeeper';
import CheckIn from './pages/CheckIn';
import PublicScoreboard from './pages/PublicScoreboard';
import Results from './pages/Results';
import UserManagement from './pages/UserManagement';
import Profile from './pages/Profile';
import DirectorDashboard from './pages/DirectorDashboard';
import AcceptInvite from './pages/AcceptInvite';
import NotFound from './pages/NotFound';

// Navigation: top-level workspace items
const primaryNav = [
  { name: 'Dashboard', href: '/', icon: Home, section: 'workspace' },
  { name: 'Competitors', href: '/competitors', icon: Users, section: 'workspace' },
  { name: 'Tournaments', href: '/tournaments', icon: Trophy, section: 'workspace' },
];

// Per-tournament views (only when a tournament is selected)
const tournamentNav = [
  { name: 'Overview', icon: LayoutGrid, paramKey: 'id', paramValue: 'id' },
  { name: 'Divisions', icon: Users, pathSuffix: '/divisions' },
  { name: 'Schedule', icon: Calendar, pathSuffix: '/schedule' },
  { name: 'Settings', icon: SettingsIcon, pathSuffix: '/settings', roles: ['admin', 'director'] },
];

function classNames(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}

function NavItem({ item, active, onClick, indent = false }: {
  item: { name: string; href?: string; to?: string; icon: any; pathSuffix?: string };
  active: boolean;
  onClick?: () => void;
  indent?: boolean;
}) {
  const Icon = item.icon;
  const target = item.href || item.to || '#';
  return (
    <Link
      to={target}
      onClick={onClick}
      className={classNames(
        'group flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-150',
        indent ? 'pl-11 pr-3 py-1.5' : 'px-3 py-2',
        active
          ? 'bg-white/10 text-white shadow-sm'
          : 'text-white/60 hover:bg-white/5 hover:text-white'
      )}
    >
      <Icon className={classNames(
        'h-[18px] w-[18px] flex-shrink-0 transition-colors',
        active ? 'text-white' : 'text-white/50 group-hover:text-white/80'
      )} />
      <span className="truncate">{item.name}</span>
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gradient-to-br from-indigo-400 to-violet-400" />}
    </Link>
  );
}

function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Detect if we're inside a tournament view for breadcrumb
  const tournamentMatch = location.pathname.match(/^\/tournaments\/([^/]+)/);
  const tournamentId = tournamentMatch?.[1];

  const initials = user ? `${user.firstName[0] || ''}${user.lastName[0] || ''}`.toUpperCase() : '?';
  const userName = user ? `${user.firstName} ${user.lastName}` : '';

  return (
    <div className="min-h-screen bg-[#fafbfc] dark:bg-[#0a0e1a] flex">
      {/* ─── Sidebar ─── */}
      <aside
        className={classNames(
          'fixed inset-y-0 left-0 z-40 w-64 flex flex-col',
          'bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950',
          'transition-transform duration-300 ease-out',
          'lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:static lg:z-auto lg:flex-shrink-0'
        )}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-2.5 px-5 border-b border-white/5">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-violet-500 blur-md opacity-50" />
            <div className="relative h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg">
              <Trophy className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-white tracking-tight">Martial Arts TM</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40 font-medium">Tournament OS</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto p-1.5 text-white/40 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav scrollable area */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {/* Workspace */}
          <div>
            <div className="px-3 mb-2">
              <span className="section-title text-white/40">Workspace</span>
            </div>
            <div className="space-y-0.5">
              {primaryNav.map((item) => {
                const isActive = item.href === '/'
                  ? location.pathname === '/'
                  : location.pathname === item.href || location.pathname.startsWith(item.href + '/');
                return (
                  <NavItem
                    key={item.name}
                    item={item}
                    active={isActive}
                    onClick={() => setSidebarOpen(false)}
                  />
                );
              })}
            </div>
          </div>

          {/* Active tournament (if any) */}
          {tournamentId && tournamentId !== 'new' && (
            <div>
              <div className="px-3 mb-2 flex items-center justify-between">
                <span className="section-title text-white/40">Current Tournament</span>
                <Link to="/tournaments" onClick={() => setSidebarOpen(false)} className="text-[10px] text-white/30 hover:text-white/60">switch</Link>
              </div>
              <div className="space-y-0.5">
                {tournamentNav.map((item) => {
                  const target = `/tournaments/${tournamentId}${item.pathSuffix || ''}`;
                  const isActive = location.pathname === target;
                  return (
                    <NavItem
                      key={item.name}
                      item={{ name: item.name, href: target, icon: item.icon }}
                      active={isActive}
                      onClick={() => setSidebarOpen(false)}
                      indent
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Admin section */}
          {user?.role === 'admin' && (
            <div>
              <div className="px-3 mb-2">
                <span className="section-title text-white/40">Admin</span>
              </div>
              <div className="space-y-0.5">
                <NavItem
                  item={{ name: 'User Management', href: '/admin/users', icon: Shield }}
                  active={location.pathname === '/admin/users'}
                  onClick={() => setSidebarOpen(false)}
                />
              </div>
            </div>
          )}

          {/* Public */}
          <div>
            <div className="px-3 mb-2">
              <span className="section-title text-white/40">Public</span>
            </div>
            <div className="space-y-0.5">
              <NavItem
                item={{ name: 'Registration Portal', href: '/register', icon: UserPlus }}
                active={false}
              />
            </div>
          </div>
        </nav>

        {/* Footer: theme toggle + user card */}
        <div className="border-t border-white/5 p-3 space-y-2">
          {user ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
              >
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                  {initials}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm font-medium text-white truncate">{userName}</div>
                  <div className="text-[11px] text-white/40 capitalize truncate">{user.role}{user.email.includes('demo') ? ' • shared demo' : ''}</div>
                </div>
                <ChevronRight className={classNames('h-3.5 w-3.5 text-white/40 transition-transform', userMenuOpen && 'rotate-90')} />
              </button>
              {userMenuOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-slate-800 border border-white/10 rounded-lg p-1 shadow-2xl animate-slide-up">
                  <Link
                    to="/profile"
                    onClick={() => { setUserMenuOpen(false); setSidebarOpen(false); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-sm text-white/80 hover:bg-white/5 rounded-md"
                  >
                    <SettingsIcon className="h-3.5 w-3.5" /> Profile
                  </Link>
                  <button
                    onClick={toggleTheme}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-white/80 hover:bg-white/5 rounded-md"
                  >
                    {theme === 'dark' ? <><Sun className="h-3.5 w-3.5" /> Light mode</> : <><Moon className="h-3.5 w-3.5" /> Dark mode</>}
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
              className="flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:text-white"
            >
              <LogOut className="h-4 w-4" /> Sign in
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── Main area ─── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar — glass */}
        <header className="sticky top-0 z-20 surface-glass">
          <div className="flex items-center gap-3 h-14 px-4 lg:px-6">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 -ml-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Breadcrumb */}
            <Breadcrumbs path={location.pathname} />

            <div className="flex-1" />

            {/* Quick search (decorative for now) */}
            <div className="hidden md:flex items-center gap-2 px-3 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 text-sm text-slate-500 min-w-[240px] cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
              <Search className="h-4 w-4" />
              <span>Search competitors, divisions...</span>
              <kbd className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-400">⌘K</kbd>
            </div>

            {/* Notification bell (decorative) */}
            <button className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
              <Bell className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 min-w-0">
          <div className="page-enter max-w-[1400px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function Breadcrumbs({ path }: { path: string }) {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Build a friendlier label for known paths
  const labels: Record<string, string> = {
    competitors: 'Competitors',
    tournaments: 'Tournaments',
    divisions: 'Divisions',
    schedule: 'Schedule',
    settings: 'Settings',
    director: 'Director Dashboard',
    results: 'Results',
    bracket: 'Bracket',
    admin: 'Admin',
    users: 'Users',
  };

  const items = [
    { label: 'Home', href: '/' },
    ...segments.map((s, i) => ({
      label: labels[s] || (s.length > 8 ? s.slice(0, 8) + '…' : s),
      href: '/' + segments.slice(0, i + 1).join('/'),
    })),
  ];

  return (
    <nav className="flex items-center gap-1.5 text-sm min-w-0">
      {items.map((item, i) => (
        <span key={item.href} className="flex items-center gap-1.5 min-w-0">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 flex-shrink-0" />}
          {i === items.length - 1 ? (
            <span className="font-semibold text-slate-900 dark:text-white truncate">{item.label}</span>
          ) : (
            <Link to={item.href} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white truncate transition-colors">
              {item.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}


function AppRoutes() {
  const location = useLocation();

  // Public pages (no sidebar)
  const isPublicPage =
    location.pathname.startsWith('/register') ||
    location.pathname.startsWith('/login') ||
    location.pathname.startsWith('/verify') ||
    location.pathname.startsWith('/accept-invite') ||
    location.pathname.startsWith('/scorekeeper') ||
    location.pathname.startsWith('/checkin') ||
    location.pathname.startsWith('/display');

  if (isPublicPage) {
    return (
      <Routes>
        <Route path="/register" element={<PublicRegister />} />
        <Route path="/login" element={<Login />} />
        <Route path="/verify" element={<VerifyMagicLink />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/scorekeeper/:tournamentId" element={<ProtectedRoute><Scorekeeper /></ProtectedRoute>} />
        <Route path="/checkin/:tournamentId" element={<ProtectedRoute><CheckIn /></ProtectedRoute>} />
        <Route path="/display/:tournamentId" element={<PublicScoreboard />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    );
  }

  return (
    <ProtectedRoute>
      <AdminLayout>
        <Routes>
          {/* General pages - any authenticated user */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/competitors" element={<Competitors />} />
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/tournaments/:id" element={<TournamentDetail />} />
          <Route path="/tournaments/:id/results" element={<Results />} />
          <Route
            path="/tournaments/:tournamentId/divisions/:divisionId/bracket"
            element={<BracketEditor />}
          />
          <Route path="/profile" element={<Profile />} />

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

          {/* Admin only pages */}
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute requiredRoles={['admin']}>
                <UserManagement />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
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
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
