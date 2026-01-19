/**
 * Dashboard Layout Component
 *
 * Sprint 116: Dashboard Shell
 *
 * Main layout wrapper for authenticated dashboard pages.
 */

import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function DashboardLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  const selectedGuildId = useAuthStore((state) => state.selectedGuildId);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!selectedGuildId) {
    return <Navigate to="/servers" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <Sidebar />
      <main className="md:pl-64">
        <div className="container py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
