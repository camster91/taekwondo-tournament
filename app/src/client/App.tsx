import { Routes, Route, Link, useLocation } from 'react-router-dom';
import {
  Trophy,
  Users,
  Calendar,
  LayoutGrid,
  Settings,
  Home,
  UserPlus,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Competitors from './pages/Competitors';
import Tournaments from './pages/Tournaments';
import TournamentDetail from './pages/TournamentDetail';
import TournamentSettings from './pages/TournamentSettings';
import Divisions from './pages/Divisions';
import Schedule from './pages/Schedule';
import BracketEditor from './pages/BracketEditor';
import PublicRegister from './pages/PublicRegister';

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

        {/* Quick Stats */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-800">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            Quick Info
          </div>
          <div className="space-y-1 text-sm text-gray-400">
            <div>Newton's Championship 2025</div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="pl-64">
        <main className="py-6 px-8">{children}</main>
      </div>
    </div>
  );
}

export default function App() {
  const location = useLocation();

  // Check if we're on a public page (no sidebar)
  const isPublicPage = location.pathname.startsWith('/register');

  if (isPublicPage) {
    return (
      <Routes>
        <Route path="/register" element={<PublicRegister />} />
      </Routes>
    );
  }

  return (
    <AdminLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/competitors" element={<Competitors />} />
        <Route path="/tournaments" element={<Tournaments />} />
        <Route path="/tournaments/:id" element={<TournamentDetail />} />
        <Route path="/tournaments/:id/settings" element={<TournamentSettings />} />
        <Route path="/tournaments/:id/divisions" element={<Divisions />} />
        <Route path="/tournaments/:id/schedule" element={<Schedule />} />
        <Route path="/tournaments/:tournamentId/divisions/:divisionId/bracket" element={<BracketEditor />} />
      </Routes>
    </AdminLayout>
  );
}
