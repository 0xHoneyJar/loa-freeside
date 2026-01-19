/**
 * App Component
 *
 * Sprint 116: Dashboard Shell
 *
 * Main application component with routing configuration.
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from '@/pages/Login';
import { ServerSelectPage } from '@/pages/ServerSelect';
import { DashboardPage } from '@/pages/Dashboard';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/servers" element={<ServerSelectPage />} />

        {/* Protected dashboard routes */}
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardPage />} />
          {/* Future routes will be added here:
          <Route path="tiers" element={<TiersPage />} />
          <Route path="thresholds" element={<ThresholdsPage />} />
          <Route path="features" element={<FeaturesPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="history" element={<HistoryPage />} />
          */}
        </Route>

        {/* Redirect root to servers or login */}
        <Route path="/" element={<Navigate to="/servers" replace />} />

        {/* 404 fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
