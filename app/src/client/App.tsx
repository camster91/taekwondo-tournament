import { useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import {
  Trophy,
  Users,
  Home,
  UserPlus,
  LogOut,
  Shield,
  Menu,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
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
import Scorekeeper from './pages/Scorekeeper';
import CheckIn from './pages/CheckIn';
import PublicScoreboard from './pages/PublicScoreboard';
import Results from './pages/Results';
import UserManagement from './pages/UserManagement';
import Profile from './pages/Profile';
import DirectorDashboard from './pages/DirectorDashboard';

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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center">
            <Trophy className="h-6 w-6 text-primary-500" />
            <span className="ml-2 text-lg font-bold text-white">TKD Manager</span>
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 text-gray-400 hover:text-white"
          >
            {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={classNames(
          'fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 transform transition-transform duration-200 ease-in-out',
          'lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
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
                onClick={() => setSidebarOpen(false)}
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
                onClick={() => setSidebarOpen(false)}
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
      <div className="lg:pl-64 pt-14 lg:pt-0">
        <main className="py-6 px-4 lg:px-8">{children}</main>
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
