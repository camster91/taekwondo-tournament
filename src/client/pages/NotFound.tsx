import { Link } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';
import Button from '../components/ui/Button';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center px-4">
      <AlertTriangle className="h-16 w-16 text-yellow-500 mb-4" />
      <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">404</h1>
      <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
        Page not found. The page you are looking for does not exist.
      </p>
      <Button as={Link} to="/" variant="primary" size="lg">
        <Home className="h-5 w-5" />
        Back to Dashboard
      </Button>
    </div>
  );
}
