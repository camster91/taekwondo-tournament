import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, Loader2 } from 'lucide-react';
import Button from './ui/Button';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRoles?: Array<'admin' | 'director' | 'scorekeeper' | 'viewer'>;
  requireAuth?: boolean;
}

/**
 * ProtectedRoute component that handles authentication and role-based access.
 *
 * Usage:
 * - <ProtectedRoute>{children}</ProtectedRoute> - Requires authentication only
 * - <ProtectedRoute requiredRoles={['admin']}>{children}</ProtectedRoute> - Requires admin role
 * - <ProtectedRoute requiredRoles={['admin', 'director']}>{children}</ProtectedRoute> - Requires admin OR director
 * - <ProtectedRoute requireAuth={false}>{children}</ProtectedRoute> - No auth required (public route)
 */
export default function ProtectedRoute({
  children,
  requiredRoles,
  requireAuth = true,
}: ProtectedRouteProps) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600 mx-auto" />
          <p className="mt-2 text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  // If auth is not required, render children
  if (!requireAuth) {
    return <>{children}</>;
  }

  // Check if user is authenticated
  if (!isAuthenticated) {
    // Redirect to login, preserving the intended destination
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role requirements
  if (requiredRoles && requiredRoles.length > 0) {
    const hasRequiredRole = user && requiredRoles.includes(user.role);

    if (!hasRequiredRole) {
      // User is authenticated but doesn't have required role
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="bg-red-100 p-4 rounded-full w-16 h-16 mx-auto flex items-center justify-center">
              <ShieldAlert className="h-8 w-8 text-red-600" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-gray-900">Access Denied</h1>
            <p className="mt-2 text-gray-600">
              You don't have permission to access this page. This area requires{' '}
              <span className="font-medium">
                {requiredRoles.join(' or ')}
              </span>{' '}
              access.
            </p>
            <p className="mt-4 text-sm text-gray-500">
              Your current role: <span className="font-medium">{user?.role}</span>
            </p>
            <div className="mt-6 space-x-4">
              <Button as="a" href="/" variant="primary">
                Go to Dashboard
              </Button>
              <Button
                onClick={() => window.history.back()}
                variant="secondary"
              >
                Go Back
              </Button>
            </div>
          </div>
        </div>
      );
    }
  }

  // User is authenticated and has required role (or no role required)
  return <>{children}</>;
}

/**
 * Role hierarchy for permission checks
 * admin > director > scorekeeper > viewer
 */
export const ROLE_HIERARCHY = {
  admin: 4,
  director: 3,
  scorekeeper: 2,
  viewer: 1,
} as const;

/**
 * Check if a role has at least the required permission level
 */
export function hasMinimumRole(
  userRole: keyof typeof ROLE_HIERARCHY,
  requiredRole: keyof typeof ROLE_HIERARCHY
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}
