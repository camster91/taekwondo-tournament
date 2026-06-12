import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import CloseButton from './components/ui/CloseButton';
import Dashboard from './pages/Dashboard';
import Competitors from './pages/Competitors';
import Trash from './pages/Trash';
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
  item: { name: string; href?: string; to?: string; icon: any; pathSuffix?: string };
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
      {active && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gradient-to-br from-indigo-400 to-violet-400" />}
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
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg"
      >
        Skip to main content
      </a>

      {/* ─── Sidebar ─── */}
      <aside
        className={classNames(
          'fixed inset-y-0 left-0 z-40 flex flex-col w-64',
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
          <div className="relative flex-shrink-0">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-violet-500 blur-md opacity-50" />
            <div className="relative h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg">
              <Trophy className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-sm font-semibold text-white tracking-tight truncate">Martial Arts TM</span>
              <span className="text-[10px] uppercase tracking-widest text-white/40 font-medium">Tournament OS</span>
            </div>
          )}
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
                const isActive = item.href === '/'
                  ? location.pathname === '/'
                  : location.pathname === item.href || location.pathname.startsWith(item.href + '/');
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
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                  {initials}
                </div>
                {!sidebarCollapsed && (
                  <>
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-sm font-medium text-white truncate">{userName}</div>
                      <div className="text-[11px] text-white/40 capitalize truncate">{user.role}{user.email.includes('demo') ? ' • shared demo' : ''}</div>
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
        <header className="sticky top-0 z-20 surface-glass">
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

            {/* Notification bell */}
            <button
              className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
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
    </div>
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
          <Route path="/trash" element={<Trash />} />
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