import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import {
  Trophy,
  Users,
  Calendar,
  LayoutGrid,
  Settings,
  Home,
  UserPlus,
  LogOut,
  ClipboardCheck,
  Timer,
  Shield,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
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
import Scorekeeper from './pages/Scorekeeper';
import CheckIn from './pages/CheckIn';
import PublicScoreboard from './pages/PublicScoreboard';
import Results from './pages/Results';
import UserManagement from './pages/UserManagement';
import Profile from './pages/Profile';

const navigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Competitors', href: '/competitors', icon: Users },
  { name: 'Tournaments', href: '/tournaments', icon: Trophy },
];

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}

// Layout with sidebar for admin pages
function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 z-50 w-64 bg-gray-900">
        <div className="flex h-16 items-center justify-center border-b border-gray-800">
          <Trophy className="h-8 w-8 text-primary-500" />
          <span className="ml-2 text-xl font-bold text-white">TKD Manager</span>
        </div>
        <nav className="mt-6 px-3">
          {navigation.map((item) => {
            const isActive =
              item.href === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                to={item.href}
                className={classNames(
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                  'group flex items-center px-3 py-2 text-sm font-medium rounded-md mb-1'
                )}
              >
                <item.icon
                  className={classNames(
                    isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-white',
                    'mr-3 h-5 w-5'
                  )}
                />
                {item.name}
              </Link>
            );
          })}

          {/* Admin Section */}
          {user?.role === 'admin' && (
            <div className="mt-8 pt-4 border-t border-gray-800">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2 px-3">
                Admin
              </div>
              <Link
                to="/admin/users"
                className={classNames(
                  location.pathname === '/admin/users'
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                  'group flex items-center px-3 py-2 text-sm font-medium rounded-md mb-1'
                )}
              >
                <Shield className="text-gray-400 group-hover:text-white mr-3 h-5 w-5" />
                User Management
              </Link>
            </div>
          )}

          {/* Link to public registration */}
          <div className="mt-8 pt-4 border-t border-gray-800">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-2 px-3">
              Public Pages
            </div>
            <Link
              to="/register"
              className="text-gray-400 hover:bg-gray-800 hover:text-white group flex items-center px-3 py-2 text-sm font-medium rounded-md mb-1"
              target="_blank"
            >
              <UserPlus className="text-gray-400 group-hover:text-white mr-3 h-5 w-5" />
              Registration Portal
            </Link>
          </div>
        </nav>

        {/* User Info */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-800">
          {user ? (
            <div>
              <Link to="/profile" className="block hover:opacity-80">
                <div className="text-sm text-white font-medium">
                  {user.firstName} {user.lastName}
                </div>
                <div className="text-xs text-gray-400 capitalize">{user.role}</div>
              </Link>
              <button
                onClick={logout}
                className="mt-2 flex items-center text-sm text-gray-400 hover:text-white"
              >
                <LogOut className="h-4 w-4 mr-1" />
                Sign out
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center text-sm text-gray-400 hover:text-white"
            >
              <LogOut className="h-4 w-4 mr-1" />
              Sign in
            </Link>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="pl-64">
        <main className="py-6 px-8">{children}</main>
      </div>
    </div>
  );
}

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // For now, allow access without auth (can be enabled later)
  // if (!isAuthenticated) {
  //   return <Navigate to="/login" state={{ from: location }} replace />;
  // }

  return <>{children}</>;
}

function AppRoutes() {
  const location = useLocation();

  // Public pages (no sidebar)
  const isPublicPage =
    location.pathname.startsWith('/register') ||
    location.pathname.startsWith('/login') ||
    location.pathname.startsWith('/scorekeeper') ||
    location.pathname.startsWith('/checkin') ||
    location.pathname.startsWith('/display');

  if (isPublicPage) {
    return (
      <Routes>
        <Route path="/register" element={<PublicRegister />} />
        <Route path="/login" element={<Login />} />
        <Route path="/scorekeeper/:tournamentId" element={<Scorekeeper />} />
        <Route path="/checkin/:tournamentId" element={<CheckIn />} />
        <Route path="/display/:tournamentId" element={<PublicScoreboard />} />
      </Routes>
    );
  }

  return (
    <ProtectedRoute>
      <AdminLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/competitors" element={<Competitors />} />
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/tournaments/:id" element={<TournamentDetail />} />
          <Route path="/tournaments/:id/settings" element={<TournamentSettings />} />
          <Route path="/tournaments/:id/divisions" element={<Divisions />} />
          <Route path="/tournaments/:id/schedule" element={<Schedule />} />
          <Route path="/tournaments/:id/results" element={<Results />} />
          <Route
            path="/tournaments/:tournamentId/divisions/:divisionId/bracket"
            element={<BracketEditor />}
          />
          <Route path="/admin/users" element={<UserManagement />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </AuthProvider>
  );
}
