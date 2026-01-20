/**
 * Role Guard Component
 *
 * Sprint 144: Dashboard Login Integration
 *
 * Protects routes based on user roles. Redirects unauthorized users
 * to appropriate pages based on auth state.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isLocalUser, type UserRole } from '@/stores/authStore';

interface RoleGuardProps {
  /** Child components to render if authorized */
  children: React.ReactNode;
  /** Required roles (any role matches) */
  allowedRoles?: UserRole[];
  /** Require local authentication (QA/admin) */
  requireLocalAuth?: boolean;
  /** Custom redirect path for unauthorized users */
  redirectTo?: string;
  /** Custom fallback component for unauthorized users */
  fallback?: React.ReactNode;
}

/**
 * Guard component that protects routes based on user roles
 *
 * @example
 * // Require any authenticated user
 * <RoleGuard><ProtectedPage /></RoleGuard>
 *
 * @example
 * // Require admin or qa_admin role
 * <RoleGuard allowedRoles={['admin', 'qa_admin']}><AdminPage /></RoleGuard>
 *
 * @example
 * // Require local auth (QA testers)
 * <RoleGuard requireLocalAuth><QADashboard /></RoleGuard>
 */
export function RoleGuard({
  children,
  allowedRoles,
  requireLocalAuth = false,
  redirectTo = '/login',
  fallback,
}: RoleGuardProps) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated || !user) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  // Require local auth but user is Discord authenticated
  if (requireLocalAuth && !isLocalUser(user)) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive">Access Denied</h1>
          <p className="mt-2 text-muted-foreground">
            This page requires QA credentials.
          </p>
        </div>
      </div>
    );
  }

  // Check role requirements for local users
  if (allowedRoles && allowedRoles.length > 0) {
    if (isLocalUser(user)) {
      const hasRequiredRole = user.roles.some((role) =>
        allowedRoles.includes(role as UserRole)
      );

      if (!hasRequiredRole) {
        if (fallback) {
          return <>{fallback}</>;
        }
        return (
          <div className="flex h-screen items-center justify-center">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-destructive">Access Denied</h1>
              <p className="mt-2 text-muted-foreground">
                You don't have permission to access this page.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Required: {allowedRoles.join(', ')}
              </p>
            </div>
          </div>
        );
      }
    }
    // Discord users don't have roles in the same way - they're authorized by guild admin status
    // If allowedRoles is specified but user is Discord, they're not eligible
    // unless we explicitly want to allow Discord admins
  }

  // User is authorized
  return <>{children}</>;
}

/**
 * Higher-order component for role-based protection
 */
export function withRoleGuard<P extends object>(
  Component: React.ComponentType<P>,
  guardProps: Omit<RoleGuardProps, 'children'>
) {
  return function GuardedComponent(props: P) {
    return (
      <RoleGuard {...guardProps}>
        <Component {...props} />
      </RoleGuard>
    );
  };
}

/**
 * Hook to check if current user has specific roles
 */
export function useHasRole(roles: UserRole[]): boolean {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return false;
  }

  if (!isLocalUser(user)) {
    return false;
  }

  return user.roles.some((role) => roles.includes(role as UserRole));
}

/**
 * Hook to check if current user is a local (QA) user
 */
export function useIsLocalUser(): boolean {
  const { user, isAuthenticated } = useAuth();
  return isAuthenticated && isLocalUser(user);
}
