import { Info } from 'lucide-react';
import { isDemoUser } from '../utils/demo-progress';
import { useAuth } from '../context/AuthContext';

/**
 * Persistent demo data disclosure banner shown ONLY on demo accounts.
 * Displayed at the top of authenticated pages when user.isDemo === true.
 * Never shown on production routes (public registration, public scoreboard, etc.).
 * 
 * Closes #189 — fabricated data disclosure requirement.
 */
export default function DemoDataDisclosure() {
  const { user } = useAuth();

  // Only show for demo users
  if (!isDemoUser(user)) {
    return null;
  }

  return (
    <div
      className="sticky top-0 z-40 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800"
      role="status"
      aria-label="Demo mode notice"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-2 text-sm">
        <Info 
          className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" 
          aria-hidden="true" 
        />
        <p className="text-amber-900 dark:text-amber-100">
          <strong className="font-semibold">Demo Mode:</strong> All data shown is fabricated for demonstration purposes only. No real competitor information is stored.
        </p>
      </div>
    </div>
  );
}
