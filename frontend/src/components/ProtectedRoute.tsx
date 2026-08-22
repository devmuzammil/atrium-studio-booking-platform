import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LoadingSpinner } from './ui';
import type { UserRole } from '../types';

export function ProtectedRoute({ roles }: { roles?: UserRole[] }) {
  const { user, loading, primaryRole } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner label="Checking session…" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && primaryRole && !roles.includes(primaryRole)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
