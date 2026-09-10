import { Link } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';
import Button from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';

export default function NotFound() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-surface-100 dark:bg-surface-950 flex flex-col items-center justify-center px-4">
      <AlertTriangle className="h-16 w-16 text-warning mb-4" />
      <h1 className="text-4xl font-bold text-surface-900 dark:text-white mb-2">404</h1>
      <p className="text-lg text-surface-600 dark:text-surface-400 mb-8">
        Page not found. The page you are looking for does not exist.
      </p>
      <Button as={Link} to={isAuthenticated ? '/dashboard' : '/'} variant="primary" size="lg">
        <Home className="h-5 w-5" />
        Back to {isAuthenticated ? 'Dashboard' : 'Home'}
      </Button>
    </div>
  );
}
